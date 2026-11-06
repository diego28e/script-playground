import type { Content, ThinkingLevel } from "@google/genai";
import type { Prisma, TutorMode } from "@prisma/client";
import { z } from "zod";
import { TUTOR_CHAIN, generateWithFallback, logAi } from "@/lib/ai/gemini";
import { labGroups } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import { SYSTEM_PROMPT, buildContext, learnerTurn, type TurnContext } from "@/lib/tutor/prompt";
import { applyTool, readState, unlockedSteps, type AppliedAction, type MemoryWrite, type TutorState } from "@/lib/tutor/state";
import { RESPONSE_SCHEMA, readResponse } from "@/lib/tutor/tools";

// One tutor turn (docs/ai-tutor.md): the learner asks, or presses "Explain this error" / "Suggest a fix", and the
// tutor answers with exactly one Gemini request: a JSON object with the actions it records and its reply
// (lib/tutor/tools.ts). This harness applies the actions to the session's state, saves practice requests and
// memory, and stores the exchange. The caller (the learning service) has already established who the learner is.

const CellSchema = z.object({
  type: z.enum(["code", "markdown"]),
  source: z.string().max(100_000),
  output: z.string().max(100_000).optional(),
});

export const TutorRequestSchema = z.object({
  notebookPath: z.string().min(1).max(500),
  kind: z.enum(["ask", "explain_error", "suggest_fix"]),
  message: z.string().max(4000).optional(),
  cells: z.array(CellSchema).max(400),
  activeCell: z.number().int().min(0),
  solution: z.string().max(200_000).optional(),
  platformLanguage: z.enum(["es", "en"]).default("es"),
  // The learner switched Guide me / Show me in the panel.
  mode: z.enum(["GUIDE", "SHOW"]).optional(),
});
export type TutorRequest = z.input<typeof TutorRequestSchema>;

export type TutorReply =
  | {
      ok: true;
      sessionId: string;
      reply: string;
      mode: TutorMode;
      objective: string | null;
      steps: TutorState["steps"];
      unlocked: number[];
      detours: { skill: string; stage: string }[];
      // Detours closed in this turn: the panel offers "practise this in a few days" for each (recordPractice).
      practiceOffers: { skill: string; evidence: "PASSED" | "SKIPPED" }[];
      actions: AppliedAction[];
      model: string;
      traceId: string;
    }
  | { ok: false; reason: "invalid" | "no-lab-access" | "quota" | "unavailable"; message: string; retryAt?: string; traceId?: string };

// A session ends after this long without a turn; the next question starts a new one (the memory stays).
const SESSION_IDLE_MS = 12 * 3600_000;
// The conversation the model sees, besides the context block: the latest exchanges of this session.
const HISTORY_MESSAGES = 12;

async function courseContext(userId: string, notebookPath: string): Promise<{ lessonId: string | null; course: TurnContext["course"]; lesson: TurnContext["lesson"] }> {
  const lesson = await prisma.lesson.findFirst({
    where: { sourcePath: notebookPath, module: { course: { status: "PUBLISHED" } } },
    select: { id: true, code: true, title: true, objectives: true, prerequisites: true, module: { select: { courseId: true } } },
  });
  if (!lesson) return { lessonId: null, course: null, lesson: null };
  const [course, progress] = await Promise.all([
    prisma.course.findUniqueOrThrow({
      where: { id: lesson.module.courseId },
      select: {
        title: true,
        modules: {
          orderBy: { position: "asc" },
          select: { position: true, title: true, lessons: { orderBy: { position: "asc" }, select: { id: true, code: true, title: true } } },
        },
      },
    }),
    prisma.lessonProgress.findMany({ where: { userId, status: "COMPLETED" }, select: { lessonId: true } }),
  ]);
  const done = new Set(progress.map((row) => row.lessonId));
  return {
    lessonId: lesson.id,
    lesson: { code: lesson.code, title: lesson.title, objectives: lesson.objectives, prerequisites: lesson.prerequisites },
    course: {
      title: course.title,
      modules: course.modules.map((courseModule) => ({
        position: courseModule.position,
        title: courseModule.title,
        lessons: courseModule.lessons.map((entry) => ({ code: entry.code, title: entry.title, completed: done.has(entry.id), current: entry.id === lesson.id })),
      })),
    },
  };
}

