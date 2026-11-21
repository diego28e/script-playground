import { readSetting } from "@/lib/settings";
import { LIST_PRICES, recordCharge, WORKLOADS, type Workload } from "@/lib/spend/charges";
import { SPEAK_SAMPLE_RATE, speakStream, type VoiceLanguage } from "@/lib/voice/deepgram";
import { DEFAULT_EXPLAINER_VOICE, isExplainerVoice, SPANISH_EXPLAINER_VOICE } from "@/lib/voice/explainer-voices";
import { DEFAULT_SPEAK_SPEED } from "@/lib/voice/speed";

// The AI explainers' voice (docs/voice.md, "The explainer's voice"): the lesson tutor, the practice coach and the lab's
// tutor all read their replies aloud through here, in one voice an admin chooses in Admin → Audio. The engine is
// Deepgram Flux TTS (`/v2/speak`), its current model: it paces and pauses like a person talking, where Aura-2 read
// evenly and fast. Aura-2 stays as the fallback, so a reply is still read if Flux refuses a request.
//
// Measured with this project's key on 2026-11-20, raw PCM at 24 kHz, one 656-character passage: the first audio in
// about 0.3 s (Aura-2: 0.5 s), then about 1.35 times faster than it plays; 40 to 42 s of speech at speed 1 and 46 to
// 49 s at 0.9 (it varies from one run to the next, with its pauses). 1,900 characters in one request worked.

const API = "https://api.deepgram.com";

/** Setting keys (lib/settings.ts). */
export const EXPLAINER_VOICE_KEY = "explainer.voice";
export const LESSON_OWN_VOICE_KEY = "explainer.lessonOwnVoice";

/** The voice an admin chose for the explainers, Hannah until one is chosen. */
export async function explainerVoice(): Promise<string> {
  const stored = await readSetting(EXPLAINER_VOICE_KEY);
  return isExplainerVoice(stored) ? stored : DEFAULT_EXPLAINER_VOICE;
}

/** Whether "Ask the teacher" on a lesson answers in the lesson's own recorded voice instead (off unless an admin turns it on). */
export async function lessonTutorOwnVoice(): Promise<boolean> {
  return (await readSetting(LESSON_OWN_VOICE_KEY)) === true;
}

/** A speed Flux TTS takes: 0.5 to 1.5 in steps of 0.05 (developers.deepgram.com/docs/tts-voice-controls). */
export function fluxSpeed(speed: number | undefined): number {
  const wanted = Number.isFinite(speed) ? (speed as number) : DEFAULT_SPEAK_SPEED;
  return Math.round(Math.min(1.5, Math.max(0.5, wanted)) * 20) / 20;
}

type SpeakWorkload = Extract<Workload, "tutor.speak" | "lesson-tutor.speak" | "practice-coach.speak">;

/**
 * Reads `text` aloud in the explainers' voice: raw 16-bit PCM at SPEAK_SAMPLE_RATE, streamed as it's made, the format
 * the browser's Speaker plays. Records the charge with Deepgram's id for the call. `signal` stops it.
 */
export async function speakExplainer(
  text: string,
  language: VoiceLanguage,
  signal: AbortSignal | undefined,
  context: { workload: SpeakWorkload; speed?: number; userId?: string | null; courseId?: string | null; lessonId?: string | null },
): Promise<ReadableStream<Uint8Array>> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  const voice = language === "es" ? SPANISH_EXPLAINER_VOICE : await explainerVoice();
  const charge = { provider: "deepgram" as const, workload: context.workload, runtime: "lab" as const, userId: context.userId, courseId: context.courseId, lessonId: context.lessonId, characters: text.length };

  // Only the start is timed: once the audio flows, a long reading takes as long as it takes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(
      `${API}/v2/speak?model=${voice}&encoding=linear16&sample_rate=${SPEAK_SAMPLE_RATE}&container=none&speed=${fluxSpeed(context.speed)}&tag=${WORKLOADS[context.workload].tag}`,
      { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal },
    );
    if (response.ok && response.body) {
      await recordCharge({ ...charge, model: "flux-tts", voice, ok: true, estimatedUsd: (text.length / 1000) * LIST_PRICES.deepgramFluxSpeakPer1000, requestId: response.headers.get("dg-request-id") });
      return response.body;
    }
    const problem = (await response.text().catch(() => "")).slice(0, 200);
    await recordCharge({ ...charge, model: "flux-tts", voice, ok: false, requestId: response.headers.get("dg-request-id"), detail: { status: response.status, problem } });
    console.error(JSON.stringify({ event: "voice.flux_refused", status: response.status, voice, problem }));
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error(JSON.stringify({ event: "voice.flux_failed", voice, error: String(error).slice(0, 200) }));
  } finally {
    clearTimeout(timer);
  }
  // Flux refused or didn't start: the reply is read by Aura-2 instead.
  const { audio, requestId } = await speakStream(text, language, signal, { workload: context.workload, speed: context.speed });
  await recordCharge({ ...charge, model: "aura-2", ok: true, estimatedUsd: (text.length / 1000) * LIST_PRICES.deepgramSpeakPer1000, requestId, detail: { fallbackFrom: "flux-tts" } });
  return audio;
}
