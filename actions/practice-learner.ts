"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { afterAnswer, prepareDiscovery, runDiagnosis, type DiscoveryNote } from "@/lib/practice/discovery";
import { answerTask, loadLearner, localDay, practiceDue, practiceStreak, progressMap, todaysSession, tryCode, type Answer, type Feedback, type LearnerGraph, type SessionItem } from "@/lib/practice/learner";
import type { TaskContent } from "@/lib/practice/tasks";

// The learner's side of practice (/practice/<course>, docs/practice.md "A session"). Learners only ever get a task's
// question side: never its key, tests or solutions.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function learnerFor(courseSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return { error: "Sign in to practise." } as const;
  const course = await prisma.course.findUnique({ where: { slug: courseSlug }, select: { id: true, title: true, slug: true } });
  if (!course) return { error: "Course not found." } as const;
  const enrolled = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: session.user.id, courseId: course.id } } });
  if (!enrolled && session.user.role !== "ADMIN") return { error: "Enrol in the course to practise it." } as const;
  return { userId: session.user.id, course } as const;
}

/** A task as the learner sees it: the question, the choices or the starter code; nothing that gives the answer away. */
function learnerTask(id: string, content: TaskContent) {
  return {
    id,
    form: content.form,
    expectedSeconds: content.expectedSeconds,
    promptEs: content.promptEs,
    promptEn: content.promptEn,
    optionsEs: content.form === "choice" ? content.optionsEs : undefined,
    optionsEn: content.form === "choice" ? content.optionsEn : undefined,
    starter: content.form === "code" || content.form === "debug" ? content.code : undefined,
  };
}

/** One session item as the page shows it; `answer` once it was answered. */
function itemView(
  item: SessionItem,
  content: TaskContent,
  published: LearnerGraph,
  confirmed: Set<string>,
  answer?: { answer: unknown; result: unknown },
) {
  const meta = published.skills[item.skillKey];
  return {
    ...learnerTask(item.taskId, content),
    skill: { es: meta?.labelEs ?? item.skillKey, en: meta?.labelEn ?? item.skillKey },
    stage: item.stage,
    isNew: item.kind === "new",
    // A check on a prerequisite that may be missing, and practice on one that was found missing.
    isProbe: Boolean(item.probe),
    isFound: !item.probe && (item.kind === "discovered" || confirmed.has(item.skillKey)),
    answer: answer ? { given: answer.answer as Answer, feedback: answer.result as Feedback, explanationEs: content.explanationEs, explanationEn: content.explanationEn } : null,
  };
}

/** The skills of the learner's confirmed prerequisites. */
function confirmedSkills(state: { hypotheses?: Record<string, { verdict: string; skillId: string }> }) {
  return new Set(
    Object.values(state.hypotheses ?? {})
      .filter((hypothesis) => hypothesis.verdict === "confirmed")
      .map((hypothesis) => hypothesis.skillId),
  );
}

export async function getPracticeToday(courseSlug: string, timeZone: string, extra = false) {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false as const, error: who.error };
  const day = localDay(timeZone);
  const today = await todaysSession(who.userId, who.course.id, day, extra);
  if (!today) return { success: true as const, ready: false as const, course: who.course };

  const { session, loaded } = today;
  const items = session.items as unknown as SessionItem[];
  const [tasks, answers, daySessions] = await Promise.all([
    prisma.practiceTask.findMany({ where: { id: { in: items.map((item) => item.taskId) } }, select: { id: true, content: true } }),
    prisma.practiceAnswer.findMany({ where: { sessionId: session.id }, select: { taskId: true, answer: true, result: true } }),
    prisma.practiceSession.findMany({ where: { learnerId: loaded.learner.id, day }, select: { answers: { select: { passed: true } } } }),
  ]);
  const byId = new Map(tasks.map((task) => [task.id, task.content as unknown as TaskContent]));
  const answered = new Map(answers.map((answer) => [answer.taskId, answer]));
  const doneToday = daySessions.flatMap((entry) => entry.answers);
  const confirmed = confirmedSkills(loaded.state);
  // Hypotheses still being probed, or confirmed prerequisites not ready: the page asks for their tasks after loading.
  const discoveryWaiting = Object.values(loaded.state.hypotheses ?? {}).some(
    (hypothesis) => !hypothesis.closedAt && (hypothesis.verdict === "open" || (hypothesis.verdict === "confirmed" && !hypothesis.readyAt)),
  );
  return {
    success: true as const,
    ready: true as const,
    course: who.course,
    sessionId: session.id,
    extra: session.extra,
    items: items.filter((item) => byId.has(item.taskId)).map((item) => itemView(item, byId.get(item.taskId)!, loaded.published, confirmed, answered.get(item.taskId))),
    today: { answered: doneToday.length, right: doneToday.filter((answer) => answer.passed).length },
    streak: await practiceStreak(loaded.learner.id, day),
    discoveryWaiting: discoveryWaiting && !session.extra,
  };
}
export type PracticeToday = Extract<Awaited<ReturnType<typeof getPracticeToday>>, { success: true; ready: true }>;
export type PracticeTaskView = PracticeToday["items"][number];

