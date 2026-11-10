import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { AUTHORING_CHAIN, chainStartingAt, generateWithFallback } from "@/lib/ai/gemini";
import { gradeCode, type GradeOutcome } from "@/lib/practice/grader";
import { COURSE_INVENTORY } from "@/lib/compass/concepts";
import { DOCS_VERSION, docCandidates, docLink, type DocLink } from "@/lib/compass/docs";

// Python Compass cards (docs/compass.md, "Cards"): what a learner reads about one Python concept. A model drafts it in
// the platform's voice from the concept, where the course uses it, and the official docs it may link to; the grader
// proves it (each example prints exactly what the card says; each mistake fails exactly as the card says); the admin
// reviews and publishes it.

const Bilingual = { es: z.string().trim().min(1), en: z.string().trim().min(1) };

export const ExampleSchema = z.object({
  code: z.string().trim().min(1).max(2000),
  // What it prints, exactly; the grader checks it.
  output: z.string().max(2000),
  noteEs: z.string().trim().max(400).default(""),
  noteEn: z.string().trim().max(400).default(""),
});
export const MistakeSchema = z.object({
  code: z.string().trim().min(1).max(2000),
  // The exception it raises ("KeyError"), or empty when it runs but prints something other than intended (`output`).
  raises: z.string().trim().max(60).default(""),
  output: z.string().max(2000).default(""),
  whyEs: z.string().trim().min(1).max(600),
  whyEn: z.string().trim().min(1).max(600),
  fixEs: z.string().trim().max(400).default(""),
  fixEn: z.string().trim().max(400).default(""),
});
export const CardSchema = z.object({
  titleEs: Bilingual.es.max(120),
  titleEn: Bilingual.en.max(120),
  summaryEs: Bilingual.es.max(300),
  summaryEn: Bilingual.en.max(300),
  explanationEs: Bilingual.es.max(4000),
  explanationEn: Bilingual.en.max(4000),
  whenEs: Bilingual.es.max(500),
  whenEn: Bilingual.en.max(500),
  examples: z.array(ExampleSchema).min(1).max(3),
  mistakes: z.array(MistakeSchema).max(2),
  // Keys of the docs index (or a package's site): checked, never free URLs.
  docs: z.array(z.string()).min(0).max(4),
  // Other concepts' keys.
  related: z.array(z.string()).max(6),
});
export type CardDraft = z.infer<typeof CardSchema>;

/** The parts stored in CompassCard's JSON columns. */
export function toColumns(card: CardDraft) {
  const docs = card.docs.map(docLink).filter((link): link is DocLink => link !== null);
  return {
    content: {
      titleEs: card.titleEs,
      titleEn: card.titleEn,
      summaryEs: card.summaryEs,
      summaryEn: card.summaryEn,
      explanationEs: card.explanationEs,
      explanationEn: card.explanationEn,
      whenEs: card.whenEs,
      whenEn: card.whenEn,
    },
    examples: { examples: card.examples, mistakes: card.mistakes },
    docs,
    related: card.related,
  };
}

/** A stored card back as a draft (for editing). */
export function fromColumns(row: { content: unknown; examples: unknown; docs: unknown; related: string[] }): CardDraft {
  const content = row.content as Record<string, string>;
  const examples = row.examples as { examples: CardDraft["examples"]; mistakes: CardDraft["mistakes"] };
  return {
    titleEs: content.titleEs,
    titleEn: content.titleEn,
    summaryEs: content.summaryEs,
    summaryEn: content.summaryEn,
    explanationEs: content.explanationEs,
    explanationEn: content.explanationEn,
    whenEs: content.whenEs,
    whenEn: content.whenEn,
    examples: examples.examples,
    mistakes: examples.mistakes,
    docs: (row.docs as DocLink[]).map((link) => link.key),
    related: row.related,
  };
}

/** What a draft gets wrong before anything runs: links that aren't in the index, concepts that don't exist. */
export function checkDraft(card: CardDraft, conceptKeys: Set<string>): string[] {
  const problems: string[] = [];
  for (const key of card.docs) if (!docLink(key)) problems.push(`The docs link "${key}" isn't in the Python ${DOCS_VERSION} docs index.`);
  for (const key of card.related) if (!conceptKeys.has(key)) problems.push(`The related concept "${key}" doesn't exist.`);
  for (const mistake of card.mistakes) if (!mistake.raises && !mistake.output) problems.push("A mistake must either raise an error or print an output.");
  return problems;
}

