import { readSetting } from "@/lib/settings";
import { LIST_PRICES, recordCharge, WORKLOADS, type Workload } from "@/lib/spend/charges";
import { SPEAK_SAMPLE_RATE, speakStream, type VoiceLanguage } from "@/lib/voice/deepgram";
import { DEFAULT_EXPLAINER_VOICE, DEFAULT_POCKET_VOICE, engineOf, isExplainerVoice, pocketName, SPANISH_EXPLAINER_VOICE, SPANISH_POCKET_VOICE } from "@/lib/voice/explainer-voices";
import { pocketConfigured, speakPocket } from "@/lib/voice/pocket";
import { DEFAULT_SPEAK_SPEED } from "@/lib/voice/speed";

// The AI explainers' voice (docs/voice.md, "The explainer's voice"): the lesson tutor, the practice coach and the lab's
// tutor all read their replies aloud through here, in one voice an admin chooses in Admin → Audio. The engine is
// Deepgram Flux TTS (`/v2/speak`), its current model: it paces and pauses like a person talking, where Aura-2 read
// evenly and fast. Aura-2 stays as the fallback, so a reply is still read if Flux refuses a request. Pocket TTS, which
// runs on the lab server for free (lib/voice/pocket.ts), is a choice of its own and the last fallback: it reads a reply
// when Deepgram can't (no key, no credit, down), and Deepgram reads it when a chosen Pocket voice can't.
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
  const chosen = await explainerVoice();
  // The engine the admin chose (Admin → Audio). Each falls back to the other, so a reply is read while either works:
  // Pocket TTS first when it's chosen, else Flux, then Aura-2, then Pocket TTS (when Deepgram refuses, for example
  // because its credit ran out).
  if (engineOf(chosen) === "pocket" && pocketConfigured(language)) {
    try {
      return await speakPocket(text, language, pocketName(language === "es" ? SPANISH_POCKET_VOICE : chosen), signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error(JSON.stringify({ event: "voice.pocket_failed", voice: chosen, error: String(error).slice(0, 200) }));
    }
  }
  try {
    return await speakDeepgram(text, language, signal, context, engineOf(chosen) === "flux" ? chosen : DEFAULT_EXPLAINER_VOICE);
  } catch (error) {
    if (signal?.aborted || engineOf(chosen) === "pocket" || !pocketConfigured(language)) throw error;
    console.error(JSON.stringify({ event: "voice.deepgram_failed", error: String(error).slice(0, 200) }));
    return speakPocket(text, language, pocketName(language === "es" ? SPANISH_POCKET_VOICE : DEFAULT_POCKET_VOICE), signal);
  }
}

/** Deepgram's two voices in turn: Flux, then Aura-2 if Flux refuses or doesn't start. Throws if neither reads it. */
async function speakDeepgram(
  text: string,
  language: VoiceLanguage,
  signal: AbortSignal | undefined,
  context: { workload: SpeakWorkload; speed?: number; userId?: string | null; courseId?: string | null; lessonId?: string | null },
  englishVoice: string,
): Promise<ReadableStream<Uint8Array>> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  const voice = language === "es" ? SPANISH_EXPLAINER_VOICE : englishVoice;
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
