"use server";

import { revalidatePath } from "next/cache";
import { writeSetting } from "@/lib/settings";
import { LIST_PRICES, recordCharge, WORKLOADS } from "@/lib/spend/charges";
import { currentViewer } from "@/lib/viewer";
import { EXPLAINER_VOICE_KEY, explainerVoice, fluxSpeed, LESSON_OWN_VOICE_KEY, lessonTutorOwnVoice } from "@/lib/voice/explainer";
import { engineOf, isExplainerVoice } from "@/lib/voice/explainer-voices";
import { issueSamplePass } from "@/lib/lesson-tutor/pass";
import { DEFAULT_SPEAK_SPEED } from "@/lib/voice/speed";

// Admin → Audio, "The AI explainers' voice" (docs/voice.md): which Deepgram Flux voice the lesson tutor, the practice
// coach and the lab's tutor read their replies in, and whether the lesson tutor keeps the lesson's own voice.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireAdmin() {
  const viewer = await currentViewer();
  return viewer?.role === "ADMIN" ? viewer : null;
}

/** `configured`: Flux samples can play here (Deepgram's key); `labConfigured`: the self-hosted samples can (the lab's address and secret). */
export type ExplainerVoiceSettings = { voice: string; lessonOwnVoice: boolean; speed: number; configured: boolean; labConfigured: boolean };

export async function getExplainerVoiceSettings(): Promise<ExplainerVoiceSettings | null> {
  if (!(await requireAdmin())) return null;
  return {
    voice: await explainerVoice(),
    lessonOwnVoice: await lessonTutorOwnVoice(),
    speed: DEFAULT_SPEAK_SPEED,
    configured: Boolean(process.env.DEEPGRAM_API_KEY),
    labConfigured: Boolean(process.env.LESSON_TUTOR_URL && process.env.LESSON_TUTOR_SECRET),
  };
}

export async function setExplainerVoice(voice: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Only admins can change the explainers' voice." };
  if (!isExplainerVoice(voice)) return { success: false, error: "That isn't one of the voices." };
  try {
    await writeSetting(EXPLAINER_VOICE_KEY, voice, admin.id);
    revalidatePath("/admin/audio");
    return { success: true };
  } catch {
    return { success: false, error: "The voice couldn't be saved. Try again." };
  }
}

export async function setLessonTutorOwnVoice(on: boolean): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Only admins can change the explainers' voice." };
  try {
    await writeSetting(LESSON_OWN_VOICE_KEY, Boolean(on), admin.id);
    revalidatePath("/admin/audio");
    return { success: true };
  } catch {
    return { success: false, error: "That couldn't be saved. Try again." };
  }
}

// Short on purpose: Flux makes speech only a little faster than it plays, and the whole sample is made before it's sent.
const SAMPLE = "Here's how I'd explain it: first what it is, then how it works, and then why it's built that way.";

/**
 * A short sample of a self-hosted voice: only the lab's learning service can reach Pocket TTS, so this server asks it,
 * with a one-minute pass, and gets a WAV file back. Free.
 */
async function previewLabVoice(voice: string, userId: string): Promise<Result<{ src: string }>> {
  const url = process.env.LESSON_TUTOR_URL?.replace(/\/+$/, "");
  const secret = process.env.LESSON_TUTOR_SECRET;
  if (!url || !secret) return { success: false, error: "The lab's address isn't set on the platform (LESSON_TUTOR_URL)." };
  try {
    const response = await fetch(`${url}/v1/lesson/sample`, {
      method: "POST",
      headers: { Authorization: `Pass ${issueSamplePass(secret, userId).pass}`, "Content-Type": "application/json" },
      body: JSON.stringify({ voice }),
      signal: AbortSignal.timeout(22_000),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as { message?: string } | null;
      return { success: false, error: problem?.message ?? `The lab answered ${response.status}.` };
    }
    return { success: true, src: `data:audio/wav;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}` };
  } catch {
    return { success: false, error: "The lab didn't answer in time. Try again." };
  }
}

/** A short sample of one voice, at the explainers' speed, as audio the page plays. */
export async function previewExplainerVoice(voice: string): Promise<Result<{ src: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Only admins can hear the samples." };
  if (!isExplainerVoice(voice)) return { success: false, error: "That isn't one of the voices." };
  if (engineOf(voice) === "pocket") return previewLabVoice(voice, admin.id);
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { success: false, error: "DEEPGRAM_API_KEY isn't set on the platform." };
  const charge = { provider: "deepgram" as const, workload: "lesson-audio.preview" as const, model: "flux-tts", characters: SAMPLE.length, runtime: "platform" as const, userId: admin.id, voice };
  try {
    const response = await fetch(`https://api.deepgram.com/v2/speak?model=${voice}&encoding=mp3&speed=${fluxSpeed(DEFAULT_SPEAK_SPEED)}&tag=${WORKLOADS["lesson-audio.preview"].tag}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: SAMPLE }),
      signal: AbortSignal.timeout(22_000),
    });
    const requestId = response.headers.get("dg-request-id");
    if (!response.ok) {
      await recordCharge({ ...charge, ok: false, requestId, detail: { status: response.status } });
      return { success: false, error: `Deepgram answered ${response.status}.` };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await recordCharge({ ...charge, ok: true, requestId, estimatedUsd: (SAMPLE.length / 1000) * LIST_PRICES.deepgramFluxSpeakPer1000 });
    return { success: true, src: `data:audio/mpeg;base64,${bytes.toString("base64")}` };
  } catch {
    await recordCharge({ ...charge, ok: false, detail: { error: "timeout" } });
    return { success: false, error: "Deepgram didn't answer in time. Try again." };
  }
}