const STRING = { type: Type.STRING };
const CARD_RESPONSE: Schema = {
  type: Type.OBJECT,
  properties: {
    titleEs: STRING,
    titleEn: STRING,
    summaryEs: STRING,
    summaryEn: STRING,
    explanationEs: STRING,
    explanationEn: STRING,
    whenEs: STRING,
    whenEn: STRING,
    examples: {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: { code: STRING, output: STRING, noteEs: STRING, noteEn: STRING }, required: ["code", "output", "noteEs", "noteEn"] },
    },
    mistakes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { code: STRING, raises: STRING, output: STRING, whyEs: STRING, whyEn: STRING, fixEs: STRING, fixEn: STRING },
        required: ["code", "raises", "output", "whyEs", "whyEn", "fixEs", "fixEn"],
      },
    },
    docs: { type: Type.ARRAY, items: STRING },
    related: { type: Type.ARRAY, items: STRING },
  },
  required: ["titleEs", "titleEn", "summaryEs", "summaryEn", "explanationEs", "explanationEn", "whenEs", "whenEn", "examples", "mistakes", "docs", "related"],
};

const SYSTEM_PROMPT = `You write one concept card of the Python Compass: the guide that helps learners of a LangChain course with the Python they meet in it. They are new to LangChain and often shaky on Python.

VOICE: a calm, precise, warm senior developer pairing with a junior. Short sentences, one idea each, "you". Always the why behind a choice. Never "simply", "just", "obviously", "easy". Spanish is Latin American, uses "tú", and keeps technical terms in English the way developers say them (string, list, dict, f-string, keyword argument, type hint). Both languages say the same thing.

THE CARD:
- title: the concept's name as a learner would search for it (short).
- summary: one sentence a newcomer can repeat.
- explanation (Markdown, 80 to 180 words): what it is, how to read it, and why it's written that way. Use \`inline code\` for code; at most one tiny code block. Where natural, tie it to how the course uses it (the course lines below).
- when: one or two sentences, "Reach for it when…" / "Úsalo cuando…".
- examples (1 to 3): tiny, self-contained programs that run as they are on Python ${DOCS_VERSION} with the standard library only. No input(), no network, no files, no randomness, no clocks, no LangChain. Each prints something, and "output" is EXACTLY what it prints (it will be run and compared). The first example is the simplest possible; a second one may show it the way the course uses it (plain Python stand-ins, not real LangChain). A short note per example says what to notice.
- Everything must be true on Python ${DOCS_VERSION}. Don't present limits that newer versions removed as mistakes (since 3.12, an f-string may reuse its own quote character inside the braces).
- mistakes (0 to 2): the errors beginners really make with it, as tiny programs. Either it raises (put the exception class name in "raises", e.g. "KeyError", and leave "output" empty), or it runs but prints something the learner didn't intend (leave "raises" empty and put exactly what it prints in "output"). "why" explains it plainly; "fix" says how to write it right. Only real, common mistakes; none is better than a made-up one.
- docs (1 to 3): keys picked ONLY from the DOCS CANDIDATES list below, the best first: the tutorial or glossary for a beginner before the reference. Never invent a key or a URL.
- related (0 to 5): keys picked ONLY from the CONCEPT KEYS list below: what it builds on and what it leads to.

Return the JSON object only.`;

/** Everything the model needs about one concept. */
function draftContext(concept: { key: string; group: string; labelEn: string; labelEs: string; lessonCount: number; firstLesson: string | null }, allConcepts: { key: string; labelEn: string }[]) {
  const usage = COURSE_INVENTORY.concepts.find((entry) => entry.key === concept.key) as
    | { lessonCount: number; firstLesson: string | null; example: { lesson: string; line: string } | null; lessons: string[] }
    | undefined;
  const candidates = docCandidates(concept);
  return [
    `# CONCEPT\nkey: ${concept.key}\ngroup: ${concept.group}\nname: ${concept.labelEn} / ${concept.labelEs}`,
    `# HOW THE COURSE USES IT\n${usage?.lessonCount ? `${usage.lessonCount} of ${COURSE_INVENTORY.taughtNotebooks} lessons, first in ${usage.firstLesson}.` : "The course doesn't use it yet."}${usage?.example ? `\nA line from lesson ${usage.example.lesson}: ${usage.example.line}` : ""}`,
    `# DOCS CANDIDATES (key | title | url)\n${candidates.map((link) => `${link.key} | ${link.title} | ${link.url}`).join("\n") || "(none: leave docs empty)"}`,
    `# CONCEPT KEYS\n${allConcepts.map((entry) => `${entry.key}: ${entry.labelEn}`).join("\n")}`,
  ].join("\n\n");
}

export const DEFAULT_CARD_MODEL = "claude-sonnet-5-5";

