import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Schema } from "@google/genai";
import { AUTHORING_CHAIN, chainStartingAt, generateWithFallback } from "@/lib/ai/gemini";
import { MEDIA_PREFIX, resolveMediaUrls } from "@/lib/media";
export { TRANSLATION_BATCH } from "@/lib/caption-limits";

// Captions for lesson videos (docs/lesson-videos.md): English cues from Deepgram's transcript of the video, with its
// word timings, and Spanish cues translated from them, line for line, so both share one set of timings. Each step fits
// in one request (Amplify stops a request after about 30 s): the admin page runs them in turn (actions/captions.ts).

export type Cue = { start: number; end: number; text: string };

/** The tracks a lesson video gets: English captions (the narration's own language) and Spanish subtitles. */
export const CAPTION_TRACKS = {
  en: { kind: "captions", srclang: "en", label: "English" },
  es: { kind: "subtitles", srclang: "es", label: "Español" },
} as const;
export type CaptionLanguage = keyof typeof CAPTION_TRACKS;

// Words a general model mishears in this course's videos.
const KEYTERMS = [
  "LangChain",
  "LangGraph",
  "LangSmith",
  "Jupyter",
  "Groq",
  "OpenAI",
  "Gemini",
  "Hugging Face",
  "Ollama",
  "DeepSeek",
  "Anthropic",
  "MCP",
  "RAG",
  "LLM",
];

type DeepgramWord = { start: number; end: number; punctuated_word?: string; word: string };

/** Above this a video is too big to pass through the server: Deepgram fetches it from its address instead. */
const MAX_SENT_BYTES = 200 * 1024 ** 2;

/**
 * What Deepgram hears, as bytes the server sends it: the encode's audio-only copy (`video-audio.mp4`, a few MB) when
 * there is one, else the video itself (videos encoded before the audio copy existed). Sending bytes, not an address:
 * Deepgram fetching a file by its URL sometimes took 7 s and sometimes hung past 40 s for the same file (2026-11-08).
 * Null when only the address will do (a very long video).
 */
async function audioToSend(videoPath: string, signal: AbortSignal): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const local = (path: string) => join(process.cwd(), "public", path);
  const audioPath = videoPath.replace(/video\.mp4$/, "video-audio.mp4");
  const url = (path: string) => resolveMediaUrls(path);
  if (!/^https?:\/\//.test(url(videoPath))) {
    // Local development without the media host: the files are in public/media.
    const bytes = await readFile(local(audioPath)).catch(() => readFile(local(videoPath)));
    return { bytes: Uint8Array.from(bytes).buffer, type: "video/mp4" };
  }
  if (audioPath !== videoPath) {
    const audio = await fetch(url(audioPath), { signal }).catch(() => null);
    if (audio?.ok) return { bytes: await audio.arrayBuffer(), type: "audio/mp4" };
  }
  const head = await fetch(url(videoPath), { method: "HEAD", signal }).catch(() => null);
  if (Number(head?.headers.get("content-length") ?? Infinity) > MAX_SENT_BYTES) return null;
  const video = await fetch(url(videoPath), { signal });
  if (!video.ok) throw new Error(`The video couldn't be read from the media host (${video.status})`);
  return { bytes: await video.arrayBuffer(), type: "video/mp4" };
}

/**
 * Deepgram Nova-3 transcribes the video's English narration (pre-recorded, with smart formatting: numbers as
 * digits, punctuation).
 */
export async function transcribe(videoPath: string, signal: AbortSignal): Promise<DeepgramWord[]> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  if (!videoPath.startsWith(MEDIA_PREFIX)) throw new Error("The video isn't on the media host");
  const params = new URLSearchParams({ model: "nova-3", language: "en", smart_format: "true", punctuate: "true" });
  for (const term of KEYTERMS) params.append("keyterm", term);

  const audio = await audioToSend(videoPath, signal);
  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": audio ? audio.type : "application/json" },
    body: audio ? audio.bytes : JSON.stringify({ url: resolveMediaUrls(videoPath) }),
    signal,
  });
  const result = (await response.json().catch(() => null)) as {
    results?: { channels?: { alternatives?: { words?: DeepgramWord[] }[] }[] };
    err_msg?: string;
  } | null;
  if (!response.ok) throw new Error(`Deepgram couldn't transcribe the video (${response.status}${result?.err_msg ? `: ${result.err_msg}` : ""})`);
  const words = result?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  if (!words.length) throw new Error("Deepgram heard no speech in the video");
  return words;
}

// A cue is at most two lines of about 42 characters and 7 seconds on screen, and ends where the speaker does: at the
// end of a sentence when it can, else at a comma, never mid-word.
const MAX_CHARS = 84;
const MAX_SECONDS = 7;
const MIN_SECONDS = 1.2;
const PAUSE_SECONDS = 0.8;

