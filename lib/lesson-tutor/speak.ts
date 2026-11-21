import { prisma } from "@/lib/prisma";
import { LIST_PRICES, recordCharge } from "@/lib/spend/charges";
import { voiceProvider } from "@/lib/lesson-audio/voice";
import { DEFAULT_SPEAK_SPEED, SPEAK_SAMPLE_RATE, speakStream, type VoiceLanguage } from "@/lib/voice/deepgram";
import { lessonTutorOwnVoice, speakExplainer } from "@/lib/voice/explainer";

// The lesson tutor's answers read aloud (docs/lesson-tutor.md): in the explainers' voice by default, or, when an admin
// chooses it, in the voice that tells the lesson (the same teacher), as below.
// ElevenLabs voices speak through Flash v2.5, its quickest model (the first sound in well under a second; half the
// credits of v4), as raw PCM at SPEAK_SAMPLE_RATE, the format the browser's Speaker plays (lib/voice/browser.ts), and
// streamed as it's made. A Deepgram voice speaks through Aura-2, as the lab's tutor does.

export const ELEVEN_FLASH = "eleven_flash_v2_5";
/** A piece read aloud at most: the browser sends a few sentences at a time. */
export const SPEAK_MAX_CHARS = 1900;
/**
 * Characters a learner may have read aloud in 24 hours in a lesson's own ElevenLabs voice (at most about US$2.60 of
 * that account's credits). Only that voice is limited: the explainers' voice is Deepgram's, and has no cap of ours.
 */
export const ELEVEN_SPEAK_CHARS_PER_DAY = 25_000;

/**
 * Whether this piece may be read aloud. Always, unless an admin set the lesson tutor to answer in the lesson's own
 * recorded voice and that voice is ElevenLabs': those credits are the one thing rationed here.
 */
export async function canSpeakLesson(userId: string, characters: number, voice: string | null): Promise<boolean> {
  if (!voice || voiceProvider(voice) !== "elevenlabs" || !process.env.ELEVENLABS_API_KEY || !(await lessonTutorOwnVoice())) return true;
  const used = await prisma.providerCharge.aggregate({ where: { userId, provider: "elevenlabs", workload: "lesson-tutor.speak", createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } }, _sum: { characters: true } });
  return (used._sum.characters ?? 0) + characters <= ELEVEN_SPEAK_CHARS_PER_DAY;
}

/** The voice of the lesson's audio, or none (the tutor then speaks in Aura's voice for the language). */
export async function lessonVoice(lessonId: string): Promise<string | null> {
  const audio = await prisma.lessonAudio.findUnique({ where: { lessonId }, select: { audioVoice: true } });
  return audio?.audioVoice ?? null;
}

/**
 * Reads `text` aloud in `voice`: the audio as the provider makes it, to pass straight on. Records the charge with the
 * provider's id for the call, so Admin → Spend matches it. `signal` stops it.
 */
export async function speakLesson(
  text: string,
  voice: string | null,
  language: VoiceLanguage,
  signal: AbortSignal,
  context: { userId: string; lessonId: string; speed?: number },
): Promise<ReadableStream<Uint8Array>> {
  // The explainers' voice (lib/voice/explainer.ts), unless an admin set the lesson tutor to answer in the lesson's own
  // recorded voice (Admin → Audio), which for an ElevenLabs lesson spends that account's credits.
  if (!(await lessonTutorOwnVoice())) {
    return speakExplainer(text, language, signal, { workload: "lesson-tutor.speak", speed: context.speed, userId: context.userId, lessonId: context.lessonId });
  }
  // ElevenLabs takes 0.7 to 1.2 (elevenlabs.io/docs, "Pace"); Aura's own range is applied in speakStream.
  const speed = context.speed ?? DEFAULT_SPEAK_SPEED;
  const charge = { workload: "lesson-tutor.speak" as const, runtime: "lab" as const, userId: context.userId, lessonId: context.lessonId, voice, characters: text.length };
  const key = process.env.ELEVENLABS_API_KEY;
  if (voice && voiceProvider(voice) === "elevenlabs" && key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    signal.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=pcm_${SPEAK_SAMPLE_RATE}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: ELEVEN_FLASH, language_code: language, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, speed)) } }),
        signal: controller.signal,
      });
      const traceId = response.headers.get("x-trace-id");
      await recordCharge({
        ...charge,
        provider: "elevenlabs",
        model: ELEVEN_FLASH,
        ok: response.ok,
        estimatedUsd: (text.length / 1000) * LIST_PRICES.elevenlabsFlashPer1000,
        requestId: traceId,
        detail: response.ok ? { characterCost: response.headers.get("character-cost") } : { status: response.status },
      });
      if (!response.ok || !response.body) throw new Error(`ElevenLabs couldn't speak it (${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)})`);
      return response.body;
    } finally {
      clearTimeout(timer);
    }
  }
  // A Deepgram voice speaks as itself; anything else (an ElevenLabs voice with no key here) in Aura's voice for the language.
  const auraVoice = voice && voiceProvider(voice) === "deepgram" ? voice : undefined;
  const { audio, requestId } = await speakStream(text, language, signal, { voice: auraVoice, workload: "lesson-tutor.speak", speed });
  await recordCharge({ ...charge, provider: "deepgram", model: "aura-2", ok: true, estimatedUsd: (text.length / 1000) * LIST_PRICES.deepgramSpeakPer1000, requestId });
  return audio;
}
