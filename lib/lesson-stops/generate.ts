import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { authoringChain, generateWithFallback } from "@/lib/ai/gemini";
import { lessonText } from "@/lib/lesson-text";
import { parseLessonVideo } from "@/lib/lesson-video";
import { estimatedStarts, readTimings, transcriptWords } from "@/lib/lesson-audio/words";
import { MEDIA_PREFIX, resolveMediaUrls } from "@/lib/media";
import { prisma } from "@/lib/prisma";

// Writing a lesson's hands-on stops (docs/lesson-stops.md). A model reads the recording's timed transcript, in
// sentences, with the lesson's own text beside it, and says after which sentence the learner has something to do on
// their computer, what, and with which exact commands. The code then checks what it can: the sentence exists, every
// command is written in the lesson or said in the recording (one that isn't is dropped), and stops are at least
// MIN_GAP_S apart (closer ones become one).

/** Models an admin can pick (Admin → Stops); the first is the default. A failed one falls back down the authoring chain. */
export const STOP_MODELS = [
  { id: "deepseek-flash", label: "DeepSeek V4.1 Flash" },
  { id: "dolphingo-qwen4-max", label: "Qwen4-Max (DolphinGo)" },
  { id: "dolphingo-deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash (DolphinGo)" },
] as const;

/** Two stops closer than this become one: the learner doesn't want to be stopped twice in a row. */
const MIN_GAP_S = 20;
/** Sentences per model call: long recordings are read in windows, all at once. */
const WINDOW = 110;
const LESSON_CHARS = 14_000;

export type Segment = { start: number; end: number; text: string };

/** Words cut into sentences, each with when it starts and ends: what the model reads, numbered. */
function sentences(words: { text: string; start: number }[], seconds: number): Segment[] {
  const out: Segment[] = [];
  let current: { text: string[]; start: number } | null = null;
  for (const [index, word] of words.entries()) {
    if (!current) current = { text: [], start: word.start };
    current.text.push(word.text);
    const ends = /[.!?:;]["')\]]*$/.test(word.text) || current.text.length >= 45;
    if (ends || index === words.length - 1) {
      // The last sentence runs to the recording's end, or a moment past its last word when that isn't known.
      const next = words[index + 1]?.start ?? Math.max(seconds, word.start + 1);
      out.push({ start: current.start, end: Math.max(current.start, next), text: current.text.join(" ") });
      current = null;
    }
  }
  return out;
}

/** The lesson audio's sentences, timed by the worker's word timings, or by an even pace until they exist. */
function audioSegments(script: string, timings: unknown, seconds: number): Segment[] {
  const words = transcriptWords(script);
  const starts = readTimings(timings, words.length) ?? estimatedStarts(words, seconds);
  return sentences(words.map((text, index) => ({ text, start: starts[index] / 100 })), seconds);
}

/** A WebVTT file's cues as words with times (each cue's words spread over it), then sentences. */
function vttSegments(vtt: string, seconds: number): Segment[] {
  const time = (value: string) => {
    const parts = value.trim().split(":").map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  };
  const words: { text: string; start: number }[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) continue;
    const [from, to] = lines[timing].split("-->").map((part) => time(part.split(" ").filter(Boolean)[0] ?? "0"));
    const cueWords = lines
      .slice(timing + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .split(/\s+/)
      .filter(Boolean);
    cueWords.forEach((text, index) => words.push({ text, start: from + ((to - from) * index) / cueWords.length }));
  }
  return sentences(words, seconds);
}

/** A video's spoken captions, read from the media bucket (or public/media when developing). English first. */
async function videoSegments(video: unknown, seconds: number): Promise<Segment[] | null> {
  const parsed = parseLessonVideo(video);
  if (parsed.kind !== "plain") return null;
  const tracks = (parsed.media.tracks ?? []).filter((track) => track.kind === "captions" || track.kind === "subtitles");
  const track = tracks.find((entry) => entry.srclang === "en") ?? tracks[0];
  if (!track?.src) return null;
  let vtt: string;
  if (track.src.startsWith(MEDIA_PREFIX) && !process.env.MEDIA_BASE_URL) {
    vtt = await readFile(join(process.cwd(), "public", track.src), "utf8");
  } else {
    const url = track.src.startsWith(MEDIA_PREFIX) ? resolveMediaUrls(track.src) : track.src;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`The captions couldn't be read (${response.status})`);
    vtt = await response.text();
  }
  return vttSegments(vtt, seconds);
}

