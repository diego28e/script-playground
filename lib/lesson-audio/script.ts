import type { Content } from "@google/genai";
import { generateWithFallback, type ModelEntry } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { lessonText } from "@/lib/lesson-text";

// The script of a lesson's audio (docs/lesson-audio.md): a model reads the whole lesson and writes what a teacher would
// say to explain it, for Deepgram to voice (lib/lesson-audio/voice.ts). Not a reading of the page: it explains every
// part, expands where a listener needs more (an example, an analogy, why it matters), and says in words what the page
// shows as code, tables and diagrams.
//
// Lessons are long (the SRE course's run from 13,000 to 70,000 characters), longer than a model writes well in one
// answer, so the script is written part by part: the lesson is cut at its sections, and each part is written with the
// lesson's outline and the end of the part before it, so it reads as one lesson told by one teacher.

/**
 * The models that can write a script, the default first. They run on the practice worker, which has no request limit,
 * so each gets minutes rather than the seconds an Amplify request allows. Prices per 1M tokens, input / output, from
 * DolphinGo's price list (token.dolphingo.ai/api/pricing, 2026-11-19).
 */
//
// Compared on lesson 03.10 of the SRE course (2026-11-19, its first two parts): Qwen4-Max wrote the most teacher-like
// script, with analogies and pauses, and already wrote acronyms and IP ranges as a voice says them (about US$0.08 a
// lesson, 30 s a part). DeepSeek V4.1 Flash kept to the lesson as faithfully but read tables out as lists, for about a
// tenth of that (13 s a part). Qwen3.8 Flash was looser with the facts. The voice costs far more than any of them
// (about US$1 for a long lesson, lib/lesson-audio/voice.ts), so the default is the best writer.
export const NARRATION_MODELS: ReadonlyArray<ModelEntry & { price: string }> = [
  // US$1.413 / 4.240.
  { model: "dolphingo-qwen4-max", label: "Qwen4-Max", timeoutMs: 240_000, provider: "dolphingo", upstream: "qwen4-max", price: "about US$0.08 a lesson" },
  // US$0.149 / 0.596 (half that off-peak in China).
  { model: "dolphingo-deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", timeoutMs: 240_000, provider: "dolphingo", upstream: "DeepSeek-V4.1-Flash-1017", price: "about US$0.01 a lesson" },
  // US$0.119 / 0.403.
  { model: "dolphingo-qwen3.8-flash", label: "Qwen3.8 Flash", timeoutMs: 240_000, provider: "dolphingo", upstream: "qwen3.8-flash", price: "about US$0.01 a lesson" },
  // US$2 / 10: the platform's Anthropic credit, as the last fallback.
  { model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", timeoutMs: 240_000, provider: "anthropic", price: "about US$0.20 a lesson" },
];
export const DEFAULT_NARRATION_MODEL = NARRATION_MODELS[0].model;

export function isNarrationModel(model: string | null | undefined): model is string {
  return NARRATION_MODELS.some((entry) => entry.model === model);
}

/** The chosen model first, then the others in order, so a part is still written when one provider is down. */
export function narrationChain(model: string | undefined): ModelEntry[] {
  const chosen = NARRATION_MODELS.find((entry) => entry.model === model) ?? NARRATION_MODELS[0];
  return [chosen, ...NARRATION_MODELS.filter((entry) => entry !== chosen)];
}

/** The longest lesson text read; past it, the rest is left out (and said so). */
const LESSON_LIMIT = 150_000;
/** About how much lesson text one part covers. */
const PART_CHARS = 9_000;
/** A part's script: what the model is asked for, in words, from the part's own length. */
const WORDS_PER_SOURCE_WORD = 0.85;
const PART_WORDS = { min: 250, max: 1_600 };
/** The model ends every part with this line, so a cut-off answer is caught instead of voiced. */
const END = "[END]";

export const NARRATION_SYSTEM_PROMPT = `You are the teacher of an online course, recording the audio version of one lesson. Learners listen to it instead of reading the page, or before they open it: walking, commuting, away from a screen. You write the exact words you will say. A text-to-speech voice reads them as they are.

WHAT A GOOD AUDIO LESSON DOES
- It teaches everything the lesson teaches. Every idea, step, example, warning and conclusion of the text you are given is explained. Never skip a section, never just announce one ("next the lesson covers X") without teaching it.
- It explains like a good teacher speaking to one learner: warm, clear, direct, saying "you". It gives the reason behind each step, not only the step.
- It expands where a listener needs more than the page gives: a concrete example, an everyday comparison, why it matters in real work, the mistake people usually make. It doesn't pad: no repeating the same point, no filler praise, no "great question".
- It turns what only works on a page into speech:
  - Code: never read it symbol by symbol. Say what it does and why, and name only the parts the learner needs to recognise (a function, a command, a setting), the way an engineer says them aloud: "terraform plan", "the depends on argument".
  - Tables: say what the table shows and its main comparisons, not every cell.
  - Diagrams: describe the picture in words, following the path or the structure it shows.
  - Exercises and "try this" prompts: invite the learner to pause and think, then give them a moment ("Pause here and try to answer before I go on."), then explain the answer if the text gives it.
  - Links and file names: refer to them ("the link in the lesson", "the lab's README"), never spell out an address.
  - A sources, references or "checked against" section: don't read it out. At most one sentence that the lesson lists its sources.
  - Course logistics (time estimates, file names to open, setup steps for the page itself): only what a listener needs, briefly.
- It keeps the lesson's facts exactly. Never invent numbers, prices, limits, versions, product features, names, dates or stories that aren't in the text. If you add an example of your own, keep it general and obviously illustrative. When the text marks a case as real or as invented, say so the same way ("this one really happened", "this is an invented but realistic case"); never present an invented case as your own experience.
- It signposts, since a listener can't see headings: say where you are going, mark each turn ("Now", "Here's the catch", "So far"), and recap briefly after a hard part.

HOW TO WRITE FOR THE VOICE
- Plain text only: no Markdown, no headings, no bullet points, no numbered lists, no asterisks, no backticks, no emojis, no tables.
- Paragraphs of two to six sentences, separated by one blank line. Short sentences. End every sentence with a period, a question mark or an exclamation point; use commas where a speaker pauses.
- Say symbols and notation as words: "at least" for ≥, "and" for &, "dollars" after a number for $. Write IP addresses and ranges as an engineer says them: "ten dot zero dot zero dot zero slash sixteen".
- Acronyms: the way people say them. Spell out a letter-by-letter acronym with spaces only when it could be misread (A W S, V P C); keep the ones said as words as they are (NAT, RAM, JSON). Explain an acronym the first time it matters.
- Numbers as people say them: "about two hundred milliseconds", "three availability zones".

THE PART YOU WRITE
The lesson is written in parts, one per message, so that a long lesson is fully covered. You get the lesson's outline, which part this is, and how the part before it ended. Write only this part, so that it follows on from the previous part without a seam:
- The first part opens the lesson: in a few sentences, what the learner will understand by the end and why it matters (link it to the previous lesson when you're told which). No long welcome, no course name ceremony.
- A middle part continues where the last one stopped. No greeting, no "welcome back", no recap of the whole lesson.
- The last part closes the lesson: the few ideas to remember, said simply, and what to do next (practise, open the lab, the next lesson when you're told which).
Aim for the length you're given: it's a guide for covering this part well, not a quota to fill.

Write in the language you are told. End your answer with a line that holds only ${END}.`;

/** One part of a lesson: some of its sections, in order. */
export type NarrationPart = { headings: string[]; text: string };

/** A heading line's text, without its # marks. */
const headingText = (line: string) => line.replace(/^#+\s*/, "").trim();

/**
 * Cuts a lesson into parts of about PART_CHARS: at its level-2 headings, a long section again at level-3 headings
 * and then at blank lines, and neighbours joined while they fit.
 */
export function splitLesson(markdown: string): NarrationPart[] {
  const cut = (text: string, pattern: RegExp) => {
    const pieces: string[] = [];
    let current: string[] = [];
    let fence = false;
    for (const line of text.split("\n")) {
      if (/^\s*```/.test(line)) fence = !fence;
      if (!fence && pattern.test(line) && current.join("\n").trim()) {
        pieces.push(current.join("\n"));
        current = [];
      }
      current.push(line);
    }
    if (current.join("\n").trim()) pieces.push(current.join("\n"));
    return pieces;
  };
  const sections = cut(markdown, /^## /).flatMap((section) => {
    if (section.length <= PART_CHARS * 1.4) return [section];
    return cut(section, /^### /).flatMap((sub) => {
      if (sub.length <= PART_CHARS * 1.4) return [sub];
      // A long stretch with no headings: at paragraphs, never inside a code block.
      const pieces: string[] = [];
      let current = "";
      for (const paragraph of cut(sub, /^\s*$/)) {
        if (current && current.length + paragraph.length > PART_CHARS) {
          pieces.push(current);
          current = "";
        }
        current += (current ? "\n" : "") + paragraph;
      }
      if (current.trim()) pieces.push(current);
      return pieces;
    });
  });
  const parts: NarrationPart[] = [];
  for (const section of sections) {
    const headings = section.split("\n").filter((line) => /^#{1,3} /.test(line)).map(headingText);
    const last = parts.at(-1);
    if (last && last.text.length + section.length <= PART_CHARS) {
      last.text += `\n\n${section}`;
      last.headings.push(...headings);
    } else {
      parts.push({ headings, text: section });
    }
  }
  return parts;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * A part's answer as the voice gets it: Markdown left over taken out, paragraphs kept. Null when it was cut off: the
 * models sometimes leave out the end line on a complete answer, so one that ends on a finished sentence counts too.
 */
export function cleanPart(answer: string): string | null {
  const lines = answer.trim().split("\n");
  const endAt = lines.findLastIndex((line) => line.trim() === END);
  if (endAt === -1 && !/[.!?]["'”’)]?$/.test(answer.trim())) return null;
  const text = lines
    .slice(0, endAt === -1 ? lines.length : endAt)
    .join("\n")
    .replace(/^\s*```[a-z]*\s*$/gim, "")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

export type LessonForNarration = {
  id: string;
  code: string | null;
  title: string;
  objectives: string[];
  language: string;
  course: string;
  module: string;
  previous: string | null;
  next: string | null;
  text: string;
};

/** Everything the script is written from, or null when the lesson has no text to narrate. */
export async function lessonForNarration(lessonId: string): Promise<LessonForNarration | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      code: true,
      title: true,
      objectives: true,
      body: true,
      sourcePath: true,
      module: {
        select: {
          title: true,
          course: {
            select: {
              title: true,
              language: true,
              sourceRepoUrl: true,
              sourceRef: true,
              modules: { orderBy: { position: "asc" }, select: { lessons: { orderBy: { position: "asc" }, select: { id: true, code: true, title: true } } } },
            },
          },
        },
      },
    },
  });
  if (!lesson) return null;
  const course = lesson.module.course;
  const text = await lessonText(course, lesson, LESSON_LIMIT);
  if (!text?.trim()) return null;
  const sequence = course.modules.flatMap((courseModule) => courseModule.lessons);
  const index = sequence.findIndex((entry) => entry.id === lesson.id);
  const name = (entry: { code: string | null; title: string } | undefined) => (entry ? `${entry.code ? `${entry.code} · ` : ""}${entry.title.replaceAll("`", "")}` : null);
  return {
    id: lesson.id,
    code: lesson.code,
    title: lesson.title.replaceAll("`", ""),
    objectives: lesson.objectives,
    language: course.language,
    course: course.title,
    module: lesson.module.title,
    previous: name(sequence[index - 1]),
    next: name(sequence[index + 1]),
    text,
  };
}

/** The message for one part. */
export function partPrompt(lesson: LessonForNarration, parts: NarrationPart[], index: number, previousEnding: string | null): string {
  const part = parts[index];
  const target = Math.min(PART_WORDS.max, Math.max(PART_WORDS.min, Math.round(words(part.text) * WORDS_PER_SOURCE_WORD)));
  const outline = parts
    .map((entry, at) => `${at === index ? "→ " : "  "}Part ${at + 1}: ${entry.headings.join(" / ") || "(opening)"}`)
    .join("\n");
  const role =
    parts.length === 1
      ? "This is the whole lesson in one part: open it, teach it, and close it."
      : index === 0
        ? "This is the first part: open the lesson, then teach this part."
        : index === parts.length - 1
          ? "This is the last part: teach it, then close the lesson."
          : "This is a middle part: continue the lesson where the previous part stopped.";
  return [
    `LANGUAGE: ${lesson.language === "es" ? "Spanish (Latin American); keep technical terms in English, as Spanish-speaking engineers say them" : "English"}`,
    `COURSE: ${lesson.course}`,
    `MODULE: ${lesson.module}`,
    `LESSON: ${lesson.code ? `${lesson.code} · ` : ""}${lesson.title}`,
    lesson.objectives.length ? `BY THE END THE LEARNER CAN:\n${lesson.objectives.map((objective) => `- ${objective}`).join("\n")}` : "",
    `PREVIOUS LESSON: ${lesson.previous ?? "none (this is the course's first lesson)"}`,
    `NEXT LESSON: ${lesson.next ?? "none (this is the course's last lesson)"}`,
    `LESSON OUTLINE (${parts.length} ${parts.length === 1 ? "part" : "parts"}):\n${outline}`,
    `THIS PART: ${index + 1} of ${parts.length}. ${role}`,
    previousEnding ? `THE PREVIOUS PART ENDED WITH:\n"""\n${previousEnding}\n"""` : "",
    `LENGTH: about ${target} words for this part.`,
    `THE LESSON TEXT FOR THIS PART:\n"""\n${part.text}\n"""`,
    `Write only the words you will say for this part, then a last line with only ${END}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The last paragraphs of a part's script, for the next part to continue from. */
const ending = (script: string) => {
  const paragraphs = script.split("\n\n");
  let tail = "";
  for (let at = paragraphs.length - 1; at >= 0 && tail.length < 700; at--) tail = paragraphs[at] + (tail ? `\n\n${tail}` : "");
  return tail;
};

export type NarrationResult = { ok: true; script: string; model: string; parts: number; words: number } | { ok: false; error: string };

/**
 * Writes a lesson's whole script, part by part. `onProgress` follows it ("Writing part 2 of 5"). A part that comes back
 * cut off is asked again once; a part no model writes fails the script, and the caller retries it later.
 */
export async function writeNarration(input: {
  lessonId: string;
  userId: string;
  model?: string;
  onProgress?: (note: string) => Promise<void> | void;
}): Promise<NarrationResult> {
  const lesson = await lessonForNarration(input.lessonId);
  if (!lesson) return { ok: false, error: "The lesson has no text to narrate: no reading body, and its notebook couldn't be read from the course repository." };
  const parts = splitLesson(lesson.text);
  const scripts: string[] = [];
  const models = new Set<string>();
  for (let index = 0; index < parts.length; index++) {
    await input.onProgress?.(`Writing part ${index + 1} of ${parts.length}`);
    const contents: Content[] = [{ role: "user", parts: [{ text: partPrompt(lesson, parts, index, scripts.length ? ending(scripts.at(-1)!) : null) }] }];
    let written: string | null = null;
    for (let attempt = 0; attempt < 2 && !written; attempt++) {
      const result = await generateWithFallback({
        feature: "narrate",
        pool: "AUTHORING",
        userId: input.userId,
        models: narrationChain(input.model),
        chosenFirst: true,
        contents,
        config: { systemInstruction: NARRATION_SYSTEM_PROMPT, maxOutputTokens: 6_000, temperature: 0.7 },
      });
      if (!result.ok) {
        if (attempt === 1) return { ok: false, error: `Part ${index + 1} of ${parts.length}: no model wrote it (${result.reason}).` };
        continue;
      }
      written = cleanPart(result.text);
      if (written) models.add(result.model);
    }
    if (!written) return { ok: false, error: `Part ${index + 1} of ${parts.length} came back cut off twice.` };
    scripts.push(written);
  }
  const script = scripts.join("\n\n");
  return { ok: true, script, model: [...models].join(", "), parts: parts.length, words: words(script) };
}
