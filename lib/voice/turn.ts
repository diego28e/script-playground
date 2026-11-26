import type { ThinkingLevel } from "@google/genai";
import type { Prisma } from "@prisma/client";
import { generateWithFallback, logAi, type AiFeature, type ModelEntry, type Tokens } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { assemble, compactionCut, fitSummary, summaryRequest, SUMMARY_SYSTEM, titleOf, turnsFor, type ContextSizes, type StoredMessage } from "@/lib/voice/context";
import { appendMessage, earlierTitles, markLastReplyInterrupted, openConversation, openMessages, saveSummary, type Scope } from "@/lib/voice/conversations";
import { learnFromConversation, learnFromLeftConversations, readProfile } from "@/lib/voice/profile";
import { teacherPreferences } from "@/lib/preferences";

// One turn of a stored conversation with a voice teacher (docs/voice-context.md): the lesson tutor and the practice
// coach both go through here. The caller brings what only it knows (who the model is, what it teaches from, what is
// happening right now); this builds the rest of the context from the stored conversation (lib/voice/context.ts), asks
// the model, stores both sides of the turn with what the context weighed, and compacts the conversation when it has
// grown.

export type TurnEvent = { type: "delta"; text: string } | { type: "reset" } | { type: "conversation"; id: string };

export type VoiceTurnResult =
  | { ok: true; reply: string; model: string; traceId: string; conversationId: string }
  | { ok: false; reason: "quota" | "unavailable"; conversationId: string };

/**
 * The profile as a conversation first read it, kept for the rest of that conversation: the profile is rewritten in the
 * background every few exchanges, and a change in the system instruction would cost every later turn its cache. What
 * the profile learns reaches the next conversation; this one has its own note (compaction). Lost on a restart, which
 * only costs one re-read.
 */
const profiles = new Map<string, { at: number; value: Promise<string | null> }>();
const PROFILE_KEEP_MS = 6 * 60 * 60_000;

/** The learner's own instructions, read once a conversation like the profile, for the same reason (the cache). */
const preferenceCache = new Map<string, { at: number; value: Promise<string[] | null> }>();

function preferencesFor(conversationId: string, read: () => Promise<string[] | null>): Promise<string[] | null> {
  const hit = preferenceCache.get(conversationId);
  if (hit && Date.now() - hit.at < PROFILE_KEEP_MS) return hit.value;
  const value = read();
  preferenceCache.set(conversationId, { at: Date.now(), value });
  if (preferenceCache.size > 500) preferenceCache.delete(preferenceCache.keys().next().value as string);
  return value;
}

function profileFor(conversationId: string, read: () => Promise<string | null>): Promise<string | null> {
  const hit = profiles.get(conversationId);
  if (hit && Date.now() - hit.at < PROFILE_KEEP_MS) return hit.value;
  const value = read();
  profiles.set(conversationId, { at: Date.now(), value });
  if (profiles.size > 500) profiles.delete(profiles.keys().next().value as string);
  return value;
}

