import { createHash, createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VOICE_PRICES } from "@/lib/voice/deepgram";
import type { DirectedPiece } from "@/lib/lesson-audio/delivery";
import { LIST_PRICES, WORKLOADS } from "@/lib/spend/charges";

// Voicing a lesson's script (docs/lesson-audio.md), with one of two providers:
//   - ElevenLabs Eleven v4 (the default): the most human voice, directed with audio tags for tone and pauses
//     (lib/lesson-audio/delivery.ts). Pieces of about 3,300 characters, one after another, each told which pieces came
//     before it (request stitching), so the voice keeps its tone across the lesson. MP3 at 44.1 kHz, 96 kb/s.
//   - Deepgram Aura-2, cheaper and plainer: pieces of at most 2,000 characters, as MP3 at 48 kb/s.
// The pieces are joined into one file: each piece's metadata frames are taken out first (an ID3 tag, a Xing/Info frame),
// so the joined file is plain MP3 frames whose length every player reads right. The file goes to the media bucket
// through a short-lived upload address the platform hands out (app/api/lab-worker/audio-upload): the worker on the lab
// server holds no AWS credentials.

const API = "https://api.deepgram.com";
/** Aura-2 takes at most 2,000 characters a request. */
const CHUNK_CHARS = 1_900;

const ELEVEN_API = "https://api.elevenlabs.io";
/** Eleven v4 (elevenlabs.io/docs/overview/models, 2026-11-19): 10,000 characters a request, about 10 minutes of audio. */
export const ELEVEN_MODEL = "eleven_v4";
/**
 * A piece for Eleven v4: well under its 10,000-character limit, leaving room for the delivery's tags, and short enough
 * that one bad piece is cheap to redo.
 */
const ELEVEN_CHUNK_CHARS = 3_300;
/** Speech for teaching: the docs' defaults. Lower stability is more expressive and less steady. Style and speed don't apply to v4. */
const ELEVEN_SETTINGS = { stability: 0.5, similarity_boost: 0.75 };
const ELEVEN_FORMAT = "mp3_44100_96";
/**
 * US$ per 1,000 characters, for estimates. The API's list price is US$0.08 (elevenlabs.io/pricing/api, 2026-11-19), but
 * this account's plan bills credits at about US$0.19 to 0.22 (ElevenLabs' own usage report, lib/spend/charges.ts
 * LIST_PRICES). Tags count as characters. Admin → Spend shows what was really billed.
 */
export const ELEVEN_PER_1000 = LIST_PRICES.elevenlabsPer1000;
/**
 * Pieces sent at once for one lesson. Deepgram makes speech about four times faster than it plays, and doesn't always
 * work on pieces side by side (2026-11-19: three test pieces came back at 29 s, 61 s and 72 s; lesson 00.04's nine
 * pieces, 14,360 characters, took under 4 minutes). A long lesson takes 4 to 10 minutes.
 */
const CONCURRENCY = 3;
/** One piece of 1,900 characters took about 30 s; more than a few minutes means it's stuck. */
const CHUNK_TIMEOUT_MS = 240_000;

export type VoiceProvider = "elevenlabs" | "deepgram";
export type NarrationVoice = { id: string; label: string; provider: VoiceProvider; language: "en" | "es" | "any"; note: string };

/**
 * The voices offered, the default first. ElevenLabs': the admin's chosen Eleven v4 voices, any language (v4 speaks each
 * language natively); their names are read from ElevenLabs when the page loads (actions/lesson-audio.ts). Deepgram's:
 * teacher-like Aura-2 voices (developers.deepgram.com/docs/tts-models, 2026-11-19).
 */
