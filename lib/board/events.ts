import { after } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { learnFromBoardSummary } from "@/lib/voice/profile";
import { LESSON_TUTOR_CHAIN } from "@/lib/lesson-tutor/turn";
import { forgetPreference, PREFERENCE_CHARS, rememberPreference } from "@/lib/preferences";

// What Didactra tells the platform about a session (docs/whiteboard-contract.md, "The events"): it started, how long it
// has run and what it cost, how it ended, and the preferences the learner gave. Each event has its own id, so one sent
// again is applied once (a preference's answer is kept, and sent again with it).

const line = z.string().trim().min(1).max(400);

// Something from the board for the learner's spaced practice (docs/whiteboard-contract.md, "practice"): the narrow
// skill in the teacher's words, why it goes there, what happened, and the board's challenge, which the practice tasks
// are written in the spirit of.
const PracticeItem = z.object({
  skill: z.string().trim().min(3).max(200),
  why: z.enum(["struggled", "asked", "new"]).default("new"),
  happened: z.string().trim().max(600).optional(),
  challenge: z.string().trim().max(1500).optional(),
});
type PracticeItem = z.infer<typeof PracticeItem>;
/** The most a board sends to practice: each one costs a model call to resolve and, the first time, a task to write. */
export const BOARD_PRACTICE_MAX = 6;

const Summary = z.object({
  taught: z.array(line).max(12).default([]),
  learnerDid: z.array(line).max(12).default([]),
  struggles: z.array(line).max(12).default([]),
  readyToPractise: z.boolean().default(false),
  profileNotes: z.array(line).max(8).default([]),
  // The board's checklist at the end (docs/whiteboard-teaching.md §3).
  objectives: z.array(z.object({ text: line, met: z.boolean(), untickedByLearner: z.boolean().default(false) })).max(6).default([]),
  // What the board picked for the learner's practice, hardest first (at most 5).
  practice: z.array(PracticeItem).max(5).default([]),
});

const base = { id: z.string().trim().min(1).max(80), at: z.number().int().positive() };
const usage = { minutes: z.number().min(0).max(24 * 60), costUsd: z.number().min(0).max(1_000), model: z.string().max(80).optional(), voice: z.string().max(80).optional() };

export const BoardEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("started"), didactraSession: z.string().trim().min(1).max(64) }),
  z.object({ ...base, type: z.literal("usage"), ...usage }),
  z.object({ ...base, type: z.literal("ended"), ...usage, summary: Summary }),
  z.object({
    ...base,
    type: z.literal("preference"),
    action: z.enum(["remember", "forget"]),
    scope: z.enum(["all", "board"]).default("all"),
    text: z.string().trim().max(PREFERENCE_CHARS * 2).optional(),
    preferenceId: z.string().trim().max(40).optional(),
  }),
  // The learner asked, during the lesson, to practise something later ("add this to my practice").
  z.object({ ...base, type: z.literal("practice"), ...PracticeItem.shape, why: z.enum(["struggled", "asked", "new"]).default("asked") }),
]);
export type BoardEvent = z.infer<typeof BoardEvent>;

type BoardRow = { id: string; userId: string; lessonId: string; skillKey: string | null };
const sameSkill = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Stores one practice request from a board, waiting to be resolved on the learner's next practice visit
 * (lib/practice/tutor-requests.ts): to a course skill, or a narrow skill made for it. Not twice for the same words on
 * the same board, and not past BOARD_PRACTICE_MAX a board.
 */
async function requestPractice(session: BoardRow, item: PracticeItem): Promise<{ requested: boolean; reason?: "duplicate" | "limit" }> {
  const earlier = await prisma.practiceRequest.findMany({ where: { userId: session.userId, sessionId: session.id }, select: { skill: true } });
  if (earlier.some((row) => sameSkill(row.skill, item.skill))) return { requested: false, reason: "duplicate" };
  if (earlier.length >= BOARD_PRACTICE_MAX) return { requested: false, reason: "limit" };
  await prisma.practiceRequest.create({
    data: {
      userId: session.userId,
      skill: item.skill,
      evidence: "REQUESTED",
      lessonId: session.lessonId,
      sessionId: session.id,
      detail: { source: "whiteboard", boardSkill: session.skillKey, why: item.why, happened: item.happened ?? null, challenge: item.challenge ?? null } as Prisma.InputJsonObject,
    },
  });
  return { requested: true };
}

export type Applied = "applied" | "duplicate" | "missing" | "closed";
/** What applying an event came to, and the answer's body when it has one (a preference). */
export type AppliedEvent = { outcome: Applied; body?: Record<string, unknown> };

