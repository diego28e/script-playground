import { clipText, lessonSource } from "@/lib/lesson-text";

// The parts of an interview-challenge lesson (the "Live-Coding Interview Challenges in TypeScript" course), so each AI
// feature gets the parts it needs instead of a lesson's first N characters (docs/whiteboard-interview-mode.md §4).
//
// A challenge lesson has a fixed shape: the title, **Time:**, ## Learning objectives, ## Your setup, ## The challenge
// (with ### subsections), ## Interview follow-up questions, then ## Solutions with ### Talking it through in an
// interview, ### The reference solution, ### How the tests check it and ### Answers to the follow-up questions. It's
// recognized by its ## The challenge and ## Solutions headings; any other lesson isn't split, and its callers keep
// cutting it at their own limit as before.
//
// The parts are kept apart, each with its own budget, so the whiteboard's interview mode (proposed, not built) can send
// brief, followUps and interviewerNotes at the start and reference and modelAnswers only at the debrief. A new part,
// such as the proposal's ### Hints, is an entry in CHALLENGE_BUDGETS, SOLUTION_SECTIONS, HEADINGS and NAMES.

/** Each part's budget, in characters (docs/whiteboard-interview-mode.md §4); a longer part is clipped with clipText's note (clipPart). */
export const CHALLENGE_BUDGETS = {
  brief: 14_000,
  followUps: 2_000,
  interviewerNotes: 3_000,
  reference: 8_000,
  modelAnswers: 12_000,
} as const;

export type ChallengePart = keyof typeof CHALLENGE_BUDGETS;

/** A challenge lesson's parts, whole (not clipped); null when the lesson doesn't have that section. */
export type ChallengeParts = Record<ChallengePart, string | null>;

/** The parts that give the solution away. */
export const SOLUTION_PARTS: ReadonlySet<ChallengePart> = new Set(["interviewerNotes", "reference", "modelAnswers"]);

/** The ### sections under ## Solutions that make each solution part, in the lesson's order. */
const SOLUTION_SECTIONS: Record<Exclude<ChallengePart, "brief" | "followUps">, string[]> = {
  interviewerNotes: ["talking it through in an interview"],
  reference: ["the reference solution", "how the tests check it"],
  modelAnswers: ["answers to the follow-up questions"],
};

/** The heading a part is shown under when the parts are put back together. reference keeps its own two ### headings. */
const HEADINGS: Record<ChallengePart, string | null> = {
  brief: null,
  followUps: "## Interview follow-up questions",
  interviewerNotes: "### Talking it through in an interview",
  reference: null,
  modelAnswers: "### Answers to the follow-up questions",
};

type Heading = { level: 2 | 3; title: string; line: number };

/** The ## and ### headings outside code fences, with their line numbers. */
function headingsOf(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (match) headings.push({ level: match[1].length as 2 | 3, title: match[2].trim().toLowerCase(), line: index });
  });
  return headings;
}

/** Lines from..to as text, without the blank lines and --- dividers at either end. */
function slice(lines: string[], from: number, to: number): string {
  const part = lines.slice(from, to);
  const edge = (line: string | undefined) => line !== undefined && (!line.trim() || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line));
  while (edge(part[0])) part.shift();
  while (edge(part[part.length - 1])) part.pop();
  return part.join("\n");
}

/** Whether a lesson's text is an interview challenge: it has ## The challenge and ## Solutions. */
export function isChallengeLesson(text: string): boolean {
  const titles = headingsOf(text.replace(/\r/g, "").split("\n")).filter((heading) => heading.level === 2).map((heading) => heading.title);
  return titles.includes("the challenge") && titles.includes("solutions");
}

/** A challenge lesson's parts, whole, or null when the text isn't a challenge lesson. */
export function challengeParts(text: string): ChallengeParts | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const headings = headingsOf(lines);
  const h2 = headings.filter((heading) => heading.level === 2);
  const find = (title: string) => h2.findIndex((heading) => heading.title === title);
  const challenge = find("the challenge");
  const solutions = find("solutions");
  if (challenge < 0 || solutions < 0) return null;
  /** Where the ## section at `index` ends: the next ## heading, or the end. */
  const endOf = (index: number) => h2[index + 1]?.line ?? lines.length;

  // The brief: from the start to the follow-up questions (or to the solutions, when there are none), without the setup.
  const followUps = find("interview follow-up questions");
  const briefEnd = followUps >= 0 && followUps < solutions ? h2[followUps].line : h2[solutions].line;
  const setup = find("your setup");
  const briefLines = setup >= 0 && h2[setup].line < briefEnd ? [...lines.slice(0, h2[setup].line), ...lines.slice(endOf(setup), briefEnd)] : lines.slice(0, briefEnd);

  // The solution's ### sections, up to the next ## heading.
  const solutionsEnd = endOf(solutions);
  const h3 = headings.filter((heading) => heading.level === 3 && heading.line > h2[solutions].line && heading.line < solutionsEnd);
  const section = (title: string, withHeading: boolean): string | null => {
    const index = h3.findIndex((heading) => heading.title === title);
    if (index < 0) return null;
    const start = h3[index].line;
    const text = slice(lines, withHeading ? start : start + 1, h3[index + 1]?.line ?? solutionsEnd);
    return text || null;
  };
  const solutionPart = (part: keyof typeof SOLUTION_SECTIONS): string | null => {
    const titles = SOLUTION_SECTIONS[part];
    // A part made of several sections keeps their headings, so the model can tell them apart.
    const found = titles.map((title) => section(title, titles.length > 1)).filter((text): text is string => Boolean(text));
    return found.length ? found.join("\n\n") : null;
  };

  return {
    brief: slice(briefLines, 0, briefLines.length) || null,
    followUps: followUps >= 0 ? slice(lines, h2[followUps].line + 1, endOf(followUps)) || null : null,
    interviewerNotes: solutionPart("interviewerNotes"),
    reference: solutionPart("reference"),
    modelAnswers: solutionPart("modelAnswers"),
  };
}