export async function runVoiceTurn(input: {
  scope: Scope;
  /** The conversation to continue, or null to start one. */
  conversationId: string | null;
  question: string;
  language: "es" | "en";
  /** Layer 1: who the model is and how it teaches. */
  role: string;
  /** Layer 2: the course and the lesson it teaches from. */
  grounding: string;
  /** What is happening right now: sent last, with the learner's message. */
  situation: string;
  /** Kept with the learner's message: spoken or typed, the lesson's moment, the task on screen. */
  learnerMeta: Prisma.InputJsonObject;
  /** The learner cut the previous reply off while it was read aloud. */
  interruptedPrevious?: boolean;
  feature: AiFeature;
  models: ReadonlyArray<ModelEntry>;
  maxOutputTokens: number;
  onEvent?: (event: TurnEvent) => void;
  /** Whether the learner's browser has gone (it closed the request before the reply ended). */
  clientGone?: () => boolean;
}): Promise<VoiceTurnResult> {
  const { scope, language } = input;
  const conversation = await openConversation(scope, input.conversationId);
  input.onEvent?.({ type: "conversation", id: conversation.id });
  if (input.interruptedPrevious && !conversation.isNew) await markLastReplyInterrupted(conversation.id);

  // The stored turns the summary doesn't cover, and the titles of earlier conversations here: read before this turn's
  // own message is stored, so the new message is only ever sent once, as the question.
  // The learner profile too: what the teachers know about this learner from earlier conversations.
  const [open, digest, profile, preferences] = await Promise.all([
    conversation.isNew ? Promise.resolve([] as StoredMessage[]) : openMessages(conversation.id, conversation.summarySeq),
    earlierTitles(scope, conversation.id),
    profileFor(conversation.id, () => readProfile(scope.userId, scope.courseId, language).catch(() => null)),
    preferencesFor(conversation.id, () => teacherPreferences(scope.userId).catch(() => null)),
  ]);
  await appendMessage(conversation.id, "learner", input.question, "ok", input.learnerMeta, conversation.isNew ? titleOf(input.question) : undefined);

  const { system, sizes } = assemble({ role: input.role, grounding: input.grounding, profile, preferences, summary: conversation.summary, digest }, language);
  const turns = turnsFor(open, conversation.summarySeq, input.question, language, input.situation);
  const context: ContextSizes = { ...sizes, turns: turns.chars, situation: turns.situationChars, total: system.length + turns.chars + turns.situationChars };

  let attemptShown = -1;
  let shown = "";
  const result = await generateWithFallback({
    feature: input.feature,
    pool: "TUTOR",
    models: input.models,
    userId: scope.userId,
    contents: turns.contents,
    ...(input.onEvent
      ? {
          onText: (text: string, attempt: number) => {
            // Another model took over after the first had started: what was shown goes.
            if (attempt !== attemptShown || !text.startsWith(shown)) {
              if (shown) input.onEvent?.({ type: "reset" });
              attemptShown = attempt;
              shown = "";
            }
            if (text.length <= shown.length) return;
            input.onEvent?.({ type: "delta", text: text.slice(shown.length) });
            shown = text;
          },
        }
      : {}),
    config: { systemInstruction: system, thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: input.maxOutputTokens },
  });

  const measured = { context, messagesSent: turns.contents.length, shortened: turns.shortened, summarised: conversation.summarySeq };
  if (!result.ok) {
    await appendMessage(conversation.id, "teacher", "", "failed", { ...measured, reason: result.reason });
    return { ok: false, reason: result.reason === "quota" ? "quota" : "unavailable", conversationId: conversation.id };
  }
  const reply = result.text.trim();
  const seq = await appendMessage(conversation.id, "teacher", reply, input.clientGone?.() ? "interrupted" : "ok", { ...measured, model: result.model, traceId: result.traceId, tokens: tokensOf(result.tokens) });
  logAi("info", { event: "voice.turn", feature: input.feature, conversationId: conversation.id, seq, model: result.model, ...measured, tokens: result.tokens });

  // Compaction runs after the reply is on its way: the learner never waits for it, and a failure only means the next
  // turn sends a few more turns word for word and tries again.
  void compact(conversation.id, scope.userId, language, input.models).catch((error) => logAi("warn", { event: "voice.compact_failed", conversationId: conversation.id, error: String(error).slice(0, 300) }));
  // The profile learns from the conversation the same way, after the reply: every few exchanges, and, when a new
  // conversation starts, from what the learner's earlier ones still hold (lib/voice/profile.ts).
  void learnFromConversation(conversation.id, language, input.models);
  if (conversation.isNew) void learnFromLeftConversations(scope.userId, conversation.id, language, input.models).catch(() => undefined);
  return { ok: true, reply, model: result.model, traceId: result.traceId, conversationId: conversation.id };
}

const tokensOf = (tokens: Tokens | undefined): Prisma.InputJsonObject => (tokens ? { input: tokens.input, output: tokens.output, ...(tokens.cached !== undefined ? { cached: tokens.cached } : {}) } : {});

/**
 * Folds the older turns into the conversation's summary when enough have piled up (lib/voice/context.ts,
 * compactionCut). The turns stay stored; the summary only replaces them in what the model is given.
 */
export async function compact(conversationId: string, userId: string, language: "es" | "en", models: ReadonlyArray<ModelEntry>): Promise<boolean> {
  const conversation = await prisma.voiceConversation.findUnique({ where: { id: conversationId }, select: { summary: true, summarySeq: true } });
  if (!conversation) return false;
  const open = await openMessages(conversationId, conversation.summarySeq);
  const cut = compactionCut(open, conversation.summarySeq);
  if (cut === null) return false;
  const folded = open.filter((message) => message.seq <= cut);
  // Its own feature in the AI ledger, so a summary never counts against the learner's turns for the day.
  const result = await generateWithFallback({
    feature: "voice-summary",
    pool: "TUTOR",
    models,
    userId,
    contents: [{ role: "user", parts: [{ text: summaryRequest(conversation.summary, folded, language) }] }],
    config: { systemInstruction: SUMMARY_SYSTEM[language], thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: 1100, temperature: 0.2 },
  });
  if (!result.ok || !result.text.trim()) return false;
  // Stored already cut to each section's limit, in the fixed order: the next compaction rewrites a whole note, never
  // one that lost its end.
  const summary = fitSummary(result.text, language);
  await saveSummary(conversationId, summary, cut);
  logAi("info", { event: "voice.compacted", conversationId, upTo: cut, folded: folded.length, foldedChars: folded.reduce((sum, message) => sum + message.text.length, 0), writtenChars: result.text.trim().length, summaryChars: summary.length, model: result.model });
  return true;
}
