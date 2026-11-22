// Runs one TypeScript practice answer inside a throwaway grading container (see server.mjs), the way harness.py runs a
// Python one: the two jobs of the TypeScript course, in its order. `tsc` checks the answer and the task's tests
// together with the course's strict settings; then Node runs them (it strips the types itself). It prints one JSON
// result line behind a per-run nonce, so whatever the code prints can't pass for the result.
//
// The answer and the tests are one module (answer.ts): the tests come after the code and use its names directly, as in
// Python. `test(name, fn)` and `assert` (node:assert/strict) are globals, declared for tsc in globals.d.ts, so the
// learner's line numbers stay their own. With tests, a compile error is a failed check of its own, listed first.
//
// This grades practice, where cheating only cheats yourself: the code runs in the same process as the tests. Isolation
// from the server is the container's job (no network, read-only but /tmp, gVisor).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { Console } from "node:console";
import { mkdirSync, writeFileSync } from "node:fs";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";

const MAX_OUTPUT = 20_000;
const MAX_MESSAGE = 2_000;
// The name harness and platform give the compile check (lib/practice/language.ts, COMPILE_CHECK).
const COMPILE_CHECK = "compiles with no errors (tsc)";
const ROOT = process.env.TS_SANDBOX_ROOT ?? "/opt/ts-sandbox";
const DIR = "/tmp/run";

const take = (name) => {
  const value = process.env[name] ?? "";
  delete process.env[name];
  return value ? Buffer.from(value, "base64").toString("utf8") : "";
};
const nonce = process.env.GRADER_NONCE ?? "";
delete process.env.GRADER_NONCE;
const code = take("GRADER_CODE");
const tests = take("GRADER_TESTS");
const short = (text, limit = MAX_MESSAGE) => (text.length <= limit ? text : `${text.slice(0, limit)}\n… (${text.length - limit} more characters)`);

// --- The files: the answer (code, then the tests), the globals, and the course's compiler settings ------------------

// Learner lines are 1..codeLines; anything after is the task's tests, which the learner doesn't see.
const codeLines = code.split("\n").length;
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/answer.ts`, tests ? `${code}\n\n${tests}\n` : code);
writeFileSync(`${DIR}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(
  `${DIR}/globals.d.ts`,
  `// The checks a task's tests use, there without an import (infra/lab/grader/harness-ts.mjs).
declare global {
  function test(name: string, fn: () => void | Promise<void>): void;
  const assert: typeof import("node:assert/strict");
}
export {};
`,
);
// The course's tsconfig (lessons 00.04 and 00.05): strict, Node's types, modern JavaScript without the browser's, Node's
// module rules, and only syntax Node can strip. Every file is a module, so an answer's names never clash with the globals.
writeFileSync(
  `${DIR}/tsconfig.json`,
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      types: ["node"],
      typeRoots: [`${ROOT}/node_modules/@types`],
      lib: ["esnext"],
      module: "nodenext",
      rewriteRelativeImportExtensions: true,
      erasableSyntaxOnly: true,
      moduleDetection: "force",
      skipLibCheck: true,
    },
    files: ["answer.ts", "globals.d.ts"],
  }),
);

const started = performance.now();

// --- Job 1: tsc checks ---------------------------------------------------------------------------------------------

/** tsc's report, one entry per error: `answer.ts(3,7): error TS2322: Type 'string' is not …`, with its indented lines. */
function readDiagnostics(text) {
  const found = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const match = line.match(/^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/);
    if (match) {
      const inAnswer = match[1].endsWith("answer.ts");
      const at = Number(match[2]);
      found.push({ line: inAnswer && at <= codeLines ? at : null, column: inAnswer && at <= codeLines ? Number(match[3]) : null, code: match[4], message: match[5] });
    } else if (/^\s+\S/.test(line) && found.length) {
      found.at(-1).message += `\n${line.trim()}`;
    } else if (/error TS\d+:/.test(line)) {
      found.push({ line: null, column: null, code: line.match(/(TS\d+)/)[1], message: line.replace(/^.*error TS\d+:\s*/, "") });
    }
  }
  return found.slice(0, 50);
}

