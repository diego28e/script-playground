import { createHmac } from "node:crypto";
import { VOICE_PRICES } from "@/lib/voice/deepgram";

// Voicing a lesson's script (docs/lesson-audio.md): Deepgram's Aura-2 reads it, at most 2,000 characters a request, as
// MP3 (22,050 Hz, 48 kb/s, constant bit rate). The pieces are joined into one file: each piece's metadata frames are
// taken out first (an ID3 tag, a Xing/Info frame), so the joined file is plain MP3 frames whose length every player
// reads right. The file goes to the media bucket through a short-lived upload address the platform hands out
// (app/api/lab-worker/audio-upload): the worker on the lab server holds no AWS credentials.

const API = "https://api.deepgram.com";
/** Aura-2 takes at most 2,000 characters a request. */
const CHUNK_CHARS = 1_900;
/**
 * Pieces sent at once for one lesson. Deepgram makes speech about four times faster than it plays, and doesn't always
 * work on pieces side by side (2026-11-19: three test pieces came back at 29 s, 61 s and 72 s; lesson 00.04's nine
 * pieces, 14,360 characters, took under 4 minutes). A long lesson takes 4 to 10 minutes.
 */
const CONCURRENCY = 3;
/** One piece of 1,900 characters took about 30 s; more than a few minutes means it's stuck. */
const CHUNK_TIMEOUT_MS = 240_000;

/** Voices for a teacher, from Deepgram's Aura-2 list (developers.deepgram.com/docs/tts-models, 2026-11-19). */
export const NARRATION_VOICES: ReadonlyArray<{ id: string; label: string; language: "en" | "es"; note: string }> = [
  { id: "aura-2-hermes-en", label: "Hermes", language: "en", note: "American man: expressive, engaging, professional" },
  { id: "aura-2-orion-en", label: "Orion", language: "en", note: "American man: approachable, calm, polite" },
  { id: "aura-2-jupiter-en", label: "Jupiter", language: "en", note: "American man: expressive, knowledgeable, baritone" },
  { id: "aura-2-draco-en", label: "Draco", language: "en", note: "British man: warm, trustworthy, baritone" },
  { id: "aura-2-hera-en", label: "Hera", language: "en", note: "American woman: smooth, warm, professional" },
  { id: "aura-2-selene-en", label: "Selene", language: "en", note: "American woman: expressive, engaging, energetic" },
  { id: "aura-2-athena-en", label: "Athena", language: "en", note: "American woman: calm, smooth, mature" },
  { id: "aura-2-vesta-en", label: "Vesta", language: "en", note: "American woman: natural, patient, empathetic" },
  // Spanish voices that switch to English for technical terms.
  { id: "aura-2-javier-es", label: "Javier", language: "es", note: "Mexican man: approachable, professional; says English terms in English" },
  { id: "aura-2-aquila-es", label: "Aquila", language: "es", note: "Latin American man: expressive, confident; says English terms in English" },
  { id: "aura-2-selena-es", label: "Selena", language: "es", note: "Latin American woman: friendly, calm; says English terms in English" },
  { id: "aura-2-diana-es", label: "Diana", language: "es", note: "Spanish woman: professional, expressive; says English terms in English" },
];
export const DEFAULT_VOICES: Record<string, string> = { en: "aura-2-hermes-en", es: "aura-2-javier-es" };

export function isNarrationVoice(voice: string | null | undefined): voice is string {
  return NARRATION_VOICES.some((entry) => entry.id === voice);
}

/** What voicing `characters` costs, in US dollars (Aura-2's list price). */
export const voiceCost = (characters: number) => (characters / 1000) * (VOICE_PRICES.speakPer1000Chars / 1_000_000);

/** Aura-2's speaking rate: 13.3 and 15.0 characters a second in two tests on 2026-11-19 (a test script, and lesson 00.04). */
export const CHARS_PER_SECOND = 14;
/** About how long a script plays. */
export const estimatedSeconds = (characters: number) => characters / CHARS_PER_SECOND;

