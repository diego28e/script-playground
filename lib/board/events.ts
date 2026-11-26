import { after } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { learnFromBoardSummary } from "@/lib/voice/profile";
import { LESSON_TUTOR_CHAIN } from "@/lib/lesson-tutor/turn";

// What Didactra tells the platform about a session (docs/whiteboard-contract.md, "The events"): it started, how long it
// has run and what it cost, and how it ended. Each event has its own id, so one sent again is applied once.

const line = z.string().trim().min(1).max(400);

const Summary = z.object({
  taught: z.array(line).max(12).default([]),
  learnerDid: z.array(line).max(12).default([]),
  struggles: z.array(line).max(12).default([]),
  readyToPractise: z.boolean().default(false),
  profileNotes: z.array(line).max(8).default([]),
});

const base = { id: z.string().trim().min(1).max(80), at: z.number().int().positive() };
const usage = { minutes: z.number().min(0).max(24 * 60), costUsd: z.number().min(0).max(1_000), model: z.string().max(80).optional(), voice: z.string().max(80).optional() };

export const BoardEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("started"), didactraSession: z.string().trim().min(1).max(64) }),
  z.object({ ...base, type: z.literal("usage"), ...usage }),
  z.object({ ...base, type: z.literal("ended"), ...usage, summary: Summary }),
]);
export type BoardEvent = z.infer<typeof BoardEvent>;

export type Applied = "applied" | "duplicate" | "missing" | "closed";

/**
 * Applies one event to a session. Totals only grow (a usage event that arrives after a later one changes nothing).
 * Once Didactra has ended a session (its summary is in), it takes no more events. A session the learner closed with
 * "New board" still takes its usage and its "ended", which often arrive after: the board was still open in Didactra.
 */
export async function applyBoardEvent(sid: string, event: BoardEvent): Promise<Applied> {
  const session = await prisma.boardSession.findUnique({ where: { id: sid }, select: { id: true, userId: true, courseId: true, lessonId: true, skillKey: true, language: true, status: true, minutes: true, costUsd: true, summary: true, endedAt: true } });
  if (!session) return "missing";
  try {
    await prisma.boardSessionEvent.create({ data: { sessionId: sid, eventId: event.id, type: event.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }
  const summarised = session.summary !== null;
  if (summarised || (session.status === "ENDED" && event.type === "started")) return "closed";

  const at = new Date(event.at);
  if (event.type === "started") {
    await prisma.boardSession.update({ where: { id: sid }, data: { didactraSession: event.didactraSession, startedAt: at } });
    return "applied";
  }
  const totals = {
    minutes: Math.max(session.minutes, event.minutes),
    costUsd: Math.max(session.costUsd, event.costUsd),
    ...(event.model ? { model: event.model } : {}),
    ...(event.voice ? { voice: event.voice } : {}),
  };
  if (event.type === "usage") {
    await prisma.boardSession.update({ where: { id: sid }, data: totals });
    return "applied";
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
        detail: { source: "whiteboard", boardSession: sid, taught: summary.taught, struggles: summary.struggles } as Prisma.InputJsonObject,
        resolution: "course",
        resolvedKey: session.skillKey,
        resolvedAt: new Date(),
      },
    });
  }
  // What the session showed about how this learner learns and what they know joins their profile, after the answer.
  after(() => learnFromBoardSummary(session.userId, session.courseId, session.language === "es" ? "es" : "en", summary, LESSON_TUTOR_CHAIN));
  return "applied";
}