/** The transcript's words as caption cues. */
export function cuesFromWords(words: DeepgramWord[]): Cue[] {
  const cues: Cue[] = [];
  let current: DeepgramWord[] = [];
  const say = (list: DeepgramWord[]) => list.map((word) => word.punctuated_word ?? word.word).join(" ");
  const close = (list: DeepgramWord[]) => {
    if (list.length) cues.push({ start: list[0].start, end: list.at(-1)!.end, text: say(list) });
  };

  for (const word of words) {
    const previous = current.at(-1);
    if (previous) {
      const tooLong = say([...current, word]).length > MAX_CHARS || word.end - current[0].start > MAX_SECONDS;
      if (word.start - previous.end > PAUSE_SECONDS) {
        close(current);
        current = [];
      } else if (tooLong) {
        // Break after the last comma, colon or semicolon in the second half of the cue, if there is one.
        const at = current.findLastIndex((entry, index) => index >= current.length / 2 && /[,;:]$/.test(entry.punctuated_word ?? ""));
        if (at >= 0 && at < current.length - 1) {
          close(current.slice(0, at + 1));
          current = current.slice(at + 1);
        } else {
          close(current);
          current = [];
        }
      }
    }
    current.push(word);
    if (/[.?!]$/.test(word.punctuated_word ?? "") && say(current).length >= 16) {
      close(current);
      current = [];
    }
  }
  close(current);

  // A short cue stays up long enough to read, without running into the next.
  return cues.map((cue, index) => {
    const next = cues[index + 1];
    const end = Math.max(cue.end, Math.min(cue.start + MIN_SECONDS, next ? next.start - 0.05 : Infinity));
    return { ...cue, end: Number(end.toFixed(3)) };
  });
}

/** A cue's text as one or two balanced lines, broken at the space nearest the middle (after punctuation if close). */
function lines(text: string): string {
  if (text.length <= MAX_CHARS / 2) return text;
  const middle = text.length / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== " ") continue;
    const score = Math.abs(index - middle) - (/[,;:.?!]/.test(text[index - 1] ?? "") ? 8 : 0);
    if (score < bestScore) [best, bestScore] = [index, score];
  }
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

function stamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** The cues as a WebVTT file. */
export function toVtt(cues: Cue[]): string {
  const blocks = cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${lines(cue.text.replace(/\s+/g, " ").trim())}`);
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

const TRANSLATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { lines: { type: Type.ARRAY, items: { type: Type.STRING } } },
  required: ["lines"],
};

const TRANSLATION_SYSTEM = `You translate the English captions of a programming lesson video into Latin American Spanish subtitles.

You get numbered caption lines, in order, and sometimes the lines just before them for context. Return exactly one Spanish line for each numbered line, in the same order: the same count, never merged, never split, never skipped.

- A sentence may run across several lines. Translate so each Spanish line covers the same part of the meaning as its English line, moving a word to the neighbouring line only where Spanish word order needs it, so the lines read naturally one after another.
- Keep code, function and variable names, model names, product names (LangChain, Groq, Ollama, Hugging Face…) and technical terms Spanish-speaking developers say in English (prompt, token, notebook, free tier, rate limit) as they are.
- Keep numbers, prices and units exactly.
- Subtitles are read while listening: keep each line about as short as the English, plain and natural, using "tú".
- Return JSON only: {"lines": ["...", "..."]}.`;

/**
 * One batch of English caption lines in Spanish, line for line. `context` is the English just before the batch, so a
 * sentence that crosses a batch boundary reads right.
 */
export async function translateLines(lines: string[], context: string[], userId: string, deadline: number): Promise<string[]> {
  const numbered = lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
  const before = context.length ? `Context, already translated (don't return these):\n${context.join("\n")}\n\n` : "";
  const result = await generateWithFallback({
    feature: "translate",
    pool: "AUTHORING",
    userId,
    // Sonnet first: a batch is translated well and fast; Opus is slower than a request allows for a long batch.
    models: chainStartingAt(AUTHORING_CHAIN, "claude-sonnet-5-5"),
    deadline,
    contents: [{ role: "user", parts: [{ text: `${before}Translate these ${lines.length} lines:\n${numbered}` }] }],
    config: { systemInstruction: TRANSLATION_SYSTEM, temperature: 0.2, responseMimeType: "application/json", responseSchema: TRANSLATION_SCHEMA, maxOutputTokens: 4096 },
  });
  if (!result.ok) throw new Error(result.reason === "quota" ? "Every model is over its share for now. Try again later." : "No model could translate the captions in time.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new Error("The translation came back unreadable.");
  }
  const translated = (parsed as { lines?: unknown }).lines;
  if (!Array.isArray(translated) || translated.length !== lines.length || translated.some((line) => typeof line !== "string" || !line.trim())) {
    throw new Error(`The translation came back with ${Array.isArray(translated) ? translated.length : 0} lines for ${lines.length}.`);
  }
  return (translated as string[]).map((line) => line.replace(/\s+/g, " ").trim());
}
