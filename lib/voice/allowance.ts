import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { pacificDay } from "@/lib/ai/quota";
import { VOICE_MODELS, VOICE_PRICES } from "@/lib/voice/deepgram";
import { recordCharge } from "@/lib/spend/charges";

// A learner's voice for the day (docs/voice.md, "Costs and limits"), counted in ai_request beside every other AI call:
// a row per stream started (the microphone turned on, or reconnected), and a row per reply read aloud, with its
// characters and list price. A stream's length isn't known when it starts, so streams are capped by count; each is
// also cut by the browser after LISTEN_MAX_MINUTES.

/** Streams a learner may start in a day: a conversation is one, however many messages it carries. */
export const LISTEN_STREAMS_PER_DAY = 60;
/** The browser closes a stream after this long, and the learner turns the microphone on again if they're still there. */
export const LISTEN_MAX_MINUTES = 10;
/** Characters read aloud a learner may ask for in a day (about 30 long replies). */
export const SPEAK_CHARS_PER_DAY = 30_000;

export async function canListen(userId: string): Promise<boolean> {
  const today = await prisma.aiRequest.count({ where: { userId, day: pacificDay(), model: { in: [VOICE_MODELS.conversation, VOICE_MODELS.dictation] } } });
  return today < LISTEN_STREAMS_PER_DAY;
}

export async function recordListen(
  userId: string,
  mode: "conversation" | "dictation",
  feature: string,
  workload: "tutor.listen" | "lesson-tutor.listen" | "practice.listen" = "tutor.listen",
  runtime: "lab" | "platform" = "lab",
) {
  // The price of one full-length stream: an upper bound, since most are much shorter.
  const perMinute = (mode === "conversation" ? VOICE_PRICES.fluxPerMinute : VOICE_PRICES.novaMultiPerMinute) + VOICE_PRICES.keytermsPerMinute;
  await prisma.aiRequest.create({
    data: { pool: "TUTOR", feature, model: VOICE_MODELS[mode], userId, status: "OK", day: pacificDay(), listCostMicros: perMinute * LISTEN_MAX_MINUTES, traceId: randomUUID() },
  });
  // The spend ledger (lib/spend/charges.ts): the stream's real length and cost are in Deepgram's request log, under the
  // stream's tag; this row is the upper bound, as above.
  await recordCharge({
    provider: "deepgram",
    workload,
    model: mode === "conversation" ? "flux-general-multi" : "nova-3",
    ok: true,
    estimatedUsd: (perMinute * LISTEN_MAX_MINUTES) / 1_000_000,
    runtime,
    userId,
    detail: { mode, upperBound: true },
  });
}

export async function canSpeak(userId: string, characters: number): Promise<boolean> {
  const used = await prisma.aiRequest.aggregate({ where: { userId, day: pacificDay(), model: VOICE_MODELS.speak }, _sum: { inputTokens: true } });
  return (used._sum.inputTokens ?? 0) + characters <= SPEAK_CHARS_PER_DAY;
}

/** A reply read aloud: its characters go in inputTokens, and a charge in the spend ledger with Deepgram's request id. */
export async function recordSpeak(userId: string, characters: number, feature: string, requestId: string | null = null) {
  await recordCharge({
    provider: "deepgram",
    workload: "tutor.speak",
    model: "aura-2",
    ok: true,
    characters,
    estimatedUsd: (characters / 1000) * (VOICE_PRICES.speakPer1000Chars / 1_000_000),
    requestId,
    runtime: "lab",
    userId,
  });
  await prisma.aiRequest.create({
    data: {
      pool: "TUTOR",
      feature,
      model: VOICE_MODELS.speak,
      userId,
      status: "OK",
      day: pacificDay(),
      inputTokens: characters,
      listCostMicros: Math.round((characters / 1000) * VOICE_PRICES.speakPer1000Chars),
      traceId: randomUUID(),
    },
  });
}