/** clipText's cut and note, closing a code block the cut lands in, so the note isn't read as code. */
export function clipPart(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const open = (head.match(/^\s*(```|~~~)/gm)?.length ?? 0) % 2 === 1;
  return `${head}${open ? "\n```" : ""}\n… (${text.length - max} more characters)`;
}

/** A part as it's shown, under its heading. */
const shown = (part: ChallengePart, text: string) => (HEADINGS[part] ? `${HEADINGS[part]}\n\n${text}` : text);

const SEPARATOR = "\n\n";
const SOLUTIONS_HEADING = "---\n\n## Solutions";
/** Room for clipText's note, and for the closing note naming the parts left out. */
const CLIP_NOTE = 40;
const LEFT_NOTE = 160;
/** A part given less room than this is left out instead, and named in the closing note. */
const MIN_PART = 400;

const NAMES: Record<ChallengePart, string> = {
  brief: "the problem",
  followUps: "the follow-up questions",
  interviewerNotes: "the interview talk-through",
  reference: "the reference solution",
  modelAnswers: "the answers to the follow-up questions",
};

/**
 * The parts in `order`, under their headings, at most `limit` characters, each clipped to its own budget too. The
 * parts that state the problem (the brief and the follow-ups) always fit together: the brief is clipped to leave the
 * follow-ups their room. The solution parts take what's left, in order, under one ## Solutions heading; one that doesn't
 * fit is clipped, and one with no room is left out and named at the end, so the model knows it exists.
 */
export function challengeText(parts: ChallengeParts, order: readonly ChallengePart[], limit: number): string {
  const present = order.filter((part) => parts[part]);
  const budgeted = new Map(present.map((part) => [part, clipPart(parts[part] as string, CHALLENGE_BUDGETS[part])]));
  const out: string[] = [];
  const left: ChallengePart[] = [];
  let used = 0;
  const add = (text: string) => {
    used += (out.length ? SEPARATOR.length : 0) + text.length;
    out.push(text);
  };
  present.forEach((part, index) => {
    const text = budgeted.get(part) as string;
    const solution = SOLUTION_PARTS.has(part);
    // The closing note always has room, and the problem's later parts keep theirs.
    const reserved =
      LEFT_NOTE +
      (solution
        ? 0
        : present
            .slice(index + 1)
            .filter((later) => !SOLUTION_PARTS.has(later))
            .reduce((sum, later) => sum + SEPARATOR.length + shown(later, budgeted.get(later) as string).length, 0));
    const opening = solution && !out.includes(SOLUTIONS_HEADING) ? SOLUTIONS_HEADING.length + SEPARATOR.length : 0;
    const heading = HEADINGS[part] ? (HEADINGS[part] as string).length + SEPARATOR.length : 0;
    const room = limit - used - (out.length ? SEPARATOR.length : 0) - reserved - opening - heading;
    const body = text.length <= room ? text : room >= MIN_PART ? clipPart(text, room - CLIP_NOTE) : null;
    if (body === null) return void left.push(part);
    if (opening) add(SOLUTIONS_HEADING);
    add(shown(part, body));
  });
  if (left.length) add(`… (left out for length: ${left.map((part) => NAMES[part]).join(", ")})`);
  return out.join(SEPARATOR);
}

/**
 * A lesson's text for one AI feature (the reading's body, or its notebook): a challenge lesson as the parts in `order`
 * within `challenge.limit`; any other lesson cut at `limit`, as lessonText always has.
 */
export async function lessonTextFor(
  course: { sourceRepoUrl: string | null; sourceRef: string | null },
  lesson: { body: string | null; sourcePath: string | null },
  limit: number,
  challenge: { order: readonly ChallengePart[]; limit: number },
): Promise<string | null> {
  const text = await lessonSource(course, lesson);
  if (text === null) return null;
  const parts = challengeParts(text);
  return parts ? challengeText(parts, challenge.order, challenge.limit) : clipText(text, limit);
}

/**
 * A lesson's Markdown split at its ## Solutions heading (outside code blocks), for the lesson page to fold what follows
 * (docs/lesson-solutions.md): the text before the heading, the heading's own text, and everything after it to the end.
 * Null when there's no such heading.
 */
export function splitAtSolutions(markdown: string): { before: string; heading: string; solutions: string } | null {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const heading = headingsOf(lines).find((entry) => entry.level === 2 && entry.title === "solutions");
  if (!heading) return null;
  return {
    before: lines.slice(0, heading.line).join("\n"),
    heading: lines[heading.line].replace(/^##\s+/, "").replace(/\s*#*\s*$/, ""),
    solutions: lines.slice(heading.line + 1).join("\n"),
  };
}
