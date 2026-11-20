"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { courseVisibleTo } from "@/lib/course-access";
import { currentViewer } from "@/lib/viewer";
import { afterAnswer, prepareDiscovery, runDiagnosis, type DiscoveryNote } from "@/lib/practice/discovery";
import { RECIPE_HINT_NUMBER, recipeView, revealRecipe } from "@/lib/practice/recipes";
import { pendingTutorRequests, tutorRequestedSkills } from "@/lib/practice/tutor-requests";
import { askHint, MAX_HINTS } from "@/lib/practice/hints";
import { answerTask, loadLearner, localDay, practiceDue, practiceStreak, progressMap, todaysSession, tryCode, type Answer, type Feedback, type LearnerGraph, type SessionItem } from "@/lib/practice/learner";
import type { TaskContent } from "@/lib/practice/tasks";
import { REQUEST_BUDGET_MS } from "@/lib/request-budget";
import { listenGrant, voiceConfigured, type ListenGrant } from "@/lib/voice/deepgram";
import { canListen, recordListen } from "@/lib/voice/allowance";

// The learner's side of practice (/practice/<course>, docs/practice.md "A session"). Learners only ever get a task's
// question side: never its key, tests or solutions.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function learnerFor(courseSlug: string) {
  const viewer = await currentViewer();
  if (!viewer) return { error: "Sign in to practise." } as const;
  // A private course is "not found" for anyone it isn't for, enrolled or not (lib/course-access.ts).
  const course = await prisma.course.findFirst({ where: { slug: courseSlug, ...courseVisibleTo(viewer) }, select: { id: true, title: true, slug: true } });
  if (!course) return { error: "Course not found." } as const;
  const enrolled = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: viewer.id, courseId: course.id } } });
  if (!enrolled && viewer.role !== "ADMIN") return { error: "Enrol in the course to practise it." } as const;
  return { userId: viewer.id, course } as const;
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
  hints: string[] = [],
  recipeShown = false,
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
    // Practice the learner asked their tutor for (lib/practice/tutor-requests.ts).
    isTutor: item.kind === "tutor",
    // A code task's steps in plain words: open at the skill's first stages, earned later (lib/practice/recipes.ts).
    recipe: recipeView(content, item.stage, recipeShown || Boolean(answer)),
    // Hints asked for before answering, oldest first, and how many more there may be.
    hints,
    maxHints: MAX_HINTS,
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
  const [tasks, answers, daySessions, hintRows] = await Promise.all([
    prisma.practiceTask.findMany({ where: { id: { in: items.map((item) => item.taskId) } }, select: { id: true, content: true } }),
    prisma.practiceAnswer.findMany({ where: { sessionId: session.id }, select: { taskId: true, answer: true, result: true } }),
    prisma.practiceSession.findMany({ where: { learnerId: loaded.learner.id, day }, select: { answers: { select: { passed: true } } } }),
    prisma.practiceHint.findMany({ where: { sessionId: session.id }, orderBy: { number: "asc" }, select: { taskId: true, text: true, number: true } }),
  ]);
  const hintsByTask = new Map<string, string[]>();
  const recipesShown = new Set<string>();
  for (const hint of hintRows) {
    if (hint.number === RECIPE_HINT_NUMBER) recipesShown.add(hint.taskId);
    else hintsByTask.set(hint.taskId, [...(hintsByTask.get(hint.taskId) ?? []), hint.text]);
  }
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
    items: items
      .filter((item) => byId.has(item.taskId))
      .map((item) => itemView(item, byId.get(item.taskId)!, loaded.published, confirmed, answered.get(item.taskId), hintsByTask.get(item.taskId), recipesShown.has(item.taskId))),
    today: { answered: doneToday.length, right: doneToday.filter((answer) => answer.passed).length },
    streak: await practiceStreak(loaded.learner.id, day),
    // Also practice the tutor asked for: requests to resolve, and its skills' tasks to write (prepareDiscovery).
    discoveryWaiting: (discoveryWaiting || (await hasTutorPractice(who.userId, who.course.id))) && !session.extra,
  };
}
export type PracticeToday = Extract<Awaited<ReturnType<typeof getPracticeToday>>, { success: true; ready: true }>;
export type PracticeTaskView = PracticeToday["items"][number];

const AnswerSchema = z.object({
  index: z.number().int().min(0).max(9).optional(),
  // An explanation: two minutes spoken is about 2,000 characters.
  text: z.string().max(8000).optional(),
  code: z.string().max(60_000).optional(),
  spoken: z.boolean().optional(),
});

export async function submitPracticeAnswer(
  courseSlug: string,
  sessionId: string,
  taskId: string,
  answer: z.infer<typeof AnswerSchema>,
  durationMs: number,
  attempts = 1,
  language: "es" | "en" = "en",
): Promise<Result<{ feedback: Feedback; explanationEs: string; explanationEn: string; diagnosisId: string | null; discovery: DiscoveryNote | null }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  const parsed = AnswerSchema.safeParse(answer);
  if (!parsed.success) return { success: false, error: "That answer can't be read." };
  try {
    const result = await answerTask(who.userId, sessionId, taskId, parsed.data, durationMs, Math.min(Math.max(Math.round(attempts) || 1, 1), 50), language === "es" ? "es" : "en");
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
  // Amplify stops a request at 28 s (lib/request-budget.ts): the model works within the budget, the rest is for saving.
  const result = await runDiagnosis(who.userId, who.course.id, diagnosisId, Date.now() + REQUEST_BUDGET_MS);
  return result.ok ? { success: true, opened: result.opened } : { success: false, error: result.error };
}