/** A model's draft of a concept's card, checked (links, related concepts) but not proven yet. */
export async function draftCard(input: {
  concept: { key: string; group: string; labelEn: string; labelEs: string; lessonCount: number; firstLesson: string | null };
  allConcepts: { key: string; labelEn: string }[];
  model?: string;
  instruction?: string;
  previous?: CardDraft;
  userId: string;
  deadline: number;
}): Promise<{ ok: true; card: CardDraft; model: string; dropped: string[] } | { ok: false; error: string }> {
  const chosen = AUTHORING_CHAIN.some((entry) => entry.model === input.model) ? input.model! : DEFAULT_CARD_MODEL;
  const parts = [{ text: draftContext(input.concept, input.allConcepts) }];
  if (input.previous && input.instruction) {
    parts.push({ text: `# THE CURRENT CARD\n${JSON.stringify(input.previous)}\n\n# THE ADMIN'S INSTRUCTION\n${input.instruction}\n\nRewrite the card following the instruction; keep everything it doesn't mention.` });
  } else {
    parts.push({ text: "Write the card as the JSON object." });
  }
  const result = await generateWithFallback({
    feature: "compass",
    pool: "AUTHORING",
    userId: input.userId,
    models: chainStartingAt(AUTHORING_CHAIN, chosen),
    chosenFirst: true,
    deadline: input.deadline,
    contents: [{ role: "user", parts }],
    config: { systemInstruction: SYSTEM_PROMPT, responseMimeType: "application/json", responseSchema: CARD_RESPONSE, maxOutputTokens: 6000, temperature: 0.4 },
  });
  if (!result.ok) return { ok: false, error: result.reason === "quota" ? "Today's authoring allowance is used up." : "No model could write the card in time. Try again." };
  let card: CardDraft;
  try {
    card = CardSchema.parse(JSON.parse(result.text));
  } catch {
    return { ok: false, error: `${result.model} didn't answer with a valid card. Try again.` };
  }
  // Links and related concepts the model invented are dropped, and said so.
  const keys = new Set(input.allConcepts.map((entry) => entry.key));
  const dropped = [...card.docs.filter((key) => !docLink(key)), ...card.related.filter((key) => !keys.has(key))];
  card = { ...card, docs: card.docs.filter((key) => docLink(key)), related: card.related.filter((key) => keys.has(key) && key !== input.concept.key) };
  return { ok: true, card, model: result.model, dropped };
}

// --- Proof ----------------------------------------------------------------------------------------------------------

export type ProofItem = { kind: "example" | "mistake"; index: number; ok: boolean; expected: string; actual: string; error: string | null };
export type CardProof = { ok: boolean; items: ProofItem[]; ranAt: string; unavailable?: string };

const normalise = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

function describe(outcome: GradeOutcome): { stdout: string; error: string | null } {
  if (outcome.status === "unavailable") return { stdout: "", error: outcome.message };
  if (outcome.status === "timeout") return { stdout: outcome.stdout, error: "Timeout" };
  return { stdout: outcome.stdout, error: outcome.error ? `${outcome.error.type}: ${outcome.error.message}` : null };
}

/**
 * Runs every example and mistake on the grader: an example must print exactly its output, without an error; a mistake
 * must raise the exception it names, or print exactly its output.
 */
export async function proveCard(card: CardDraft): Promise<CardProof> {
  const runs = await Promise.all([...card.examples.map((example) => gradeCode({ code: example.code, timeoutMs: 10_000 })), ...card.mistakes.map((mistake) => gradeCode({ code: mistake.code, timeoutMs: 10_000 }))]);
  const unavailable = runs.find((run) => run.status === "unavailable");
  if (unavailable && unavailable.status === "unavailable") return { ok: false, items: [], ranAt: new Date().toISOString(), unavailable: unavailable.message };
  const items: ProofItem[] = [];
  card.examples.forEach((example, index) => {
    const { stdout, error } = describe(runs[index]);
    items.push({ kind: "example", index, ok: !error && normalise(stdout) === normalise(example.output), expected: example.output, actual: stdout, error });
  });
  card.mistakes.forEach((mistake, index) => {
    const run = runs[card.examples.length + index];
    const { stdout, error } = describe(run);
    const raised = run.status !== "unavailable" && run.error ? run.error.type : null;
    const ok = mistake.raises ? raised === mistake.raises : !error && normalise(stdout) === normalise(mistake.output);
    items.push({ kind: "mistake", index, ok, expected: mistake.raises || mistake.output, actual: mistake.raises ? (raised ?? (stdout || "(no error)")) : stdout, error });
  });
  return { ok: items.every((item) => item.ok), items, ranAt: new Date().toISOString() };
}