/**
 * Applies one event to a session. Totals only grow (a usage event that arrives after a later one changes nothing).
 * Once Didactra has ended a session (its summary is in), it takes no more events. A session the learner closed with
 * "New board" still takes its usage and its "ended", which often arrive after: the board was still open in Didactra.
 */
export async function applyBoardEvent(sid: string, event: BoardEvent): Promise<AppliedEvent> {
  const session = await prisma.boardSession.findUnique({ where: { id: sid }, select: { id: true, userId: true, courseId: true, lessonId: true, skillKey: true, language: true, status: true, minutes: true, costUsd: true, summary: true, endedAt: true } });
  if (!session) return { outcome: "missing" };
  let logged: { id: string };
  try {
    logged = await prisma.boardSessionEvent.create({ data: { sessionId: sid, eventId: event.id, type: event.type }, select: { id: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const first = await prisma.boardSessionEvent.findUnique({ where: { sessionId_eventId: { sessionId: sid, eventId: event.id } }, select: { result: true } });
      return { outcome: "duplicate", ...(first?.result ? { body: first.result as Record<string, unknown> } : {}) };
    }
    throw error;
  }
  const summarised = session.summary !== null;
  if (summarised || (session.status === "ENDED" && event.type === "started")) return { outcome: "closed" };

  const at = new Date(event.at);
  if (event.type === "started") {
    await prisma.boardSession.update({ where: { id: sid }, data: { didactraSession: event.didactraSession, startedAt: at } });
    return { outcome: "applied" };
  }
  if (event.type === "preference") {
    // The platform files the line itself (lib/preferences.ts fileScope): the scope sent is a hint.
    const body =
      event.action === "remember"
        ? await rememberPreference({ userId: session.userId, text: event.text ?? "", scope: event.scope, source: "board", sessionId: sid }).then((kept) => ({ preferenceId: kept?.id ?? null, scope: kept?.scope ?? event.scope }))
        : await forgetPreference(session.userId, { id: event.preferenceId, text: event.text }).then((id) => ({ preferenceId: id }));
    await prisma.boardSessionEvent.update({ where: { id: logged.id }, data: { result: body } });
    return { outcome: "applied", body };
  }
  if (event.type === "practice") {
    const body = await requestPractice(session, event);
    await prisma.boardSessionEvent.update({ where: { id: logged.id }, data: { result: body } });
    return { outcome: "applied", body };
  }
  const totals = {
    minutes: Math.max(session.minutes, event.minutes),
    costUsd: Math.max(session.costUsd, event.costUsd),
    ...(event.model ? { model: event.model } : {}),
    ...(event.voice ? { voice: event.voice } : {}),
  };
  if (event.type === "usage") {
    await prisma.boardSession.update({ where: { id: sid }, data: totals });
    return { outcome: "applied" };
  }

  const summary = event.summary;
  await prisma.boardSession.update({ where: { id: sid }, data: { ...totals, status: "ENDED", endedAt: session.endedAt ?? at, summary: summary as Prisma.InputJsonObject } });
  // Ready to practise: the skill goes first in the learner's practice, as when the lab's tutor asks for it
  // (lib/practice/tutor-requests.ts); it's resolved here already, since the skill is the course's own.
  if (summary.readyToPractise && session.skillKey) {
    await prisma.practiceRequest.create({
      data: {
        userId: session.userId,
        skill: session.skillKey,
        evidence: "REQUESTED",
        lessonId: session.lessonId,
        sessionId: sid,
        detail: { source: "whiteboard", boardSession: sid, taught: summary.taught, struggles: summary.struggles } as Prisma.InputJsonObject,
        resolution: "course",
        resolvedKey: session.skillKey,
        resolvedAt: new Date(),
      },
    });
  }
  // What the board picked for practice, and every objective the learner unticked (they said it isn't there yet), each
  // a request for the learner's next practice visit to resolve. In order: the board's own picks first.
  const unticked = summary.objectives.filter((objective) => objective.untickedByLearner).map((objective) => objective.text);
  const picks: PracticeItem[] = [
    ...summary.practice,
    ...unticked.filter((text) => !summary.practice.some((item) => sameSkill(item.skill, text))).map((text) => ({ skill: text.slice(0, 200), why: "struggled" as const, happened: "The learner unticked it on the board's checklist." })),
  ];
  for (const item of picks) await requestPractice(session, item);
  // What the session showed about how this learner learns and what they know joins their profile, after the answer.
  // An objective the learner unticked is something they found hard, whatever the teacher thought.
  const struggles = [...summary.struggles, ...unticked.filter((text) => !summary.struggles.includes(text))];
  after(() => learnFromBoardSummary(session.userId, session.courseId, session.language === "es" ? "es" : "en", { ...summary, struggles }, LESSON_TUTOR_CHAIN));
  return { outcome: "applied" };
}