export const NARRATION_VOICES: ReadonlyArray<NarrationVoice> = [
  // As ElevenLabs described them on 2026-11-19; the page reads the current names when it loads.
  { id: "c6SfcYrb2t09NHXiT80T", label: "Jarnathan", provider: "elevenlabs", language: "any", note: "male, american, middle aged, confident" },
  { id: "DODLEQrClDo8wCz460ld", label: "Lauren", provider: "elevenlabs", language: "any", note: "female, american, middle aged, pleasant" },
  { id: "1SM7GgM6IMuvQlz2BwM3", label: "Mark", provider: "elevenlabs", language: "any", note: "male, american, middle aged, casual" },
  { id: "NMxp5bnMnB1sL7oen8GM", label: "Chris", provider: "elevenlabs", language: "any", note: "male, american, middle aged, pleasant" },
  { id: "ut2XM2wJyIZLTtW6lFzZ", label: "Eliza", provider: "elevenlabs", language: "any", note: "female, american, young, casual" },
  { id: "4N8zjn9tVNuDEBFWVHAq", label: "Jesse", provider: "elevenlabs", language: "any", note: "male, american, middle aged, made for e-learning" },
  { id: "aura-2-hermes-en", label: "Hermes", provider: "deepgram", language: "en", note: "American man: expressive, engaging, professional" },
  { id: "aura-2-orion-en", label: "Orion", provider: "deepgram", language: "en", note: "American man: approachable, calm, polite" },
  { id: "aura-2-jupiter-en", label: "Jupiter", provider: "deepgram", language: "en", note: "American man: expressive, knowledgeable, baritone" },
  { id: "aura-2-draco-en", label: "Draco", provider: "deepgram", language: "en", note: "British man: warm, trustworthy, baritone" },
  { id: "aura-2-hera-en", label: "Hera", provider: "deepgram", language: "en", note: "American woman: smooth, warm, professional" },
  { id: "aura-2-selene-en", label: "Selene", provider: "deepgram", language: "en", note: "American woman: expressive, engaging, energetic" },
  { id: "aura-2-athena-en", label: "Athena", provider: "deepgram", language: "en", note: "American woman: calm, smooth, mature" },
  { id: "aura-2-vesta-en", label: "Vesta", provider: "deepgram", language: "en", note: "American woman: natural, patient, empathetic" },
  // Spanish voices that switch to English for technical terms.
  { id: "aura-2-javier-es", label: "Javier", provider: "deepgram", language: "es", note: "Mexican man: approachable, professional; says English terms in English" },
  { id: "aura-2-aquila-es", label: "Aquila", provider: "deepgram", language: "es", note: "Latin American man: expressive, confident; says English terms in English" },
  { id: "aura-2-selena-es", label: "Selena", provider: "deepgram", language: "es", note: "Latin American woman: friendly, calm; says English terms in English" },
  { id: "aura-2-diana-es", label: "Diana", provider: "deepgram", language: "es", note: "Spanish woman: professional, expressive; says English terms in English" },
];
export const DEFAULT_VOICES: Record<string, string> = { en: "c6SfcYrb2t09NHXiT80T", es: "c6SfcYrb2t09NHXiT80T" };

export function isNarrationVoice(voice: string | null | undefined): voice is string {
  return NARRATION_VOICES.some((entry) => entry.id === voice);
}

export const voiceProvider = (voice: string): VoiceProvider => NARRATION_VOICES.find((entry) => entry.id === voice)?.provider ?? "deepgram";

/** US$ per 1,000 characters for a voice's provider, at list price. */
export const per1000 = (voice: string) => (voiceProvider(voice) === "elevenlabs" ? ELEVEN_PER_1000 : VOICE_PRICES.speakPer1000Chars / 1_000_000);

/** What voicing `characters` costs, in US dollars. */
export const voiceCost = (characters: number, voice: string) => (characters / 1000) * per1000(voice);

/**
 * Characters a second of speech: Aura-2 read 13.3 and 15.0 in two tests (2026-11-19: a test script, and lesson 00.04);
 * Eleven v4 read 16.9, tags included (a 9,235-character test with Jarnathan, 545 s).
 */
export const CHARS_PER_SECOND = { deepgram: 14, elevenlabs: 16.5 } as const;
/** About how long a script plays, read by `voice`. */
export const estimatedSeconds = (characters: number, voice?: string) => characters / CHARS_PER_SECOND[voice ? voiceProvider(voice) : "deepgram"];

