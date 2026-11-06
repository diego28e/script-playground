import { createHmac } from "node:crypto";

// The platform's side of the grader (infra/lab/grader, docs/practice.md): sends a practice answer and its tests to the
// grader on the lab server, signed with GRADER_SECRET, and returns what happened. Used to grade learners' code tasks
// and to prove AI-written tasks (the reference solution must pass, a wrong one must fail).

export type GradeTest = { name: string; passed: boolean; message: string | null };
export type GradeResult = {
  // passed: every test passed. failed: some test failed. error: the code (or the tests) raised.
  status: "passed" | "failed" | "error" | "timeout" | "oom" | "crashed";
  ok: boolean;
  tests: GradeTest[];
  error: { type: string; message: string } | null;
  stdout: string;
  seconds?: number;
  wallMs: number;
};
export type GradeOutcome = GradeResult | { status: "unavailable"; message: string };

/** Runs `code`, then the test functions in `tests` (named test_*, using plain assert), in a fresh sandbox. */
export async function gradeCode(input: { code: string; tests?: string; timeoutMs?: number }): Promise<GradeOutcome> {
  const url = process.env.GRADER_URL?.replace(/\/+$/, "");
  const secret = process.env.GRADER_SECRET;
  if (!url || !secret) return { status: "unavailable", message: "GRADER_URL and GRADER_SECRET are not set." };
  const body = JSON.stringify(input);
  const time = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${time}.`).update(body).digest("hex");
  try {
    const response = await fetch(`${url}/v1/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-grader-time": time, "x-grader-signature": signature },
      body,
      // The grader's own limit is 30 s a run, plus its queue.
      signal: AbortSignal.timeout(45_000),
    });
    const data = (await response.json().catch(() => null)) as (GradeResult & { message?: string }) | null;
    if (!response.ok || !data || !("status" in data)) return { status: "unavailable", message: data?.message ?? `The grader answered ${response.status}.` };
    return data;
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "The grader can't be reached." };
  }
}