/** A newer fact on the same subject supersedes the old one, which is kept as history. */
async function remember(userId: string, sessionId: string, write: MemoryWrite) {
  await prisma.$transaction([
    prisma.learnerMemory.updateMany({
      where: { userId, supersededAt: null, subject: { equals: write.subject, mode: "insensitive" } },
      data: { supersededAt: new Date() },
    }),
    prisma.learnerMemory.create({ data: { userId, sourceSessionId: sessionId, ...write } }),
  ]);
}

export async function runTutorTurn(userId: string, input: TutorRequest): Promise<TutorReply> {
  const parsed = TutorRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const request = parsed.data;
  if (request.activeCell >= request.cells.length) return { ok: false, reason: "invalid", message: "The active cell isn't in the notebook." };
  if (request.kind === "ask" && !request.message?.trim()) return { ok: false, reason: "invalid", message: "Write a question for the tutor." };

  // The tutor is part of the lab: the same people the hub admits.
  if (!(await labGroups(userId)).includes("lab")) {
    return { ok: false, reason: "no-lab-access", message: "The tutor is for learners enrolled in a course." };
  }

  const profile = request.mode
    ? await prisma.tutorProfile.upsert({ where: { userId }, create: { userId, mode: request.mode }, update: { mode: request.mode } })
    : await prisma.tutorProfile.findUnique({ where: { userId } });
  const mode: TutorMode = profile?.mode ?? "GUIDE";

  const { lessonId, course, lesson } = await courseContext(userId, request.notebookPath);
  const recent = await prisma.tutorSession.findFirst({
    where: { userId, notebookPath: request.notebookPath, updatedAt: { gt: new Date(Date.now() - SESSION_IDLE_MS) } },
    orderBy: { updatedAt: "desc" },
  });
  const session = recent ?? (await prisma.tutorSession.create({ data: { userId, lessonId, notebookPath: request.notebookPath } }));
  let state = readState(session.state);

  const [memory, history] = await Promise.all([
    prisma.learnerMemory.findMany({
      where: { userId, supersededAt: null },
      orderBy: { validFrom: "desc" },
      take: 30,
      select: { kind: true, subject: true, fact: true },
    }),
    prisma.tutorMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "desc" }, take: HISTORY_MESSAGES }),
  ]);

  const context = buildContext({
    course,
    lesson,
    notebookPath: request.notebookPath,
    cells: request.cells,
    activeCell: request.activeCell,
    solution: request.solution,
    mode,
    state,
    memory,
    platformLanguage: request.platformLanguage,
  });
  const said = learnerTurn(request.kind, request.message, request.platformLanguage);
  const contents: Content[] = [
    ...history.reverse().map((message) => ({ role: message.role === "tutor" ? "model" : "user", parts: [{ text: message.content }] })),
    { role: "user", parts: [{ text: `<context>\n${context}\n</context>` }, { text: said }] },
  ];

  const result = await generateWithFallback({
    feature: "tutor",
    pool: "TUTOR",
    models: TUTOR_CHAIN,
    userId,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // Decomposing an objective and diagnosing a learner's code is worth a little thinking; LOW keeps it quick.
      thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel },
      maxOutputTokens: 4096,
    },
  });
  if (!result.ok) {
    if (result.reason === "quota") {
      return { ok: false, reason: "quota", message: "The tutor has used today's free allowance.", retryAt: result.retryAt.toISOString(), traceId: result.traceId };
    }
    return { ok: false, reason: "unavailable", message: "The tutor isn't available right now. Try again in a few minutes.", traceId: result.traceId };
  }

  // Apply the actions in order; one that breaks the rules is refused and kept in the record.
  const response = readResponse(result.text);
  const actions: AppliedAction[] = [];
  const memoryWrites: MemoryWrite[] = [];
  const practice: { skill: string; evidence: "PASSED" | "SKIPPED" }[] = [];
  for (const call of response.actions) {
    const applied = applyTool(state, call.tool, call.args);
    state = applied.state;
    actions.push(applied.action);
    if (applied.action.applied && applied.action.effect?.memory) memoryWrites.push(applied.action.effect.memory);
    if (applied.action.applied && applied.action.effect?.practice) practice.push(applied.action.effect.practice);
  }
  const refused = actions.filter((action) => !action.applied);
  if (refused.length) logAi("warn", { event: "tutor.refused", traceId: result.traceId, userId, refused });

  // The schema requires a reply; an empty one would only come from a model ignoring it.
  const reply = response.reply.trim() || (request.platformLanguage === "es" ? "Anotado. ¿Qué quieres hacer ahora?" : "Noted. What would you like to do next?");

  await prisma.$transaction([
    // Stored as the learner sees it in the panel; the model gets the same words with its instructions (`said`).
    prisma.tutorMessage.create({ data: { sessionId: session.id, role: "learner", kind: request.kind, content: shownToLearner(request) } }),
    prisma.tutorMessage.create({
      data: { sessionId: session.id, role: "tutor", kind: "reply", content: reply, actions: actions as unknown as Prisma.InputJsonArray, model: result.model, traceId: result.traceId },
    }),
    prisma.tutorSession.update({ where: { id: session.id }, data: { state: state as unknown as Prisma.InputJsonObject, lessonId: session.lessonId ?? lessonId } }),
    ...practice.map((entry) => prisma.practiceRequest.create({ data: { userId, skill: entry.skill, evidence: entry.evidence, lessonId, sessionId: session.id } })),
  ]);
  for (const write of memoryWrites) await remember(userId, session.id, write);

  return {
    ok: true,
    sessionId: session.id,
    reply,
    mode,
    objective: state.objective ?? null,
    steps: state.steps,
    unlocked: unlockedSteps(state),
    detours: state.detours.map((detour) => ({ skill: detour.skill, stage: detour.stage })),
    practiceOffers: actions.flatMap((action) => (action.applied && action.effect?.ended ? [action.effect.ended] : [])),
    actions,
    model: result.model,
    traceId: result.traceId,
  };
}