/** The script in pieces of at most `max` characters: whole paragraphs, or whole sentences of a long one. */
export function chunkScript(script: string, max = CHUNK_CHARS): string[] {
  const CHUNK_CHARS = max;
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

/** An MP3 frame header at `at`, or null. Layer III only: it's all Deepgram and ElevenLabs send. */
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

// --- Kept pieces ----------------------------------------------------------------------------------------------------

/**
 * Pieces already voiced, kept on the worker's disk until their lesson's audio is stored. A voicing that's cut off (the
 * worker stopped, ran out of memory, was rebuilt) picks up at the piece it was on instead of paying for every piece
 * again: on 2026-11-19, before this, three out-of-memory stops and a rebuild had pieces of long lessons paid for twice.
 * On the lab server the folder is a volume (infra/lab/compose.yaml), so it outlives the container; elsewhere, the
 * system's temporary folder.
 */
const PIECES_DIR = process.env.LESSON_PIECES_DIR || join(tmpdir(), "adc-lesson-pieces");
/** Kept pieces of a lesson never finished are cleared after this. */
const PIECES_KEPT_MS = 7 * 24 * 3_600_000;

type KeptPiece = { text: string; directed: boolean; tags: number; requestId: string | null; seconds: number };

/** Which pieces a voicing keeps: the lesson's audio and the revision it's voicing. */
export type PieceStore = { key: string };

const safe = (key: string) => key.replace(/[^a-zA-Z0-9_-]/g, "_");
/** A piece is the same only if the same script piece is read by the same voice and model, in the same language, with
 * the delivery added or not as before. */
const pieceName = (index: number, chunk: string, voice: string, language: string, directed: boolean) =>
  `${index}-${createHash("sha256").update(`${ELEVEN_MODEL}|${voice}|${language}|${directed ? "directed" : "plain"}|${chunk}`).digest("hex").slice(0, 20)}`;

async function keptPiece(store: PieceStore, name: string): Promise<{ piece: KeptPiece; frames: Uint8Array } | null> {
  try {
    const folder = join(PIECES_DIR, safe(store.key));
    const [piece, frames] = await Promise.all([readFile(join(folder, `${name}.json`), "utf8"), readFile(join(folder, `${name}.mp3`))]);
    return { piece: JSON.parse(piece) as KeptPiece, frames: new Uint8Array(frames.buffer, frames.byteOffset, frames.byteLength) };
  } catch {
    return null;
  }
}

/** Keeps a piece: its audio first, then its details, so a piece with details always has its audio. Never throws. */
async function keepPiece(store: PieceStore, name: string, piece: KeptPiece, frames: Uint8Array) {
  try {
    const folder = join(PIECES_DIR, safe(store.key));
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${name}.mp3`), frames);
    await writeFile(join(folder, `${name}.json.part`), JSON.stringify(piece));
    await rename(join(folder, `${name}.json.part`), join(folder, `${name}.json`));
  } catch {
    // Without the disk, a cut-off voicing starts over, as before.
  }
}

/** Clears a voicing's kept pieces, once its audio is stored. */
export async function forgetPieces(store: PieceStore) {
  await rm(join(PIECES_DIR, safe(store.key)), { recursive: true, force: true }).catch(() => undefined);
}

/** On the worker's start: clears the kept pieces of voicings left unfinished for a week. */
export async function prunePieces() {
  const folders = await readdir(PIECES_DIR).catch(() => [] as string[]);
  for (const folder of folders) {
    const info = await stat(join(PIECES_DIR, folder)).catch(() => null);
    if (info && Date.now() - info.mtimeMs > PIECES_KEPT_MS) await rm(join(PIECES_DIR, folder), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A call made, for the spend ledger (lib/spend/charges.ts): the caller adds what it was for. */
export type PieceCharge = { provider: "elevenlabs" | "deepgram"; model: string; ok: boolean; characters: number; estimatedUsd: number; requestId: string | null; audioSeconds?: number; detail?: Record<string, unknown> };
type OnCharge = ((charge: PieceCharge) => Promise<void> | void) | undefined;

/** One piece read by `voice`, as MP3. Retried once if Deepgram fails or is slow. Every attempt is a charge. */
async function speakPiece(text: string, voice: string, onCharge: OnCharge): Promise<Uint8Array> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set on the worker.");
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${API}/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3&bit_rate=48000&tag=${WORKLOADS["lesson-audio.voice"].tag}`, {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });
      const requestId = response.headers.get("dg-request-id");
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        await onCharge?.({ provider: "deepgram", model: "aura-2", ok: true, characters: text.length, estimatedUsd: (text.length / 1000) * LIST_PRICES.deepgramSpeakPer1000, requestId });
        return bytes;
      }
      await onCharge?.({ provider: "deepgram", model: "aura-2", ok: false, characters: text.length, estimatedUsd: 0, requestId, detail: { status: response.status } });
      lastError = `Deepgram ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`;
      // A bad request or a key problem won't change on a second try.
      if (response.status === 400 || response.status === 401 || response.status === 402 || response.status === 403) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // Cut off (a timeout, the network): the provider may still have done the work and billed it.
      await onCharge?.({ provider: "deepgram", model: "aura-2", ok: false, characters: text.length, estimatedUsd: 0, requestId: null, detail: { error: lastError.slice(0, 200) } });
    }
  }
  throw new Error(`Deepgram couldn't voice a piece: ${lastError}`);
}

