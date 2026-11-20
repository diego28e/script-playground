import { prisma } from "@/lib/prisma";
import { logAi } from "@/lib/ai/gemini";

// The voice spend ledger (docs/voice-spend.md): one ProviderCharge row per billable call to ElevenLabs or Deepgram,
// written by whatever made the call, the moment it returns. Admin → Spend reads it beside what each provider reports
// for the platform's own key (lib/spend/providers.ts): a call the provider saw and the ledger didn't is one the
// platform's code didn't make.

export const PROVIDERS = ["elevenlabs", "deepgram"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * What a call was for. `tag` is sent with every Deepgram call (its `tag` parameter), so Deepgram's own request log says
 * which workload each call was, browser streams included; a call by the platform's key without one of these tags is
 * one the platform didn't make (or made before tagging started).
 */
export const WORKLOADS = {
  "lesson-audio.voice": { label: "Lesson audio: voicing", tag: "adc-lesson-audio-voice" },
  "lesson-audio.preview": { label: "Lesson audio: voice samples", tag: "adc-lesson-audio-preview" },
  "lesson-audio.timing": { label: "Lesson audio: timing the transcript", tag: "adc-lesson-audio-timing" },
  "lesson-tutor.speak": { label: "Lesson tutor: answers read aloud", tag: "adc-lesson-tutor-speak" },
  "lesson-tutor.listen": { label: "Lesson tutor: microphone", tag: "adc-lesson-tutor-listen" },
  "captions.transcribe": { label: "Video captions: transcription", tag: "adc-captions" },
  "tutor.speak": { label: "Tutor: replies read aloud", tag: "adc-tutor-speak" },
  "tutor.listen": { label: "Tutor: microphone", tag: "adc-tutor-listen" },
  "practice.listen": { label: "Practice: explanations dictated", tag: "adc-practice-listen" },
} as const;
export type Workload = keyof typeof WORKLOADS;

export const workloadOfTag = (tag: string | null | undefined): Workload | null =>
  (Object.entries(WORKLOADS).find(([, entry]) => entry.tag === tag)?.[0] as Workload | undefined) ?? null;

/**
 * ElevenLabs plan credits per character, by model, for a call whose response didn't say what it cost. Each response's
 * `character-cost` header says it exactly, and the ledger keeps it (detail.characterCost). Measured on this account on
 * 2026-11-20: Eleven v4 0.485 (33,731 credits for a 69,567-character lesson in 22 pieces), Flash v2.5 0.243 (five
 * spoken answers, 323 credits for 1,327 characters).
 */
export const CREDITS_PER_CHARACTER: Record<string, number> = { eleven_v4: 0.49, eleven_flash_v2_5: 0.25 };
const DEFAULT_CREDITS_PER_CHARACTER = 0.5;

/** An ElevenLabs charge's credits: what the provider's response said, else estimated from its characters. */
export function chargeCredits(charge: { status: string; model: string | null; characters: number; detail: unknown }): { credits: number; exact: boolean } {
  if (charge.status !== "ok") return { credits: 0, exact: true };
  const said = Number((charge.detail as { characterCost?: unknown } | null)?.characterCost);
  if (Number.isFinite(said) && said > 0) return { credits: said, exact: true };
  return { credits: Math.round(charge.characters * (CREDITS_PER_CHARACTER[charge.model ?? ""] ?? DEFAULT_CREDITS_PER_CHARACTER)), exact: false };
}

/**
 * List prices in US$ per unit, for estimates when a call is made. What was billed comes from the provider:
 *   - ElevenLabs: this account's plan bills credits (above); its own report put a US$ figure on them, US$2.03 for 9,235
 *     credits and US$7.11 for 37,950 (2026-11-19/20). Estimates use 0.21 per 1,000 characters until the month's own
 *     report gives the real rate.
 *   - Deepgram: deepgram.com/pricing (2026-11-06): Aura-2 US$0.030 per 1,000 characters, Nova-3 multilingual US$0.0092
 *     a minute, Flux multilingual US$0.0078 a minute.
 */
export const LIST_PRICES = {
  elevenlabsPer1000: 0.21,
  // Flash v2.5 (the lesson tutor's spoken answers) costs half a credit a character.
  elevenlabsFlashPer1000: 0.105,
  deepgramSpeakPer1000: 0.03,
  deepgramNovaPerMinute: 0.0092,
  // Pre-recorded, one language: Nova-3 monolingual US$0.0048 a minute; captions add keyterms, US$0.0013 a minute.
  deepgramNovaMonoPerMinute: 0.0048,
  deepgramNovaMonoKeytermsPerMinute: 0.0061,
  deepgramFluxPerMinute: 0.0078,
} as const;

export const toMicros = (usd: number) => Math.round(usd * 1_000_000);

export type ChargeInput = {
  provider: Provider;
  workload: Workload;
  model?: string | null;
  ok: boolean;
  characters?: number;
  audioSeconds?: number | null;
  estimatedUsd?: number;
  requestId?: string | null;
  runtime: "platform" | "worker" | "lab";
  userId?: string | null;
  courseId?: string | null;
  lessonId?: string | null;
  audioId?: string | null;
  videoPartId?: string | null;
  voice?: string | null;
  detail?: Record<string, unknown>;
};

/** Writes one charge. Never throws: losing a ledger row must never fail the work that was paid for. */
export async function recordCharge(input: ChargeInput): Promise<void> {
  try {
    await prisma.providerCharge.create({
      data: {
        provider: input.provider,
        workload: input.workload,
        model: input.model ?? null,
        status: input.ok ? "ok" : "failed",
        characters: Math.max(0, Math.round(input.characters ?? 0)),
        audioSeconds: input.audioSeconds ?? null,
        estimatedMicros: input.ok ? toMicros(input.estimatedUsd ?? 0) : 0,
        requestId: input.requestId ?? null,
        runtime: input.runtime,
        userId: input.userId ?? null,
        courseId: input.courseId ?? null,
        lessonId: input.lessonId ?? null,
        audioId: input.audioId ?? null,
        videoPartId: input.videoPartId ?? null,
        voice: input.voice ?? null,
        detail: input.detail ? JSON.parse(JSON.stringify(input.detail)) : undefined,
      },
    });
  } catch (error) {
    logAi("error", { event: "spend.charge.lost", provider: input.provider, workload: input.workload, requestId: input.requestId, error: String(error) });
  }
}