/**
 * Adds to today's set what the learner's hypotheses need (probes, and practice on a confirmed prerequisite), writing
 * a missing task when there's none: the items added, and whether to call again.
 */
export async function preparePracticeDiscovery(courseSlug: string, sessionId: string): Promise<Result<{ items: PracticeTaskView[]; more: boolean }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  const prepared = await prepareDiscovery(who.userId, who.course.id, sessionId, Date.now() + REQUEST_BUDGET_MS);
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

/** Shows a code task's earned recipe (lib/practice/recipes.ts); it counts like a hint in the answer's evidence. */
export async function revealPracticeRecipe(courseSlug: string, sessionId: string, taskId: string): Promise<Result<{ es: string[]; en: string[] }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  const shown = await revealRecipe(who.userId, sessionId, taskId);
  return "error" in shown ? { success: false, error: shown.error } : { success: true, ...shown };
}

/** A dictation stream for an explanation lasts at most this long; the learner can start another. */
const EXPLAIN_LISTEN_MINUTES = 5;

/** The task's own terms for the speech model to listen for: acronyms and capitalised names in its question and rubric. */
function taskTerms(content: TaskContent): string[] {
  const text = [content.promptEn, ...(content.pointsEn ?? [])].join(" ").replace(/`/g, " ");
  const found = text.match(/\b(?:[A-Z]{2,}[a-z]?s?|[A-Z][a-z]+[A-Z][A-Za-z]*|(?<![.!?]\s)(?<!^)[A-Z][a-z]{3,})\b/g) ?? [];
  return [...new Set(found)].slice(0, 20);
}

/**
 * A microphone stream for an open explain task (docs/voice.md, "Explain in your words"): Nova-3 dictation, words as
 * they come, stopped by the learner. The key stays here; the browser gets a 30-second token for its own stream.
 */
export async function listenForExplanation(
  courseSlug: string,
  sessionId: string,
  taskId: string,
  language: "es" | "en",
): Promise<Result<{ grant: ListenGrant; maxMinutes: number }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  const es = language === "es";
  if (!voiceConfigured()) return { success: false, error: es ? "El dictado no está disponible ahora: escribe tu explicación." : "Dictation isn't available right now: type your explanation." };
  const session = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: { items: true, learner: { select: { userId: true } }, answers: { where: { taskId }, select: { id: true } } },
  });
  if (!session || session.learner.userId !== who.userId || session.answers.length || !(session.items as unknown as SessionItem[]).some((item) => item.taskId === taskId)) {
    return { success: false, error: es ? "Esa tarea no está abierta en tu práctica." : "That task isn't open in your practice." };
  }
  const task = await prisma.practiceTask.findUnique({ where: { id: taskId }, select: { content: true } });
  const content = task?.content as unknown as TaskContent | undefined;
  if (content?.form !== "explain") return { success: false, error: es ? "Esta tarea no se responde en voz alta." : "This task isn't answered aloud." };
  if (!(await canListen(who.userId))) return { success: false, error: es ? "Por hoy no quedan más grabaciones: escribe tu explicación." : "No more recordings today: type your explanation." };
  try {
    const grant = await listenGrant("dictation", language === "es" ? "es" : "en", "practice.listen", taskTerms(content));
    await recordListen(who.userId, "dictation", "practice-explain", "practice.listen", "platform");
    return { success: true, grant, maxMinutes: EXPLAIN_LISTEN_MINUTES };
  } catch (error) {
    console.error(JSON.stringify({ event: "practice.listen_failed", error: error instanceof Error ? error.message : String(error) }));
    return { success: false, error: es ? "No pudimos abrir el micrófono. Inténtalo de nuevo o escribe tu explicación." : "We couldn't start the microphone. Try again, or type your explanation." };
  }
}

/** Whether the learner has practice from their tutor: requests waiting, or skills it asked them to practise. */
async function hasTutorPractice(userId: string, courseId: string) {
  return (await pendingTutorRequests(userId, courseId)) > 0 || (await tutorRequestedSkills(userId, courseId)).length > 0;
}

/** The next hint for an open task (lib/practice/hints.ts), written for the learner's attempt so far. */
export async function askPracticeHint(
  courseSlug: string,
  sessionId: string,
  taskId: string,
  attempt: z.infer<typeof AnswerSchema>,
  language: "es" | "en",
): Promise<Result<{ number: number; text: string; left: number }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  const parsed = AnswerSchema.safeParse(attempt);
  if (!parsed.success) return { success: false, error: "That attempt can't be read." };
  const result = await askHint({ userId: who.userId, sessionId, taskId, attempt: parsed.data, language: language === "es" ? "es" : "en" });
  return result.ok ? { success: true, number: result.number, text: result.text, left: result.left } : { success: false, error: result.error };
}