/** The learner pressed "practise this in a few days" after a detour: queued for the practice engine (milestone 10). */
export async function recordPractice(userId: string, sessionId: string, skill: string, evidence: "PASSED" | "SKIPPED") {
  const session = await prisma.tutorSession.findFirst({ where: { id: sessionId, userId }, select: { id: true, lessonId: true } });
  if (!session || !skill.trim()) return { ok: false as const };
  await prisma.practiceRequest.create({ data: { userId, skill: skill.trim().slice(0, 200), evidence, lessonId: session.lessonId, sessionId } });
  return { ok: true as const };
}

/** What the panel shows when it opens: the learner's mode, and the current session for this notebook, if any. */
export async function getTutorSession(userId: string, notebookPath: string) {
  const [profile, session] = await Promise.all([
    prisma.tutorProfile.findUnique({ where: { userId }, select: { mode: true } }),
    prisma.tutorSession.findFirst({
      where: { userId, notebookPath, updatedAt: { gt: new Date(Date.now() - SESSION_IDLE_MS) } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        state: true,
        messages: { orderBy: { createdAt: "asc" }, take: 60, select: { role: true, kind: true, content: true, createdAt: true } },
      },
    }),
  ]);
  const state = readState(session?.state);
  return {
    mode: profile?.mode ?? ("GUIDE" as TutorMode),
    session: session
      ? {
          id: session.id,
          objective: state.objective ?? null,
          steps: state.steps,
          unlocked: unlockedSteps(state),
          detours: state.detours.map((detour) => ({ skill: detour.skill, stage: detour.stage })),
          messages: session.messages,
        }
      : null,
  };
}

export async function setTutorMode(userId: string, mode: TutorMode) {
  await prisma.tutorProfile.upsert({ where: { userId }, create: { userId, mode }, update: { mode } });
}

/** The learner's turn as the panel shows it: their words, or the button they pressed. */
function shownToLearner(request: { kind: "ask" | "explain_error" | "suggest_fix"; message?: string; platformLanguage: "es" | "en" }): string {
  if (request.kind === "ask") return request.message?.trim() ?? "";
  const es = request.platformLanguage === "es";
  return request.kind === "explain_error" ? (es ? "Explícame este error." : "Explain this error.") : es ? "Sugiéreme un arreglo." : "Suggest a fix.";
}
