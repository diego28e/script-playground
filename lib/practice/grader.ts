import { createHmac } from "node:crypto";
import type { Diagnostic, PracticeLanguage } from "@/lib/practice/language";

// The platform's side of the grader (infra/lab/grader, docs/practice.md): sends a practice answer and its tests to the
// grader on the lab server, signed with GRADER_SECRET, and returns what happened. Used to grade learners' code tasks
// and to prove AI-written tasks (the reference solution must pass, a wrong one must fail).

export type GradeTest = { name: string; passed: boolean; message: string | null };
export type GradeResult = {
  // passed: every test passed. failed: some test failed. error: the code (or the tests) raised.
  status: "passed" | "failed" | "error" | "timeout" | "oom" | "crashed";
  ok: boolean;
  tests: GradeTest[];
  error: { type: string; message: string; line?: number | null } | null;
  stdout: string;
  seconds?: number;
  wallMs: number;
  /** TypeScript runs: what `tsc` reported, in the answer or in the task's checks. None for Python. */
  diagnostics?: Diagnostic[];
  /** The language the grader ran it as; a grader from before TypeScript says nothing. */
  language?: string;
};
export type GradeOutcome = GradeResult | { status: "unavailable"; message: string };

/**
 * Runs `code`, then the tests against it, in a fresh sandbox. Python (the default): the test functions named test_*,
 * using plain assert. TypeScript: `tsc` checks the code and the tests together, Node runs them, and the tests are
 * `test("name", () => { assert… })` calls (infra/lab/grader/harness-ts.mjs).
 */
export async function gradeCode(
  input: { code: string; tests?: string; timeoutMs?: number; language?: PracticeLanguage },
  options: { signal?: AbortSignal } = {},
): Promise<GradeOutcome> {
  const url = process.env.GRADER_URL?.replace(/\/+$/, "");
  const secret = process.env.GRADER_SECRET;
  if (!url || !secret) return { status: "unavailable", message: "GRADER_URL and GRADER_SECRET are not set." };
  const { language = "python", ...rest } = input;
  // A Python request stays exactly as it always was; only another language is named.
  const body = JSON.stringify(language === "python" ? rest : { ...rest, language });
  // `options.signal` ends the wait early, when the request that asked has a deadline (lib/request-budget.ts).
  const signal = options.signal ? AbortSignal.any([AbortSignal.timeout(45_000), options.signal]) : AbortSignal.timeout(45_000);
  const time = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${time}.`).update(body).digest("hex");
  try {
    const response = await fetch(`${url}/v1/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-grader-time": time, "x-grader-signature": signature },
      body,
      // The grader's own limit is 30 s a run, plus its queue; a caller's deadline can end it sooner.
      signal,
    });
    const data = (await response.json().catch(() => null)) as (GradeResult & { message?: string }) | null;
    if (!response.ok || !data || !("status" in data)) return { status: "unavailable", message: data?.message ?? `The grader answered ${response.status}.` };
    // A grader from before TypeScript ignores `language` and would run the code as Python: its result means nothing.
    if (language !== "python" && data.language !== language) return { status: "unavailable", message: `This grader doesn't run ${language} yet: it needs the new grader and its sandbox image (infra/lab/README.md).` };
    return data;
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "The grader can't be reached." };
  }
}
