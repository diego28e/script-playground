"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TUTOR_CHAIN, chainStartingAt, generateWithFallback } from "@/lib/ai/gemini";
import { gradeCode } from "@/lib/practice/grader";
import type { TaskContent } from "@/lib/practice/tasks";
import { DETECTOR_SOURCE } from "@/lib/compass/detector-source";
import { conceptOfError, recordSignal } from "@/lib/compass/signals";

// The practice scratchbook (docs/practice.md, "Scratchbook"): Python a learner writes beside any task, to calculate,
// try a line or prove an idea, run on the grader's sandbox (the same Python as code tasks), and an AI that explains
// their code and its errors. Free to use on every task, "what does it print?" ones included: honesty is the
// learner's. The AI never gets a task's key and is told never to answer the task.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

const MAX_CODE = 20_000;
// Explaining a few lines of code is a small job: the fast Flash-Lite models first (about 2 s), then DeepSeek, then the
// bigger free models, which were often busy or slow (2026-11-10: 3.8 Flash refused, 3.6 Flash took 13 s or timed out).
const SCRATCH_CHAIN = chainStartingAt(TUTOR_CHAIN, "gemini-3.1-flash-lite");
const RUN_TIMEOUT_MS = 10_000;
// A soft guard for the grader, per server process: a person running by hand never gets near it.
const RUNS_PER_MINUTE = 30;
const recentRuns = new Map<string, number[]>();

async function signedIn() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user ?? null;
}

