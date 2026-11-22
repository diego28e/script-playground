import { gradeCode, type GradeOutcome } from "@/lib/practice/grader";
import type { CardDraft, CardProof, ProofItem } from "@/lib/compass/cards";

// JavaScript Compass cards (docs/compass.md, "JavaScript"): the writing instructions and the proof for the TypeScript
// course's cards. The card's shape is Python's (lib/compass/cards.ts); what changes is what its code runs on, Node.js 26
// with TypeScript 7 checking it (the grader's TypeScript sandbox), and one more kind of mistake: code tsc refuses, named
// by its error code ("TS2322"), since a type's whole point is what it lets through and what it doesn't.

export const RUNTIME = "Node.js 26.13.1, TypeScript 7.0.2";

export const SYSTEM_PROMPT = `You write one concept card of the JavaScript Compass: the guide that helps learners of a backend course (TypeScript, Node.js, then NestJS) with the JavaScript and TypeScript they meet in it. They are learning TypeScript for the backend and may be shaky on JavaScript itself.

VOICE: a calm, precise, warm senior developer pairing with a junior. Short sentences, one idea each, "you". Always the why behind a choice. Never "simply", "just", "obviously", "easy". Spanish is Latin American, uses "tú", and keeps technical terms in English the way developers say them (string, array, object, arrow function, callback, promise, type, union, generic). Both languages say the same thing.

THE CARD:
- title: the concept's name as a learner would search for it (short).
- summary: one sentence a newcomer can repeat.
- explanation (Markdown, 80 to 180 words): what it is, how to read it, and why it's written that way. Use \`inline code\` for code; at most one tiny code block. Where natural, tie it to how the course uses it (the course lines below). For type syntax, say what the type checker does with it and that it is gone when Node runs the code.
- when: one or two sentences, "Reach for it when…" / "Úsalo cuando…".
- examples (1 to 3): tiny, self-contained TypeScript programs that run as they are: Node.js 26 runs them (it strips the types) after tsc 7 checks them in strict mode, with Node's built-in modules only (import from "node:…"). No npm packages, no network, no files outside /tmp, no randomness, no clocks, no enum, namespace or parameter properties. Each example compiles with NO type error and prints something with console.log, and "output" is EXACTLY what Node prints (it will be run and compared). Print strings, numbers and booleans directly, and objects or arrays with JSON.stringify. The first example is the simplest possible; a second one may show it the way the course uses it. A short note per example says what to notice. For a type-level concept, the example shows the type at work in code that runs and prints.
- Everything must be true on ${RUNTIME}.
- mistakes (0 to 2): the errors beginners really make with it, as tiny programs. Either tsc refuses it (put the TypeScript error code in "raises", e.g. "TS2322", and leave "output" empty: the most useful mistake for type syntax), or it throws when it runs (put the error's name in "raises", e.g. "TypeError", and leave "output" empty), or it runs but prints something the learner didn't intend (leave "raises" empty and put exactly what it prints in "output"; the code must compile). "why" explains it plainly; "fix" says how to write it right. Only real, common mistakes; none is better than a made-up one.
- docs (0 to 3): keys picked ONLY from the DOCS CANDIDATES list below, the best first: MDN's reference or guide for a beginner, the Node.js docs for Node's modules. Never invent a key or a URL. When the list is empty (TypeScript's types: its own docs aren't in the index), leave docs empty.
- related (0 to 5): keys picked ONLY from the CONCEPT KEYS list below: what it builds on and what it leads to.

Return the JSON object only.`;

const normalise = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

type Ran = Exclude<GradeOutcome, { status: "unavailable" }>;

/** What tsc reported, as codes, and the error the code hit while it ran (not tsc's). */
function read(run: Ran) {
  const codes = (run.diagnostics ?? []).map((entry) => entry.code);
  const thrown = run.error && run.error.type !== "CompileError" ? run.error.type : null;
  const failure = run.status === "timeout" ? "Timeout" : thrown ? `${thrown}: ${run.error?.message ?? ""}` : codes.length ? `tsc: ${(run.diagnostics ?? []).map((entry) => `${entry.code} ${entry.message}`).join("; ")}` : null;
  return { codes, thrown, failure };
}

/**
 * Runs every example and mistake in the TypeScript sandbox, as a learner would: an example must compile with no error
 * and print exactly its output; a mistake must be refused by tsc with the code it names, throw the error it names, or
 * compile and print exactly its output.
 */
export async function proveJavaScriptCard(card: CardDraft): Promise<CardProof> {
  const run = (code: string) => gradeCode({ code, timeoutMs: 10_000, language: "typescript" });
  const runs = await Promise.all([...card.examples.map((example) => run(example.code)), ...card.mistakes.map((mistake) => run(mistake.code))]);
  const unavailable = runs.find((outcome) => outcome.status === "unavailable");
  if (unavailable && unavailable.status === "unavailable") return { ok: false, items: [], ranAt: new Date().toISOString(), unavailable: unavailable.message };
  const items: ProofItem[] = [];
  card.examples.forEach((example, index) => {
    const outcome = runs[index] as Ran;
    const { failure } = read(outcome);
    items.push({ kind: "example", index, ok: !failure && normalise(outcome.stdout) === normalise(example.output), expected: example.output, actual: outcome.stdout, error: failure });
  });
  card.mistakes.forEach((mistake, index) => {
    const outcome = runs[card.examples.length + index] as Ran;
    const { codes, thrown, failure } = read(outcome);
    let ok: boolean;
    let actual: string;
    if (/^TS\d+$/.test(mistake.raises)) {
      ok = codes.includes(mistake.raises);
      actual = codes.length ? codes.join(", ") : "(tsc found no error)";
    } else if (mistake.raises) {
      // What the card says happens when it runs: it throws that error. tsc may refuse the same code too (assigning to a
      // const is TS2588 and a TypeError); a card that wants tsc's view names the code instead.
      ok = thrown === mistake.raises;
      actual = thrown ?? (codes.length ? `tsc: ${codes.join(", ")}` : outcome.stdout || "(no error)");
    } else {
      ok = !failure && normalise(outcome.stdout) === normalise(mistake.output);
      actual = outcome.stdout;
    }
    // "Use the real outputs" may take an output only when the code ran cleanly: the error stays for the admin.
    items.push({ kind: "mistake", index, ok, expected: mistake.raises || mistake.output, actual, error: mistake.raises ? null : failure });
  });
  return { ok: items.every((item) => item.ok), items, ranAt: new Date().toISOString() };
}