const compiled = await new Promise((resolve) => {
  execFile(process.execPath, [`${ROOT}/node_modules/typescript/bin/tsc`, "-p", `${DIR}/tsconfig.json`, "--pretty", "false"], { cwd: DIR, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ failed: Boolean(error), text: `${stdout}${stderr}` });
  });
});
const diagnostics = readDiagnostics(compiled.text);
// tsc failed without saying where (it couldn't start, or ran out of memory): report it as it is.
if (compiled.failed && !diagnostics.length) diagnostics.push({ line: null, column: null, code: "TSC", message: short(compiled.text.trim() || "tsc stopped without a report.") });
const checkSeconds = (performance.now() - started) / 1000;

/** A diagnostic as a learner reads it, with the line in their own numbering ("in the task's checks" otherwise). */
const describe = (entry) => `${entry.line ? `line ${entry.line}` : "in the task's checks"}: ${entry.code}: ${entry.message}`;

// --- Job 2: Node runs ----------------------------------------------------------------------------------------------

let output = "";
const sink = new Writable({
  write(chunk, _encoding, done) {
    if (output.length < MAX_OUTPUT * 2) output += chunk.toString();
    done();
  },
});
const realWrite = process.stdout.write.bind(process.stdout);
globalThis.console = new Console({ stdout: sink, stderr: sink, colorMode: false });
process.stdout.write = (chunk, ...rest) => sink.write(chunk, ...rest.filter((entry) => typeof entry !== "function"));
process.stderr.write = (chunk, ...rest) => sink.write(chunk, ...rest.filter((entry) => typeof entry !== "function"));

const registered = [];
globalThis.test = (name, fn) => registered.push({ name: String(name), fn });
globalThis.assert = assert;

/** Where an error happened in the learner's own code: the first frame in answer.ts within their lines. */
function lineOf(error) {
  for (const match of String(error?.stack ?? "").matchAll(/answer\.ts:(\d+):\d+/g)) {
    const at = Number(match[1]);
    if (at <= codeLines) return at;
  }
  return null;
}
const errorOf = (error) => ({
  type: error?.name ?? "Error",
  message: short(error instanceof Error ? error.message : String(error)),
  line: lineOf(error),
});

let runError = null;
process.on("unhandledRejection", (reason) => (runError ??= errorOf(reason)));
try {
  await import(pathToFileURL(`${DIR}/answer.ts`).href);
} catch (error) {
  runError = errorOf(error);
}

const results = [];
if (tests && !runError) {
  for (const { name, fn } of registered) {
    const entry = { name, passed: false, message: null };
    try {
      await fn();
      entry.passed = true;
    } catch (error) {
      entry.message =
        error instanceof assert.AssertionError
          ? short(error.generatedMessage ? error.message : String(error.message)) || "The check failed."
          : `${error?.name ?? "Error"}: ${short(error instanceof Error ? error.message : String(error))}${lineOf(error) ? ` (line ${lineOf(error)})` : ""}`;
    }
    results.push(entry);
  }
}

// --- The result ----------------------------------------------------------------------------------------------------

const result = { ok: true, error: null, tests: [], stdout: short(output, MAX_OUTPUT), diagnostics, language: "typescript", checkSeconds: Math.round(checkSeconds * 1000) / 1000 };
if (runError) {
  result.ok = false;
  result.error = runError;
} else if (tests) {
  // With tests, the compile check comes first: an answer that doesn't compile fails, whatever it does when run.
  result.tests = [{ name: COMPILE_CHECK, passed: diagnostics.length === 0, message: diagnostics.length ? short(diagnostics.map(describe).join("\n")) : null }, ...results];
  if (!results.length) result.error = { type: "TestSetupError", message: "The task's tests registered no test(…).", line: null };
  result.ok = result.error === null && result.tests.every((entry) => entry.passed);
} else if (diagnostics.length) {
  // A run without tests (a snippet, the scratchbook) that doesn't compile: it ran, but it isn't right.
  result.ok = false;
  result.error = { type: "CompileError", message: short(diagnostics.map(describe).join("\n")), line: diagnostics[0].line };
}
result.seconds = Math.round((performance.now() - started) / 10) / 100;
realWrite(`\n${nonce}${JSON.stringify(result)}\n`, () => process.exit(0));
