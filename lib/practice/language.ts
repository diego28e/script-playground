// The language a course's code practice is in (docs/practice.md, "Languages"): Python, as from the start, or
// TypeScript. It is chosen per course in Admin → Courses (`course.practiceLanguage`) and decides two things: which
// scratchbook sits beside the course's practice, and which language new code tasks are written in. A task keeps the
// language it was written in (`content.language`; none means Python), so answers are always graded as they were proved.
//
// This file is read by the browser too (the editors, the admin page): it holds names only. What a model is told about
// each language is in lib/practice/tasks.ts, and what runs the code is the grader (infra/lab/grader).

export const PRACTICE_LANGUAGES = ["python", "typescript"] as const;
export type PracticeLanguage = (typeof PRACTICE_LANGUAGES)[number];

/** A stored or received value as a practice language: anything that isn't one is Python, the language of older rows. */
export const practiceLanguage = (value: unknown): PracticeLanguage => (value === "typescript" ? "typescript" : "python");

export const LANGUAGE: Record<PracticeLanguage, { label: string; monaco: string; fence: string; extension: string }> = {
  python: { label: "Python", monaco: "python", fence: "python", extension: "py" },
  typescript: { label: "TypeScript", monaco: "typescript", fence: "ts", extension: "ts" },
};

/**
 * The name of the check a TypeScript run adds before a task's own tests: `tsc` found no error in the answer and the
 * tests together. The grader's harness writes the same words (infra/lab/grader/harness-ts.mjs).
 */
export const COMPILE_CHECK = "compiles with no errors (tsc)";

/** What the compiler said about one place in the code (TypeScript only): `tsc`'s own code and message. */
export type Diagnostic = {
  /** The line in the learner's own code; null when it is in the task's hidden checks. */
  line: number | null;
  column: number | null;
  /** The compiler's code, as the lessons name it: "TS2322". */
  code: string;
  message: string;
};