/**
 * One piece read by an Eleven v4 voice, as MP3, with the request id the next piece is stitched to. Every attempt is a
 * charge, with ElevenLabs' x-trace-id: its request log has the same id, which is how Admin → Spend matches them.
 */
async function elevenPiece(text: string, voice: string, language: string, previous: string[], onCharge: OnCharge): Promise<{ bytes: Uint8Array; requestId: string | null }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set on the worker.");
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${ELEVEN_API}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${ELEVEN_FORMAT}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: ELEVEN_MODEL,
          language_code: language === "es" ? "es" : "en",
          voice_settings: ELEVEN_SETTINGS,
          // At most 3, the closest last (elevenlabs.io/docs, "Stitching multiple requests").
          ...(previous.length ? { previous_request_ids: previous.slice(-3) } : {}),
        }),
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });
      const traceId = response.headers.get("x-trace-id");
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        await onCharge?.({
          provider: "elevenlabs",
          model: ELEVEN_MODEL,
          ok: true,
          characters: text.length,
          estimatedUsd: (text.length / 1000) * ELEVEN_PER_1000,
          requestId: traceId,
          detail: { stitchedTo: previous.slice(-3).length, characterCost: response.headers.get("character-cost") },
        });
        return { bytes, requestId: response.headers.get("request-id") };
      }
      await onCharge?.({ provider: "elevenlabs", model: ELEVEN_MODEL, ok: false, characters: text.length, estimatedUsd: 0, requestId: traceId, detail: { status: response.status } });
      lastError = `ElevenLabs ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`;
      // Busy (429) or a passing fault: wait and try again. A refused request (key, quota, a bad voice) won't change.
      if (response.status !== 429 && response.status < 500) break;
      await new Promise((resolve) => setTimeout(resolve, 15_000 * (attempt + 1)));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // Cut off (a timeout, the network): the provider may still have done the work and billed it.
      await onCharge?.({ provider: "elevenlabs", model: ELEVEN_MODEL, ok: false, characters: text.length, estimatedUsd: 0, requestId: null, detail: { error: lastError.slice(0, 200) } });
    }
  }
  throw new Error(`ElevenLabs couldn't voice a piece: ${lastError}`);
}

/** `reused`: pieces an earlier, cut-off attempt had voiced and kept, not paid for again. */
export type VoicedScript = { mp3: Uint8Array; seconds: number; characters: number; directed: string | null; directedPieces: number; pieces: number; tags: number; reused: number };

/**
 * The whole script as one MP3, with its length and the characters voiced (what the provider bills). With ElevenLabs,
 * `direct` adds the delivery to each piece first (lib/lesson-audio/delivery.ts), and `directed` is what the voice read.
 * `onProgress` follows the pieces.
 */
