import type { Content, ThinkingLevel } from "@google/genai";
import type { Prisma, TutorMode } from "@prisma/client";
import { z } from "zod";
import { TUTOR_CHAIN, chainStartingAt, generateWithFallback, logAi } from "@/lib/ai/gemini";
import { labGroups } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import { SYSTEM_PROMPT, buildContext, learnerTurn, type TurnContext } from "@/lib/tutor/prompt";
import { applyTool, readState, unlockedSteps, type AppliedAction, type MemoryWrite, type TutorState } from "@/lib/tutor/state";
import { replyStreamer, type ReplyEvent } from "@/lib/tutor/reply-stream";
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
  // The model to start the chain at (the panel's model list, which only admins get). Ignored for anyone else.
  model: z.string().max(100).optional(),
  // The learner said this out loud in the panel's voice conversation, and will hear the reply read aloud (docs/voice.md).
  spoken: z.boolean().optional(),
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
      // The model that answered, and the one the admin chose to start at, if any (the panel shows both).
      model: string;
      chosenModel: string | null;
      traceId: string;
    }
  | { ok: false; reason: "invalid" | "no-lab-access" | "quota" | "unavailable"; message: string; retryAt?: string; traceId?: string };

// A session ends after this long without a turn; the next question starts a new one (the memory stays).
const SESSION_IDLE_MS = 12 * 3600_000;
// The conversation the model sees, besides the context block: the latest exchanges of this session.
const HISTORY_MESSAGES = 12;

/** The models an admin can start the tutor at, in the chain's order: what the panel's model list shows. */
export const TUTOR_MODELS = TUTOR_CHAIN.map(({ model, label }) => ({ id: model, label }));

/**
 * Admins (the hub's lab-admin) may choose the model the tutor starts at, to compare models or skip one that is down.
 * Learners always get the chain as it is: the free models first, the paid one last, and no say in what it costs.
 */
function isLabAdmin(groups: string[]) {
  return groups.includes("lab-admin");
}

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

/**
 * One turn. With `onReply`, the reply is passed on while the model writes it (the panel shows it and reads it aloud
 * as it comes); the returned result, after the actions are applied and the exchange saved, is the same either way.
 */
export async function runTutorTurn(userId: string, input: TutorRequest, onReply?: (event: ReplyEvent) => void): Promise<TutorReply> {
  const parsed = TutorRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const request = parsed.data;
  if (request.activeCell >= request.cells.length) return { ok: false, reason: "invalid", message: "The active cell isn't in the notebook." };
  if (request.kind === "ask" && !request.message?.trim()) return { ok: false, reason: "invalid", message: "Write a question for the tutor." };

  // The lookups before the model, at once: each is a round trip to the database, and the learner is waiting. Access
  // is checked before anything is written (the mode) or sent to a model.
  const [groups, profile, { lessonId, course, lesson }, recent] = await Promise.all([
    labGroups(userId),
    prisma.tutorProfile.findUnique({ where: { userId } }),
    courseContext(userId, request.notebookPath),
    prisma.tutorSession.findFirst({
      where: { userId, notebookPath: request.notebookPath, updatedAt: { gt: new Date(Date.now() - SESSION_IDLE_MS) } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  // The tutor is part of the lab: the same people the hub admits.
  if (!groups.includes("lab")) {
    return { ok: false, reason: "no-lab-access", message: "The tutor is for learners enrolled in a course." };
  }
  const chosenModel = isLabAdmin(groups) && TUTOR_CHAIN.some((entry) => entry.model === request.model) ? request.model! : null;

  if (request.mode && request.mode !== profile?.mode) {
    await prisma.tutorProfile.upsert({ where: { userId }, create: { userId, mode: request.mode }, update: { mode: request.mode } });
  }
  const mode: TutorMode = request.mode ?? profile?.mode ?? "GUIDE";

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
  const said = learnerTurn(request.kind, request.message, request.platformLanguage, request.spoken === true);
  const contents: Content[] = [
    // The tutor's earlier replies in the shape it answers in: shown as plain text, a model in JSON mode follows the
    // history rather than the instructions and answers in plain text, which DeepSeek's JSON mode then blanks (an
    // empty answer, and the chain falls back to slower models). Their actions are in the session state already.
    ...history.reverse().map((message) =>
      message.role === "tutor"
        ? { role: "model", parts: [{ text: JSON.stringify({ actions: [], reply: message.content }) }] }
        : { role: "user", parts: [{ text: message.content }] },
    ),
    { role: "user", parts: [{ text: `<context>\n${context}\n</context>` }, { text: said }] },
  ];

  const result = await generateWithFallback({
    feature: "tutor",
    pool: "TUTOR",
    models: chainStartingAt(TUTOR_CHAIN, chosenModel ?? undefined),
    chosenFirst: chosenModel !== null,
    userId,
    contents,
    ...(onReply ? { onText: replyStreamer(onReply) } : {}),
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
    chosenModel,
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

/**
 * What the panel shows when it opens: the learner's mode, the current session for this notebook, if any, and for
 * admins the models they can start at (and which model wrote each reply).
 */
export async function getTutorSession(userId: string, notebookPath: string) {
  const [profile, session, groups] = await Promise.all([
    prisma.tutorProfile.findUnique({ where: { userId }, select: { mode: true } }),
    prisma.tutorSession.findFirst({
      where: { userId, notebookPath, updatedAt: { gt: new Date(Date.now() - SESSION_IDLE_MS) } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        state: true,
        messages: { orderBy: { createdAt: "asc" }, take: 60, select: { role: true, kind: true, content: true, model: true, createdAt: true } },
      },
    }),
    labGroups(userId),
  ]);
  const state = readState(session?.state);
  const admin = isLabAdmin(groups);
  return {
    mode: profile?.mode ?? ("GUIDE" as TutorMode),
    models: admin ? TUTOR_MODELS : null,
    session: session
      ? {
          id: session.id,
          objective: state.objective ?? null,
          steps: state.steps,
          unlocked: unlockedSteps(state),
          detours: state.detours.map((detour) => ({ skill: detour.skill, stage: detour.stage })),
          messages: session.messages.map(({ model, ...message }) => (admin ? { ...message, model } : message)),
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
