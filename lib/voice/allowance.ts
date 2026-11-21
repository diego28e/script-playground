import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { pacificDay } from "@/lib/ai/quota";
import { VOICE_MODELS, VOICE_PRICES } from "@/lib/voice/deepgram";
import { recordCharge } from "@/lib/spend/charges";

// A learner's voice, recorded (docs/voice.md, "Costs"): a row per stream started (the microphone turned on, or
// reconnected) and a row per reply read aloud, with its characters and list price, in ai_request beside every other AI
// call and in the spend ledger. Recorded, not limited: there is no daily cap of ours on Deepgram, for listening or for
// reading aloud. What Deepgram's account allows is the only limit.

/** One stream's length: the browser closes it after this long, so a tab left open doesn't listen all night. */
export const LISTEN_MAX_MINUTES = 10;

export async function recordListen(
  userId: string,
  mode: "conversation" | "dictation",
  feature: string,
  workload: "tutor.listen" | "lesson-tutor.listen" | "practice.listen" | "practice-coach.listen" = "tutor.listen",
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

/** A reply read aloud: its characters go in inputTokens, and a charge in the spend ledger with Deepgram's request id. */
export async function recordSpeak(userId: string, characters: number, feature: string, requestId: string | null = null, ledger = true) {
  // `ledger` false: whatever spoke it (lib/voice/explainer.ts) has already written its charge.
  if (ledger) await recordCharge({
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