export async function voiceScript(
  script: string,
  voice: string,
  options: {
    language: string;
    onProgress?: (done: number, total: number, reused?: number) => Promise<void> | void;
    direct?: (piece: string, previous: string | null) => Promise<DirectedPiece>;
    /** Every call made, for the spend ledger. */
    onCharge?: (charge: PieceCharge) => Promise<void> | void;
    /** Keeps each piece voiced, and reuses those an earlier, cut-off attempt kept (ElevenLabs only). */
    store?: PieceStore;
  },
): Promise<VoicedScript> {
  const { onProgress, onCharge, store } = options;
  if (voiceProvider(voice) === "elevenlabs") {
    // One after another: each piece is stitched to the ones before it.
    const chunks = chunkScript(script, ELEVEN_CHUNK_CHARS);
    const read: string[] = [];
    const frames: Uint8Array[] = [];
    const ids: string[] = [];
    const pending: PieceCharge[] = [];
    let seconds = 0;
    let directedPieces = 0;
    let tags = 0;
    let reused = 0;
    for (const [index, chunk] of chunks.entries()) {
      const name = pieceName(index, chunk, voice, options.language, Boolean(options.direct));
      const kept = store ? await keptPiece(store, name) : null;
      if (kept) {
        // Voiced by an attempt that was cut off: not paid for again.
        reused += 1;
        if (kept.piece.directed) directedPieces += 1;
        tags += kept.piece.tags;
        read.push(kept.piece.text);
        if (kept.piece.requestId) ids.push(kept.piece.requestId);
        frames.push(kept.frames);
        seconds += kept.piece.seconds;
        await onProgress?.(index + 1, chunks.length, reused);
        continue;
      }
      const directed = options.direct ? await options.direct(chunk, read.at(-1) ?? null) : { text: chunk, directed: false, tags: 0 };
      if (directed.directed) directedPieces += 1;
      tags += directed.tags;
      read.push(directed.text);
      let pieceSeconds = 0;
      const { bytes, requestId } = await elevenPiece(directed.text, voice, options.language, ids, (charge) => {
        // The audio's length is known once the bytes are read: the charge waits for it below.
        pending.push({ ...charge, detail: { ...charge.detail, piece: index + 1, of: chunks.length, directed: directed.directed } });
      });
      if (requestId) ids.push(requestId);
      const piece = mp3Frames(bytes);
      pieceSeconds = piece.seconds;
      for (const charge of pending.splice(0)) await onCharge?.({ ...charge, audioSeconds: charge.ok ? pieceSeconds : undefined });
      if (store) await keepPiece(store, name, { text: directed.text, directed: directed.directed, tags: directed.tags, requestId, seconds: piece.seconds }, piece.frames);
      frames.push(piece.frames);
      seconds += piece.seconds;
      await onProgress?.(index + 1, chunks.length, reused);
    }
    const mp3 = new Uint8Array(frames.reduce((sum, piece) => sum + piece.length, 0));
    let offset = 0;
    for (const piece of frames) {
      mp3.set(piece, offset);
      offset += piece.length;
    }
    if (!mp3.length) throw new Error("ElevenLabs sent no audio.");
    const text = read.join("\n\n");
    return { mp3, seconds, characters: read.reduce((sum, piece) => sum + piece.length, 0), directed: options.direct ? text : null, directedPieces, pieces: chunks.length, tags, reused };
  }

  const chunks = chunkScript(script);
  const results: { frames: Uint8Array; seconds: number }[] = new Array(chunks.length);
  let next = 0;
  let done = 0;
  const work = async () => {
    while (next < chunks.length) {
      const index = next++;
      const charges: PieceCharge[] = [];
      results[index] = mp3Frames(await speakPiece(chunks[index], voice, (charge) => void charges.push(charge)));
      for (const charge of charges) await onCharge?.({ ...charge, audioSeconds: charge.ok ? results[index].seconds : undefined, detail: { ...charge.detail, piece: index + 1, of: chunks.length } });
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
  return {
    mp3,
    seconds: results.reduce((sum, piece) => sum + piece.seconds, 0),
    characters: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    directed: null,
    directedPieces: 0,
    pieces: chunks.length,
    tags: 0,
    reused: 0,
  };
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
  // An ArrayBuffer of exactly the file: fetch's types don't take a Uint8Array. The joined file already is one, so it
  // isn't copied again (a long lesson's file is 50 MB or more).
  const whole = mp3.byteOffset === 0 && mp3.byteLength === mp3.buffer.byteLength;
  const file = (whole ? mp3.buffer : mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength)) as ArrayBuffer;
  const put = await fetch(answer.url, { method: "PUT", headers: answer.headers, body: file, signal: AbortSignal.timeout(300_000) });
  if (!put.ok) throw new Error(`The audio couldn't be stored (${put.status}: ${(await put.text().catch(() => "")).slice(0, 200)}).`);
  return answer.path;
}