const SYSTEM = `You mark the moments in a recorded lesson (audio or video) where the learner must stop and do something on their own before the recording goes on. Above all on their computer: run a command, install something, create or edit a file, change a setting, open a tool, or check that an output matches. Also a short exercise the recording asks for now (write something down, answer out loud). The player will pause there and show the step, so a learner who is only listening doesn't miss it.

You get the lesson's text (the source of truth for exact commands and file names) and the recording's sentences, numbered, with their times.

Rules:
- A stop goes after the sentence that finishes giving the instruction, before the recording moves on.
- Only real actions the learner is asked to do now. Not something the narrator only describes, shows, or says will come later, and not "think about" or "remember".
- Steps that come together (within about half a minute) are one stop.
- title: a few words naming the step ("Install pnpm"). step: one or two plain sentences saying exactly what to do and what they should see. Don't tell them to pause: the player already has. Both in Spanish and in English; technical terms stay in English.
- commands: the exact commands or file names to type, copied character for character from the lesson's text. If the lesson has no exact command for it, leave commands empty. Never invent one.
- If the stretch has no step to do, return an empty list.

Answer with JSON only: {"stops": [{"after": <sentence number>, "titleEs": "...", "titleEn": "...", "stepEs": "...", "stepEn": "...", "commands": ["..."]}]}`;

const Answer = z.object({
  stops: z
    .array(
      z.object({
        after: z.number().int(),
        titleEs: z.string().trim().min(1).max(120),
        titleEn: z.string().trim().min(1).max(120),
        stepEs: z.string().trim().min(1).max(600),
        stepEn: z.string().trim().min(1).max(600),
        commands: z.array(z.string()).max(8).default([]),
      }),
    )
    .max(40),
});

export type DraftStop = { at: number; titleEs: string; titleEn: string; stepEs: string; stepEn: string; commands: string[] };

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** Asks the model about every window of sentences at once, and keeps what checks out. */
async function draftStops(segments: Segment[], lesson: string, seconds: number, model: string, userId: string, deadline: number): Promise<{ stops: DraftStop[]; dropped: number; model: string }> {
  const windows: number[] = [];
  for (let at = 0; at < segments.length; at += WINDOW) windows.push(at);
  const known = squash(`${lesson}\n${segments.map((segment) => segment.text).join(" ")}`);
  let dropped = 0;
  let used = model;
  const results = await Promise.all(
    windows.map(async (from) => {
      const slice = segments.slice(from, from + WINDOW);
      const text = [
        `# THE LESSON'S TEXT\n${lesson.slice(0, LESSON_CHARS)}`,
        `# THE RECORDING'S SENTENCES (${from + 1} to ${from + slice.length} of ${segments.length})\n${slice.map((segment, index) => `${from + index + 1}. [${clock(segment.start)}] ${segment.text}`).join("\n")}`,
      ].join("\n\n");
      const result = await generateWithFallback({
        feature: "lesson-stops",
        pool: "AUTHORING",
        userId,
        models: authoringChain(model),
        chosenFirst: true,
        deadline,
        contents: [{ role: "user", parts: [{ text }] }],
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json", maxOutputTokens: 3000, temperature: 0.2 },
      });
      if (!result.ok) throw new Error(result.reason === "quota" ? "Today's authoring allowance is used up." : "No model answered in time. Try again, or pick another model.");
      used = result.model;
      const parsed = Answer.safeParse(JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g, "")));
      if (!parsed.success) throw new Error(`${result.model} didn't answer in the expected shape. Try again.`);
      return parsed.data.stops.flatMap((stop) => {
        const segment = segments[stop.after - 1];
        if (!segment || stop.after - 1 < from || stop.after - 1 >= from + slice.length) {
          dropped += 1;
          return [];
        }
        const commands = stop.commands.map(squash).filter((command) => {
          const ok = command.length > 0 && command.length <= 300 && known.includes(command);
          if (!ok) dropped += 1;
          return ok;
        });
        // Just before the next sentence starts: the instruction is heard whole, and the player (which checks about four
        // times a second) stops before the narrator goes on.
        return [{ at: Math.min(Math.max(0, seconds - 0.5), Math.max(segment.start, segment.end - 0.1)), titleEs: stop.titleEs, titleEn: stop.titleEn, stepEs: stop.stepEs, stepEn: stop.stepEn, commands }];
      });
    }),
  );
  // Close stops become one: the first's title, both steps, every command once.
  const merged: DraftStop[] = [];
  for (const stop of results.flat().sort((a, b) => a.at - b.at)) {
    const last = merged.at(-1);
    if (last && stop.at - last.at < MIN_GAP_S) {
      last.at = stop.at;
      last.stepEs = `${last.stepEs} ${stop.stepEs}`;
      last.stepEn = `${last.stepEn} ${stop.stepEn}`;
      last.commands = [...new Set([...last.commands, ...stop.commands])];
    } else {
      merged.push({ ...stop });
    }
  }
  return { stops: merged, dropped, model: used };
}

