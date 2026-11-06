"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { answerTask, localDay, todaysSession, tryCode, type Answer, type Feedback, type SessionItem } from "@/lib/practice/learner";
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
  return {
    success: true as const,
    ready: true as const,
    course: who.course,
    sessionId: session.id,
    extra: session.extra,
    items: items
      .filter((item) => byId.has(item.taskId))
      .map((item) => {
        const content = byId.get(item.taskId)!;
        const meta = loaded.published.skills[item.skillKey];
        const answer = answered.get(item.taskId);
        return {
          ...learnerTask(item.taskId, content),
          skill: { es: meta?.labelEs ?? item.skillKey, en: meta?.labelEn ?? item.skillKey },
          stage: item.stage,
          isNew: item.kind === "new",
          answer: answer ? { given: answer.answer as unknown as Answer, feedback: answer.result as unknown as Feedback, explanationEs: content.explanationEs, explanationEn: content.explanationEn } : null,
        };
      }),
    today: { answered: doneToday.length, right: doneToday.filter((answer) => answer.passed).length },
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
): Promise<Result<{ feedback: Feedback; explanationEs: string; explanationEn: string }>> {
  const who = await learnerFor(courseSlug);
  if ("error" in who) return { success: false, error: who.error ?? "Sign in to practise." };
  const parsed = AnswerSchema.safeParse(answer);
  if (!parsed.success) return { success: false, error: "That answer can't be read." };
  try {
    const result = await answerTask(who.userId, sessionId, taskId, parsed.data, durationMs, Math.min(Math.max(Math.round(attempts) || 1, 1), 50));
    if (!result.ok) return { success: false, error: result.error };
    const task = await prisma.practiceTask.findUnique({ where: { id: taskId }, select: { content: true } });
    const content = task?.content as unknown as TaskContent | undefined;
    return { success: true, feedback: result.feedback, explanationEs: content?.explanationEs ?? "", explanationEn: content?.explanationEn ?? "" };
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