function overLimit(userId: string): boolean {
  const now = Date.now();
  const runs = (recentRuns.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (runs.length >= RUNS_PER_MINUTE) return true;
  runs.push(now);
  recentRuns.set(userId, runs);
  return false;
}

// Markers the wrapper prints on lines of their own, so the value and the error come back apart from what the code
// printed: U+241E (the last expression's value, like a Python prompt shows it) and U+241F (an error, as JSON).
const VALUE = "␞";
const ERROR = "␟";
// U+241D: the Python constructs in the code, by line (lib/compass/detector.py, run with it: docs/compass.md).
const CONCEPTS = "␝";

/**
 * The learner's code inside a small runner: it runs like a script, then shows the value of a last line that is an
 * expression (so `6000 // 400` answers 15, as in a Python prompt), and reports an error with the line it happened on
 * in the learner's own numbering. The Python Compass's detector runs with it, so the run also says which constructs the
 * code uses and where (the console links them to their cards; an error is put down to the construct on its line).
 */
function wrap(code: string): string {
  return `${DETECTOR_SOURCE}
import ast as __ast, json as __json, traceback as __tb
__source = ${JSON.stringify(code)}
try:
    __tree = __ast.parse(__source, "<scratch>")
    __last = __tree.body.pop() if __tree.body and isinstance(__tree.body[-1], __ast.Expr) else None
    __scope = {"__name__": "__main__"}
    exec(compile(__tree, "<scratch>", "exec"), __scope)
    if __last is not None:
        __value = eval(compile(__ast.Expression(__last.value), "<scratch>", "eval"), __scope)
        if __value is not None:
            print(${JSON.stringify(VALUE)} + repr(__value))
except BaseException as __error:
    if isinstance(__error, (KeyboardInterrupt,)):
        raise
    __frames = [frame for frame in __tb.extract_tb(__error.__traceback__) if frame.filename == "<scratch>"]
    __line = __frames[-1].lineno if __frames else getattr(__error, "lineno", None)
    print(${JSON.stringify(ERROR)} + __json.dumps({"type": type(__error).__name__, "message": str(__error), "line": __line}))
try:
    print(${JSON.stringify(CONCEPTS)} + __json.dumps(detect(__source)))
except BaseException:
    pass
`;
}

export type ScratchRun = {
  /** What the code printed. */
  stdout: string;
  /** The last line's value, as Python shows it; null when the last line isn't an expression or is None. */
  value: string | null;
  error: { type: string; message: string; line: number | null } | null;
  ms: number;
  /** The Python constructs the code uses, by the detector's key, with their lines. */
  concepts: Record<string, number[]>;
};

/**
 * Runs the learner's scratch code in the grader's sandbox (10 s at most). `surface` says where it was run from, for the
 * Compass's signals: the scratchbook, or a card's example in the Python guide.
 */
export async function runScratch(code: string, surface: "scratchbook" | "guide" = "scratchbook"): Promise<Result<{ run: ScratchRun }>> {
  const user = await signedIn();
  if (!user) return { success: false, error: "Sign in to run code." };
  if (!code.trim()) return { success: false, error: "Write some Python first." };
  if (code.length > MAX_CODE) return { success: false, error: "That's more code than the scratchbook runs at once." };
  if (overLimit(user.id)) return { success: false, error: "That's a lot of runs in a minute. Wait a moment and run again." };

  const started = Date.now();
  const outcome = await gradeCode({ code: wrap(code), timeoutMs: RUN_TIMEOUT_MS });
  const ms = Date.now() - started;
  if (outcome.status === "unavailable") return { success: false, error: "The Python sandbox can't be reached right now. Try again in a moment." };
  if (outcome.status === "timeout") return { success: true, run: { stdout: outcome.stdout ?? "", value: null, error: { type: "Timeout", message: `It ran longer than ${RUN_TIMEOUT_MS / 1000} seconds (an endless loop?).`, line: null }, ms, concepts: {} } };
  if (outcome.status === "oom") return { success: true, run: { stdout: outcome.stdout ?? "", value: null, error: { type: "MemoryError", message: "It used more memory than the sandbox allows.", line: null }, ms, concepts: {} } };

  const lines: string[] = [];
  let value: string | null = null;
  let error: ScratchRun["error"] = outcome.error ? { type: outcome.error.type, message: outcome.error.message, line: null } : null;
  let concepts: Record<string, number[]> = {};
  for (const line of (outcome.stdout ?? "").split("\n")) {
    if (line.startsWith(CONCEPTS)) {
      try {
        concepts = JSON.parse(line.slice(CONCEPTS.length));
      } catch {
        concepts = {};
      }
    } else if (line.startsWith(VALUE)) value = line.slice(VALUE.length);
    else if (line.startsWith(ERROR)) {
      try {
        error = JSON.parse(line.slice(ERROR.length));
      } catch {
        error = { type: "Error", message: line.slice(ERROR.length), line: null };
      }
    } else lines.push(line);
  }
  // Learners' struggles, for the Compass (docs/compass.md, "Ranking"): the error, and the construct it's most likely about.
  if (error) void recordSignal({ kind: "RUN_ERROR", userId: user.id, text: error.type, conceptKey: await conceptOfError(concepts, error.line), surface: surface === "guide" ? "guide" : "scratchbook" });
  return { success: true, run: { stdout: lines.join("\n").replace(/\n+$/, ""), value, error, ms, concepts } };
}

const AskSchema = z.object({
  taskId: z.string().max(100).nullable(),
  code: z.string().max(MAX_CODE),
  output: z.string().max(8000),
  question: z.string().trim().max(2000),
  language: z.enum(["es", "en"]),
});

const SYSTEM = (language: "es" | "en") => `You help a learner with the Python in their scratchbook: a place beside a practice task where they calculate, try lines and test ideas. They are learning LangChain and may be shaky on Python.

- Explain their code, its output and its errors plainly: what each part does, why an error happened, and how to fix the code they wrote. Short paragraphs or a few bullets; code in Markdown code blocks.
- You may see the practice task they are on. NEVER solve it, never state its answer or which option is right, never write the code that answers it, and never confirm or deny a guess about it. If they ask for the answer, say kindly that the scratchbook helps with their own code, and that the task's Hint button is there for a nudge.
- Explaining what their own code prints, or why it fails, is fine even when it is close to the task: explain the Python, don't conclude the task.
- Never say "simply", "just" or "obviously": what is easy for you may not be for them.
- Answer in ${language === "es" ? "Spanish (Latin American, keep technical terms in English)" : "English"}. Be warm and brief: at most about 150 words unless they ask for more.`;

/** The scratchbook's AI: explains the learner's code, output and errors, without ever answering the task. */
export async function askScratch(input: z.input<typeof AskSchema>): Promise<Result<{ text: string }>> {
  const user = await signedIn();
  if (!user) return { success: false, error: "Sign in to ask the AI." };
  const parsed = AskSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "That question can't be sent." };
  const { taskId, code, output, question, language } = parsed.data;
  if (!code.trim() && !question) return { success: false, error: "Write some code or a question first." };

  // What the learner sees of the task, never its key: the prompt, the options, a code task's starter.
  let task = "";
  if (taskId) {
    const row = await prisma.practiceTask.findUnique({ where: { id: taskId }, select: { form: true, content: true } });
    if (row) {
      const content = row.content as unknown as TaskContent;
      const es = language === "es";
      const options = (es ? content.optionsEs : content.optionsEn) ?? [];
      task = [
        `Form: ${row.form}`,
        es ? content.promptEs : content.promptEn,
        options.length ? `Options:\n${options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join("\n")}` : "",
        row.form === "code" && content.code ? `Starter code:\n${content.code}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  }

  const message = [
    task ? `# The practice task they are on (do not answer it)\n${task}` : "",
    `# Their scratchbook code\n\`\`\`python\n${code || "(empty)"}\n\`\`\``,
    output ? `# What the last run showed\n\`\`\`\n${output}\n\`\`\`` : "",
    `# Their question\n${question || (language === "es" ? "Explícame mi código y lo que mostró." : "Explain my code and what it showed.")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateWithFallback({
    feature: "ask",
    userId: user.id,
    models: SCRATCH_CHAIN,
    deadline: Date.now() + 25_000,
    contents: [{ role: "user", parts: [{ text: message }] }],
    config: { systemInstruction: SYSTEM(language), temperature: 0.3, maxOutputTokens: 1200 },
  });
  if (!result.ok) {
    return { success: false, error: result.reason === "quota" ? "The AI has reached its limit for now. Try again later." : "The AI isn't answering right now. Try again in a moment." };
  }
  return { success: true, text: result.text };
}
