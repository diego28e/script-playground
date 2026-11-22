"use server";

import { prisma } from "@/lib/prisma";
import { courseVisibleTo } from "@/lib/course-access";
import { currentViewer } from "@/lib/viewer";
import { deleteConversation, listConversations, readConversation, type ConversationMessage, type ConversationSummary, type Scope } from "@/lib/voice/conversations";
import { forgetProfile, profileFor } from "@/lib/voice/profile";

// A learner's own conversations with the voice teachers (docs/voice-context.md): the list for a lesson or a course's
// practice, one conversation's messages, and deleting one. Reading and deleting only: turns are written by the lab's
// learning service, which answers them (lib/voice/turn.ts).

/** What a conversation is about: a lesson ("Ask the teacher") or a course's practice ("Talk it through"). */
export type VoiceScope = { kind: "lesson"; lessonId: string } | { kind: "practice"; courseSlug: string };

/** A conversation left this recently is picked up again when the sheet opens; an older one waits in the history. */
const RESUME_MS = 6 * 60 * 60_000;

async function scopeFor(scope: VoiceScope): Promise<Scope | null> {
  const viewer = await currentViewer();
  if (!viewer) return null;
  if (scope.kind === "lesson") {
    const lesson = await prisma.lesson.findFirst({ where: { id: scope.lessonId, module: { course: { status: "PUBLISHED", ...courseVisibleTo(viewer) } } }, select: { module: { select: { courseId: true } } } });
    return lesson ? { userId: viewer.id, kind: "lesson", courseId: lesson.module.courseId, lessonId: scope.lessonId } : null;
  }
  const course = await prisma.course.findFirst({ where: { slug: scope.courseSlug, status: "PUBLISHED", ...courseVisibleTo(viewer) }, select: { id: true } });
  return course ? { userId: viewer.id, kind: "practice", courseId: course.id, lessonId: null } : null;
}

export type VoiceHistory = {
  /** The conversation to pick up again, with its messages, when one was left recently. */
  resume: { id: string; messages: ConversationMessage[] } | null;
  conversations: ConversationSummary[];
};

/** What the voice sheet shows when it opens: the conversation to continue, if any, and the earlier ones. */
export async function getVoiceHistory(scope: VoiceScope): Promise<VoiceHistory> {
  try {
    const resolved = await scopeFor(scope);
    if (!resolved) return { resume: null, conversations: [] };
    const conversations = await listConversations(resolved);
    const latest = conversations[0];
    const recent = latest && Date.now() - new Date(latest.updatedAt).getTime() < RESUME_MS ? await readConversation(resolved.userId, latest.id) : null;
    return { resume: recent ? { id: recent.id, messages: recent.messages } : null, conversations };
  } catch {
    // The table isn't there yet (a deploy ahead of its migration), or the database is away: the sheet still talks.
    return { resume: null, conversations: [] };
  }
}

/** One of the learner's conversations, to read again or go on with. */
export async function getVoiceConversation(conversationId: string): Promise<{ id: string; messages: ConversationMessage[] } | null> {
  const viewer = await currentViewer();
  if (!viewer) return null;
  const found = await readConversation(viewer.id, conversationId).catch(() => null);
  return found ? { id: found.id, messages: found.messages } : null;
}

export async function deleteVoiceConversation(conversationId: string): Promise<{ success: boolean }> {
  const viewer = await currentViewer();
  if (!viewer) return { success: false };
  return { success: await deleteConversation(viewer.id, conversationId).catch(() => false) };
}

/** What the voice teachers keep about the learner, for this course (docs/voice-context.md, "The learner profile"). */
export async function getVoiceProfile(scope: VoiceScope): Promise<{ general: string | null; course: string | null; updatedAt: string | null }> {
  const empty = { general: null, course: null, updatedAt: null };
  try {
    const resolved = await scopeFor(scope);
    return resolved ? await profileFor(resolved.userId, resolved.courseId) : empty;
  } catch {
    return empty;
  }
}

/** Forgets what the voice teachers keep about the learner: how they learn, and what they know in this course. */
export async function forgetVoiceProfile(scope: VoiceScope): Promise<{ success: boolean }> {
  const resolved = await scopeFor(scope).catch(() => null);
  if (!resolved) return { success: false };
  await forgetProfile(resolved.userId, resolved.courseId);
  return { success: true };
}