const AnswerSchema = z.object({
  index: z.number().int().min(0).max(9).optional(),
  text: z.string().max(4000).optional(),
  code: z.string().max(60_000).optional(),
});

export async function submitPracticeAnswer(
  courseSlug: string,
  sessionId: string,
  taskId: string,
  answer: z.infer<typeof AnswerSchema>,
  durationMs: number,
  attempts = 1,
): Promise<Result<{ feedback: Feedback; explanationEs: string; explanationEn: string; diagnosisId: string | null; discovery: DiscoveryNote | null }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  const parsed = AnswerSchema.safeParse(answer);
  if (!parsed.success) return { success: false, error: "That answer can't be read." };
  try {
    const result = await answerTask(who.userId, sessionId, taskId, parsed.data, durationMs, Math.min(Math.max(Math.round(attempts) || 1, 1), 50));
    if (!result.ok) return { success: false, error: result.error };
    // A diagnosis to run, or a hypothesis this answer settled (docs/practice.md, "Missing prerequisites"). The answer
    // is recorded either way: a problem here only skips the discovery.
    let diagnosisId: string | null = null;
    let discovery: DiscoveryNote | null = null;
    const { events, learnerId, state, evidenceId, entry } = result;
    if (events?.length && learnerId && state && evidenceId && entry) {
      try {
        ({ diagnosisId, discovery } = await afterAnswer({ userId: who.userId, courseId: who.course.id, learnerId, state, events, evidenceId, entry }));
      } catch (error) {
        console.error(JSON.stringify({ event: "practice.discovery_after_answer_failed", error: error instanceof Error ? error.message : String(error) }));
      }
    }
    const task = await prisma.practiceTask.findUnique({ where: { id: taskId }, select: { content: true } });
    const content = task?.content as unknown as TaskContent | undefined;
    return { success: true, feedback: result.feedback, explanationEs: content?.explanationEs ?? "", explanationEn: content?.explanationEn ?? "", diagnosisId, discovery };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The answer couldn't be graded. Try again." };
  }
}

/** Runs a code task's tests without recording the answer, so the learner can fix their code and run again. */
export async function runPracticeCode(courseSlug: string, sessionId: string, taskId: string, code: string): Promise<Result<{ feedback: Feedback }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  if (code.length > 60_000) return { success: false, error: "That code is too long." };
  try {
    const feedback = await tryCode(who.userId, sessionId, taskId, code);
    if (!feedback) return { success: false, error: "That task isn't open in your practice." };
    return { success: true, feedback };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The tests couldn't run. Try again." };
  }
}

/** The header's badge: what's left to practise today, per course. Zero for visitors and for courses without practice. */
export async function getPracticeDue(timeZone: string) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return { total: 0, courses: [] as { slug: string; title: string; due: number }[] };
  return practiceDue(session.user.id, timeZone);
}

/** The progress map: every skill of the course by module and lesson, with where the learner stands. */
export async function getPracticeMap(courseSlug: string) {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false as const, error: who.error ?? "Sign in to practise." };
  const map = await progressMap(who.userId, who.course.id);
  if (!map) return { success: true as const, ready: false as const, course: who.course };
  return { success: true as const, ready: true as const, course: who.course, ...map };
}
export type PracticeMapData = Extract<Awaited<ReturnType<typeof getPracticeMap>>, { ready: true }>;

/** Runs a diagnosis the last answer asked for (the page calls it in the background): how many hypotheses it opened. */
export async function runPracticeDiagnosis(courseSlug: string, diagnosisId: string): Promise<Result<{ opened: number }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  // Amplify ends a request at about 30 s: the model gets until 25 s, the rest is for saving.
  const result = await runDiagnosis(who.userId, who.course.id, diagnosisId, Date.now() + 25_000);
  return result.ok ? { success: true, opened: result.opened } : { success: false, error: result.error };
}

/**
 * Adds to today's set what the learner's hypotheses need (probes, and practice on a confirmed prerequisite), writing
 * a missing task when there's none: the items added, and whether to call again.
 */
export async function preparePracticeDiscovery(courseSlug: string, sessionId: string): Promise<Result<{ items: PracticeTaskView[]; more: boolean }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  const prepared = await prepareDiscovery(who.userId, who.course.id, sessionId, Date.now() + 27_000);
  if (!prepared) return { success: false, error: "That practice session isn't yours." };
  if (!prepared.added.length) return { success: true, items: [], more: prepared.more };
  const loaded = await loadLearner(who.userId, who.course.id);
  if (!loaded) return { success: false, error: "Practice isn't set up for this course." };
  const tasks = await prisma.practiceTask.findMany({ where: { id: { in: prepared.added.map((item) => item.taskId) } }, select: { id: true, content: true } });
  const byId = new Map(tasks.map((task) => [task.id, task.content as unknown as TaskContent]));
  const confirmed = confirmedSkills(loaded.state);
  return {
    success: true,
    items: prepared.added.filter((item) => byId.has(item.taskId)).map((item) => itemView(item, byId.get(item.taskId)!, loaded.published, confirmed)),
    more: prepared.more,
  };
}
