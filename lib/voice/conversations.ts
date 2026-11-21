import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUDGET, clip, titleOf, type StoredMessage, type VoiceRole, type VoiceStatus } from "@/lib/voice/context";

// Where the voice teachers' conversations are kept (docs/voice-context.md): `voice_conversation` and `voice_message`.
// The server owns a conversation: a turn names it by id, and what the model is given comes from these rows, never from
// what a browser says was said. A conversation belongs to one learner and one scope: a lesson (the lesson tutor) or a
// course's practice (the practice coach).

export type VoiceKind = "lesson" | "practice";
export type Scope = { userId: string; kind: VoiceKind; courseId: string; lessonId: string | null };

export type OpenConversation = { id: string; summary: string | null; summarySeq: number; messageCount: number; isNew: boolean };

/** The conversation a turn continues, if it is this learner's and of this scope; a new one otherwise (or when none is named). */
export async function openConversation(scope: Scope, conversationId: string | null): Promise<OpenConversation> {
  if (conversationId) {
    const found = await prisma.voiceConversation.findFirst({
      where: { id: conversationId, userId: scope.userId, kind: scope.kind, courseId: scope.courseId, lessonId: scope.lessonId },
      select: { id: true, summary: true, summarySeq: true, messageCount: true },
    });
    if (found) return { ...found, isNew: false };
  }
  const created = await prisma.voiceConversation.create({
    data: { userId: scope.userId, kind: scope.kind, courseId: scope.courseId, lessonId: scope.lessonId },
    select: { id: true, summary: true, summarySeq: true, messageCount: true },
  });
  return { ...created, isNew: true };
}

const asMessage = (row: { seq: number; role: string; text: string; status: string }): StoredMessage => ({
  seq: row.seq,
  role: row.role === "teacher" ? "teacher" : "learner",
  text: row.text,
  status: row.status === "interrupted" || row.status === "failed" ? row.status : "ok",
});

/** The messages the summary doesn't cover yet, oldest first: what a turn sends word for word. */
export async function openMessages(conversationId: string, summarySeq: number): Promise<StoredMessage[]> {
  const rows = await prisma.voiceMessage.findMany({ where: { conversationId, seq: { gt: summarySeq } }, orderBy: { seq: "asc" }, select: { seq: true, role: true, text: true, status: true } });
  return rows.map(asMessage);
}

/**
 * Adds a message and returns its place in the conversation. The place comes from the conversation's own counter,
 * raised in the same statement, so two messages can never take the same one.
 */
export async function appendMessage(conversationId: string, role: VoiceRole, text: string, status: VoiceStatus, meta: Prisma.InputJsonObject, title?: string): Promise<number> {
  const { messageCount: seq } = await prisma.voiceConversation.update({
    where: { id: conversationId },
    data: { messageCount: { increment: 1 }, ...(title ? { title } : {}) },
    select: { messageCount: true },
  });
  await prisma.voiceMessage.create({ data: { conversationId, seq, role, text: clip(text, BUDGET.messageChars * 3), status, meta } });
  return seq;
}

/** The learner cut the last reply off while it was read aloud: it's marked, so the teacher knows its end went unheard. */
export async function markLastReplyInterrupted(conversationId: string): Promise<void> {
  const last = await prisma.voiceMessage.findFirst({ where: { conversationId, role: "teacher" }, orderBy: { seq: "desc" }, select: { id: true, status: true } });
  if (last && last.status === "ok") await prisma.voiceMessage.update({ where: { id: last.id }, data: { status: "interrupted" } });
}

/** The compaction's result: the notes, and the last message they cover. Only ever moves forward. */
export async function saveSummary(conversationId: string, summary: string, summarySeq: number): Promise<void> {
  await prisma.voiceConversation.updateMany({ where: { id: conversationId, summarySeq: { lt: summarySeq } }, data: { summary, summarySeq } });
}

/** Earlier conversations of the same learner and scope, newest first, as one line each. */
export async function earlierTitles(scope: Scope, exceptId: string, take = 5): Promise<string[]> {
  const rows = await prisma.voiceConversation.findMany({
    where: { userId: scope.userId, kind: scope.kind, courseId: scope.courseId, lessonId: scope.lessonId, id: { not: exceptId }, title: { not: null }, messageCount: { gt: 1 } },
    orderBy: { updatedAt: "desc" },
    take,
    select: { title: true, updatedAt: true },
  });
  return rows.map((row) => `${row.title} (${row.updatedAt.toISOString().slice(0, 10)})`);
}

// --- For the learner's own view (actions/voice-conversations.ts) ------------------------------------------------------

export type ConversationSummary = { id: string; title: string; updatedAt: string; messages: number; at: number | null };
export type ConversationMessage = { seq: number; role: VoiceRole; text: string; status: VoiceStatus; at: number | null; createdAt: string };

/** A learner's conversations of one scope, newest first. */
export async function listConversations(scope: Scope, take = 30): Promise<ConversationSummary[]> {
  const rows = await prisma.voiceConversation.findMany({
    where: { userId: scope.userId, kind: scope.kind, courseId: scope.courseId, lessonId: scope.lessonId, messageCount: { gt: 0 } },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, title: true, updatedAt: true, messageCount: true, messages: { where: { role: "learner" }, orderBy: { seq: "asc" }, take: 1, select: { meta: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "…",
    updatedAt: row.updatedAt.toISOString(),
    messages: row.messageCount,
    at: momentOf(row.messages[0]?.meta),
  }));
}

/** The lesson's moment a learner's message was about, in seconds, when it has one. */
function momentOf(meta: unknown): number | null {
  const at = (meta as { at?: unknown } | null)?.at;
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/** One conversation's messages, for its owner: everything said, failed replies left out. */
export async function readConversation(userId: string, conversationId: string): Promise<{ id: string; kind: string; lessonId: string | null; courseId: string; messages: ConversationMessage[] } | null> {
  const row = await prisma.voiceConversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, kind: true, lessonId: true, courseId: true, messages: { where: { status: { not: "failed" } }, orderBy: { seq: "asc" }, select: { seq: true, role: true, text: true, status: true, meta: true, createdAt: true } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    lessonId: row.lessonId,
    courseId: row.courseId,
    messages: row.messages.map((message) => ({ ...asMessage(message), at: momentOf(message.meta), createdAt: message.createdAt.toISOString() })),
  };
}

/** Deletes a conversation of the learner's, with its messages. */
export async function deleteConversation(userId: string, conversationId: string): Promise<boolean> {
  const { count } = await prisma.voiceConversation.deleteMany({ where: { id: conversationId, userId } });
  return count > 0;
}

export { titleOf };
