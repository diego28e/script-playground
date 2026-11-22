import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { authoringChain, generateWithFallback, isAuthoringModel } from "@/lib/ai/gemini";
import { gradeCode, type GradeOutcome } from "@/lib/practice/grader";
import { DOCS_VERSION, type DocLink } from "@/lib/compass/docs";
import { compassKit } from "@/lib/compass/kit";
import { COMPASS, type CompassLanguage } from "@/lib/compass/languages";
import { SYSTEM_PROMPT as JAVASCRIPT_PROMPT, proveJavaScriptCard } from "@/lib/compass/javascript/cards";

// Python Compass cards (docs/compass.md, "Cards"): what a learner reads about one Python concept. A model drafts it in
// the platform's voice from the concept, where the course uses it, and the official docs it may link to; the grader
// proves it (each example prints exactly what the card says; each mistake fails exactly as the card says); the admin
// reviews and publishes it. The JavaScript Compass's cards have the same shape; what they're written for, link to and
// run on is theirs (lib/compass/javascript/cards.ts), chosen by `language` (Python unless said).

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
  // JavaScript: the error it throws ("TypeError"), or the TypeScript error code tsc refuses it with ("TS2322").
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
export function toColumns(card: CardDraft, language: CompassLanguage = "python") {
  const kit = compassKit(language);
  const docs = card.docs.map(kit.docLink).filter((link): link is DocLink => link !== null);
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
    runtimeVersion: kit.runtime,
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
export function checkDraft(card: CardDraft, conceptKeys: Set<string>, language: CompassLanguage = "python"): string[] {
  const problems: string[] = [];
  const index = language === "python" ? `the Python ${DOCS_VERSION} docs index` : `the index of ${COMPASS[language].docs}`;
  for (const key of card.docs) if (!compassKit(language).docLink(key)) problems.push(`The docs link "${key}" isn't in ${index}.`);
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
function draftContext(
  concept: { key: string; group: string; labelEn: string; labelEs: string; lessonCount: number; firstLesson: string | null },
  allConcepts: { key: string; labelEn: string }[],
  language: CompassLanguage,
) {
  const kit = compassKit(language);
  const COURSE_INVENTORY = kit.inventory;
  const usage = COURSE_INVENTORY.concepts.find((entry) => entry.key === concept.key);
  const candidates = kit.docCandidates(concept);
  return [
    `# CONCEPT\nkey: ${concept.key}\ngroup: ${concept.group}\nname: ${concept.labelEn} / ${concept.labelEs}`,
    `# HOW THE COURSE USES IT\n${usage?.lessonCount ? `${usage.lessonCount} of ${COURSE_INVENTORY.taughtNotebooks} lessons, first in ${usage.firstLesson}.` : "The course doesn't use it yet."}${usage?.example ? `\nA line from lesson ${usage.example.lesson}: ${usage.example.line}` : ""}`,
    `# DOCS CANDIDATES (key | title | url)\n${candidates.map((link) => `${link.key} | ${link.title} | ${link.url}`).join("\n") || "(none: leave docs empty)"}`,
    `# CONCEPT KEYS\n${allConcepts.map((entry) => `${entry.key}: ${entry.labelEn}`).join("\n")}`,
  ].join("\n\n");
}

export const DEFAULT_CARD_MODEL = "claude-sonnet-5-5";
/** A repair works from the runtime's evidence: the cheapest model that follows JSON instructions is enough. */
export const DEFAULT_REPAIR_MODEL = "deepseek-flash";

const CARD_SHAPE = `{"titleEs": "…", "titleEn": "…", "summaryEs": "…", "summaryEn": "…", "explanationEs": "…", "explanationEn": "…", "whenEs": "…", "whenEn": "…",
 "examples": [{"code": "…", "output": "…", "noteEs": "…", "noteEn": "…"}],
 "mistakes": [{"code": "…", "raises": "…", "output": "…", "whyEs": "…", "whyEn": "…", "fixEs": "…", "fixEn": "…"}],
 "docs": ["…"], "related": ["…"]}`;

/** A model's draft of a concept's card, checked (links, related concepts) but not proven yet. */
export async function draftCard(input: {
  concept: { key: string; group: string; labelEn: string; labelEs: string; lessonCount: number; firstLesson: string | null };
  allConcepts: { key: string; labelEn: string }[];
  model?: string;
  instruction?: string;
  previous?: CardDraft;
  userId: string;
  deadline: number;
  language?: CompassLanguage;
}): Promise<{ ok: true; card: CardDraft; model: string; dropped: string[] } | { ok: false; error: string }> {
  const language = input.language ?? "python";
  const { docLink } = compassKit(language);
  const chosen = isAuthoringModel(input.model) ? input.model : DEFAULT_CARD_MODEL;
  const parts = [{ text: draftContext(input.concept, input.allConcepts, language) }];
  if (input.previous && input.instruction) {
    parts.push({ text: `# THE CURRENT CARD\n${JSON.stringify(input.previous)}\n\n# THE ADMIN'S INSTRUCTION\n${input.instruction}\n\nRewrite the card following the instruction; keep everything it doesn't mention.` });
  } else {
    parts.push({ text: "Write the card as the JSON object." });
  }
  // The exact keys: a model given only "JSON" (DeepSeek's mode, when Claude isn't available) otherwise names them its own way.
  parts.push({ text: `# THE JSON OBJECT'S SHAPE (these keys exactly, every one present)\n${CARD_SHAPE}` });
  // One more try when a field is missing or misshaped (a model in plain JSON mode sometimes drops one), told what it was.
  let card: CardDraft | null = null;
  let model = "";
  let why = "";
  for (let attempt = 0; attempt < 2 && !card; attempt++) {
    const retry = attempt ? [{ text: `Your last answer was missing or misshaped this: ${why}. Answer again with the whole card, every key present.` }] : [];
    const result = await generateWithFallback({
      feature: "compass",
      pool: "AUTHORING",
      userId: input.userId,
      models: authoringChain(chosen),
      chosenFirst: true,
      deadline: input.deadline,
      contents: [{ role: "user", parts: [...parts, ...retry] }],
      config: { systemInstruction: language === "javascript" ? JAVASCRIPT_PROMPT : SYSTEM_PROMPT, responseMimeType: "application/json", responseSchema: CARD_RESPONSE, maxOutputTokens: 6000, temperature: 0.4 },
    });
    if (!result.ok) return { ok: false, error: result.reason === "quota" ? "Today's authoring allowance is used up." : "No model could write the card in time. Try again." };
    model = result.model;
    try {
      card = CardSchema.parse(JSON.parse(result.text));
    } catch (error) {
      // What was wrong with it, so the retry (and the log) can say.
      const issue = error instanceof z.ZodError ? error.issues[0] : null;
      why = issue ? `${issue.path.join(".")}: ${issue.message}` : "not JSON";
      console.info(JSON.stringify({ event: "compass.card_invalid", model, why, attempt: attempt + 1 }));
    }
  }
  if (!card) return { ok: false, error: `${model} didn't answer with a valid card (${why}). Try again.` };
  // Links and related concepts the model invented are dropped, and said so.
  const keys = new Set(input.allConcepts.map((entry) => entry.key));
  const dropped = [...card.docs.filter((key) => !docLink(key)), ...card.related.filter((key) => !keys.has(key))];
  card = { ...card, docs: card.docs.filter((key) => docLink(key)), related: card.related.filter((key) => keys.has(key) && key !== input.concept.key) };
  return { ok: true, card, model, dropped };
}

// --- Repair ---------------------------------------------------------------------------------------------------------

/** Every field a repair may return; it returns only the ones it changed. */
const RepairSchema = CardSchema.partial();

/** The proof's failures as a model can act on them: the code, what the card claims, what really happened. */
function failuresOf(card: CardDraft, proof: CardProof, language: CompassLanguage): string {
  const fence = language === "javascript" ? "ts" : "python";
  return proof.items
    .filter((item) => !item.ok)
    .map((item) => {
      const part = item.kind === "example" ? card.examples[item.index] : card.mistakes[item.index];
      const name = `${item.kind === "example" ? "examples" : "mistakes"}[${item.index}]`;
      const claim =
        item.kind === "example"
          ? `The card says it compiles and prints:\n${item.expected || "(nothing)"}`
          : card.mistakes[item.index]?.raises
            ? `The card says it fails with: ${item.expected}`
            : `The card says it runs and prints:\n${item.expected || "(nothing)"}`;
      const happened = item.error ? `What really happened: ${item.error}${item.actual ? `\nIt printed before that:\n${item.actual}` : ""}` : `What really happened: it printed:\n${item.actual || "(nothing)"}`;
      return `## ${name}\n\`\`\`${fence}\n${part?.code ?? ""}\n\`\`\`\n${claim}\n${happened}`;
    })
    .join("\n\n");
}

const REPAIR_RULES = `# YOUR TASK: REPAIR THE CARD
The card above was run, and the parts listed under FAILURES didn't behave as the card says. The runtime is the truth. Repair only those parts, so that every one of them behaves exactly as the card then says:
- An example must compile with no type error and print exactly its output. If the code is right and shows the point, keep the code and set "output" to exactly what it printed. If the compiler refused it or it threw, rewrite the code so it compiles under the same strict checks and still shows the same point (for example, compare values held in variables instead of literals the checker can see through, or widen a type with an annotation), then work out line by line exactly what the new code prints and put that in "output".
- A mistake must fail exactly as its "raises" says (the error's name, or the TypeScript code such as TS2322), or, with "raises" empty, print exactly its "output". Make the code fail that way, or, if the failure that really happens teaches the same mistake, change "raises" to it. Its why and fix texts must describe what really happens.
- If you change an example's or a mistake's code, update the notes, the why and fix texts, and any sentence of the explanation that describes that code, in both languages. Change nothing else: every other text stays exactly as it is.
- Answer with a JSON object holding ONLY the fields you changed, each one whole: "examples" and "mistakes" as the complete arrays (every item, the unchanged ones copied exactly), and any text field you rewrote. Use the same keys as the card.`;

/**
 * Repairs a card from its proof (docs/compass.md, "Fix with AI"): a model is shown the card, each failed example or
 * mistake with its code, what the card claims and what the runtime really did, and returns only the fields it changes.
 * A fresh draft makes the same mistakes from scratch; a repair works from the evidence, so a cheap model is enough.
 */
export async function repairCard(input: {
  card: CardDraft;
  proof: CardProof;
  allConcepts: { key: string }[];
  conceptKey: string;
  model?: string;
  userId: string;
  deadline: number;
  language?: CompassLanguage;
}): Promise<{ ok: true; card: CardDraft; model: string; changed: string[] } | { ok: false; error: string }> {
  const language = input.language ?? "python";
  const { docLink } = compassKit(language);
  if (input.proof.ok || !input.proof.items.some((item) => !item.ok)) return { ok: false, error: "Nothing failed: there's nothing to repair." };
  const chosen = isAuthoringModel(input.model) ? input.model : DEFAULT_REPAIR_MODEL;
  const text = [`# THE CARD\n${JSON.stringify(input.card)}`, `# FAILURES (the runtime is the truth)\n${failuresOf(input.card, input.proof, language)}`, REPAIR_RULES].join("\n\n");
  let patch: z.infer<typeof RepairSchema> | null = null;
  let model = "";
  let why = "";
  for (let attempt = 0; attempt < 2 && !patch; attempt++) {
    const retry = attempt ? [{ text: `Your last answer couldn't be used: ${why}. Answer again with the changed fields only, as JSON.` }] : [];
    const result = await generateWithFallback({
      feature: "compass",
      pool: "AUTHORING",
      userId: input.userId,
      models: authoringChain(chosen),
      chosenFirst: true,
      deadline: input.deadline,
      contents: [{ role: "user", parts: [{ text }, ...retry] }],
      config: { systemInstruction: language === "javascript" ? JAVASCRIPT_PROMPT : SYSTEM_PROMPT, responseMimeType: "application/json", maxOutputTokens: 4000, temperature: 0.2 },
    });
    if (!result.ok) return { ok: false, error: result.reason === "quota" ? "Today's authoring allowance is used up." : "No model could repair the card in time. Try again." };
    model = result.model;
    try {
      patch = RepairSchema.parse(JSON.parse(result.text));
      if (!Object.keys(patch).length) {
        why = "it changed nothing";
        patch = null;
      }
    } catch (error) {
      const issue = error instanceof z.ZodError ? error.issues[0] : null;
      why = issue ? `${issue.path.join(".")}: ${issue.message}` : "not JSON";
      console.info(JSON.stringify({ event: "compass.repair_invalid", model, why, attempt: attempt + 1 }));
    }
  }
  if (!patch) return { ok: false, error: `${model} didn't answer with a usable repair (${why}). Try again.` };
  const merged = CardSchema.safeParse({ ...input.card, ...patch });
  if (!merged.success) return { ok: false, error: `The repaired card isn't complete: ${merged.error.issues[0]?.path.join(".")} ${merged.error.issues[0]?.message}` };
  const keys = new Set(input.allConcepts.map((entry) => entry.key));
  const card = { ...merged.data, docs: merged.data.docs.filter((key) => docLink(key)), related: merged.data.related.filter((key) => keys.has(key) && key !== input.conceptKey) };
  return { ok: true, card, model, changed: Object.keys(patch) };
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

// The grader runs code as a module named "solution" (infra/lab/grader/harness.py), so a class defined in it prints as
// <class 'solution.Price'>. A learner running the example (the scratchbook's sandbox) or the same code in Jupyter runs
// it as __main__ and sees <class '__main__.Price'>: the proof runs it the learner's way. An error raised inside still
// reaches the grader with its own type.
function asMain(code: string): string {
  return `exec(compile(${JSON.stringify(code)}, "<card>", "exec"), {"__name__": "__main__"})\n`;
}

/**
 * Runs every example and mistake on the grader, as the learner would: an example must print exactly its output,
 * without an error; a mistake must raise the exception it names, or print exactly its output.
 */
export async function proveCard(card: CardDraft, language: CompassLanguage = "python"): Promise<CardProof> {
  if (language === "javascript") return proveJavaScriptCard(card);
  const run = (code: string) => gradeCode({ code: asMain(code), timeoutMs: 10_000 });
  const runs = await Promise.all([...card.examples.map((example) => run(example.code)), ...card.mistakes.map((mistake) => run(mistake.code))]);
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