type StopsRequest = { lessonId: string; media: string; model: string; userId: string; deadline: number };

/** Drafts the stops of one recording of a lesson (its audio, or one of its videos) without saving them. */
export async function planStops(input: StopsRequest): Promise<{ stops: DraftStop[]; dropped: number; model: string }> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: input.lessonId },
    select: {
      body: true,
      sourcePath: true,
      module: { select: { course: { select: { sourceRepoUrl: true, sourceRef: true } } } },
      audio: { select: { audioScript: true, audioSeconds: true, timings: true } },
      videos: { select: { id: true, video: true, durationSeconds: true } },
    },
  });
  if (!lesson) throw new Error("That lesson doesn't exist.");
  let segments: Segment[] | null = null;
  let seconds = 0;
  if (input.media === "audio") {
    if (!lesson.audio?.audioScript || !lesson.audio.audioSeconds) throw new Error("This lesson has no voiced audio yet.");
    seconds = lesson.audio.audioSeconds;
    segments = audioSegments(lesson.audio.audioScript, lesson.audio.timings, seconds);
  } else {
    const part = lesson.videos.find((video) => `video:${video.id}` === input.media);
    if (!part) throw new Error("That video isn't in this lesson.");
    seconds = part.durationSeconds ?? 0;
    if ((part.video as { type?: string } | null)?.type === "item-group") throw new Error("This is an interactive video: it stops at its own questions. Stops are for plain videos.");
    segments = await videoSegments(part.video, seconds);
    if (!segments) throw new Error("This video has no captions to read the steps from. Make its captions first (Admin → Videos).");
    if (!seconds) seconds = segments.at(-1)?.end ?? 0;
  }
  if (!segments.length) throw new Error("The recording's transcript is empty.");
  const text = (await lessonText(lesson.module.course, lesson, LESSON_CHARS)) ?? "";
  return draftStops(segments, text, seconds, input.model, input.userId, input.deadline);
}

/**
 * Writes the stops of one recording of a lesson, replacing the ones it had. Returns how many were written, and how many
 * of the model's suggestions the checks dropped.
 */
export async function generateStops(input: StopsRequest): Promise<{ written: number; dropped: number; model: string }> {
  const { stops, dropped, model } = await planStops(input);
  await prisma.$transaction([
    prisma.lessonStop.deleteMany({ where: { lessonId: input.lessonId, media: input.media } }),
    prisma.lessonStop.createMany({ data: stops.map((stop) => ({ ...stop, lessonId: input.lessonId, media: input.media, author: model })) }),
  ]);
  return { written: stops.length, dropped, model };
}