/** The script in pieces of at most CHUNK_CHARS: whole paragraphs, or whole sentences of a long one. */
export function chunkScript(script: string): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    if (current && current.length + piece.length + 2 > CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + piece;
  };
  for (const paragraph of script.split(/\n\s*\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (paragraph.length <= CHUNK_CHARS) {
      push(paragraph);
      continue;
    }
    let sentence = "";
    for (const part of paragraph.match(/[^.!?]+[.!?]+["'”’)]?\s*|[^.!?]+$/g) ?? [paragraph]) {
      if (sentence && sentence.length + part.length > CHUNK_CHARS) {
        push(sentence.trim());
        sentence = "";
      }
      sentence += part.length > CHUNK_CHARS ? part.slice(0, CHUNK_CHARS) : part;
    }
    if (sentence.trim()) push(sentence.trim());
  }
  if (current) chunks.push(current);
  return chunks;
}

// --- MP3 ----------------------------------------------------------------------------------------------------------

const BITRATES: Record<string, number[]> = {
  // kb/s by index, for Layer III: MPEG-1, and MPEG-2 / 2.5.
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** An MP3 frame header at `at`, or null. Layer III only: it's all Deepgram sends. */
function frameAt(bytes: Uint8Array, at: number): { length: number; samples: number; sampleRate: number } | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[at + 1] >> 3) & 0b11; // 3 MPEG-1, 2 MPEG-2, 0 MPEG-2.5
  const layer = (bytes[at + 1] >> 1) & 0b11; // 1 Layer III
  const bitrateIndex = bytes[at + 2] >> 4;
  const rateIndex = (bytes[at + 2] >> 2) & 0b11;
  const padding = (bytes[at + 2] >> 1) & 1;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const bitrate = (version === 3 ? BITRATES.v1 : BITRATES.v2)[bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const samples = version === 3 ? 1152 : 576;
  return { length: Math.floor((samples / 8) * (bitrate / sampleRate)) + padding, samples, sampleRate };
}

/** A piece's audio frames, without its ID3 tag or Xing/Info/VBRI frame, and how long they play. */
export function mp3Frames(bytes: Uint8Array): { frames: Uint8Array; seconds: number } {
  let at = 0;
  // ID3v2: "ID3", version, flags, then the size in four 7-bit bytes.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    at = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  }
  const kept: Uint8Array[] = [];
  let seconds = 0;
  let first = true;
  while (at < bytes.length) {
    const frame = frameAt(bytes, at);
    if (!frame || frame.length <= 0) {
      at += 1; // Not on a frame (junk, or a trailing tag): look for the next one.
      continue;
    }
    const body = bytes.subarray(at, Math.min(bytes.length, at + frame.length));
    const tag = first ? new TextDecoder("latin1").decode(body.subarray(0, Math.min(body.length, 64))) : "";
    first = false;
    // The first frame may be a Xing, Info or VBRI frame: it says how long this piece alone is, so it's left out.
    if (!/Xing|Info|VBRI/.test(tag)) {
      kept.push(body);
      seconds += frame.samples / frame.sampleRate;
    }
    at += frame.length;
  }
  const frames = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    frames.set(part, offset);
    offset += part.length;
  }
  return { frames, seconds };
}

/** One piece read by `voice`, as MP3. Retried once if Deepgram fails or is slow. */
async function speakPiece(text: string, voice: string): Promise<Uint8Array> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set on the worker.");
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${API}/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3&bit_rate=48000`, {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      lastError = `Deepgram ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`;
      // A bad request or a key problem won't change on a second try.
      if (response.status === 400 || response.status === 401 || response.status === 402 || response.status === 403) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Deepgram couldn't voice a piece: ${lastError}`);
}

/** The whole script as one MP3, with its length and the characters voiced. `onProgress` follows the pieces. */
export async function voiceScript(script: string, voice: string, onProgress?: (done: number, total: number) => Promise<void> | void): Promise<{ mp3: Uint8Array; seconds: number; characters: number }> {
  const chunks = chunkScript(script);
  const results: { frames: Uint8Array; seconds: number }[] = new Array(chunks.length);
  let next = 0;
  let done = 0;
  const work = async () => {
    while (next < chunks.length) {
      const index = next++;
      results[index] = mp3Frames(await speakPiece(chunks[index], voice));
      done += 1;
      await onProgress?.(done, chunks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, work));
  const mp3 = new Uint8Array(results.reduce((sum, piece) => sum + piece.frames.length, 0));
  let offset = 0;
  for (const piece of results) {
    mp3.set(piece.frames, offset);
    offset += piece.frames.length;
  }
  if (!mp3.length) throw new Error("Deepgram sent no audio.");
  return { mp3, seconds: results.reduce((sum, piece) => sum + piece.seconds, 0), characters: chunks.reduce((sum, chunk) => sum + chunk.length, 0) };
}

// --- Upload, through the platform ---------------------------------------------------------------------------------

/** The signature the platform checks on a worker's request (app/api/lab-worker/audio-upload/route.ts). */
export function workerSignature(secret: string, time: string, body: string): string {
  return createHmac("sha256", secret).update(`${time}.`).update(body).digest("hex");
}

/**
 * Stores the audio of `audioId` as revision `revision`: the platform names the file and hands out an address to put it
 * to. Returns the /media/ path learners' pages sign (lib/media.ts).
 */
export async function uploadLessonAudio(audioId: string, revision: number, mp3: Uint8Array): Promise<string> {
  const platform = process.env.PLATFORM_URL?.replace(/\/+$/, "");
  const secret = process.env.LAB_WORKER_SECRET;
  if (!platform || !secret) throw new Error("PLATFORM_URL and LAB_WORKER_SECRET must be set on the worker to store audio.");
  const body = JSON.stringify({ audioId, revision });
  const time = String(Date.now());
  const response = await fetch(`${platform}/api/lab-worker/audio-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-worker-time": time, "x-worker-signature": workerSignature(secret, time, body) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const answer = (await response.json().catch(() => null)) as { url?: string; headers?: Record<string, string>; path?: string; error?: string } | null;
  if (!response.ok || !answer?.url || !answer.path) throw new Error(`The platform didn't give an upload address (${response.status}${answer?.error ? `: ${answer.error}` : ""}).`);
  // An ArrayBuffer of exactly the file: fetch's types don't take a Uint8Array.
  const file = mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength) as ArrayBuffer;
  const put = await fetch(answer.url, { method: "PUT", headers: answer.headers, body: file, signal: AbortSignal.timeout(300_000) });
  if (!put.ok) throw new Error(`The audio couldn't be stored (${put.status}: ${(await put.text().catch(() => "")).slice(0, 200)}).`);
  return answer.path;
}
