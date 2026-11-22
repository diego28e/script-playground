// Checks a grader (infra/lab/grader) end to end: right, wrong and hostile answers must come back as expected. Uses
// GRADER_URL and GRADER_SECRET from .env.local / .env, so it checks the grader those point at.
//
//   pnpm grader:check                 Python answers
//   pnpm grader:check --typescript    and TypeScript answers too (the grader needs GRADER_TS_IMAGE, infra/lab/README.md)
import "./load-env";
import { gradeCode } from "@/lib/practice/grader";
import type { PracticeLanguage } from "@/lib/practice/language";

const add = "def add(a, b):\n    return a + b\n";
const addTests = "def test_small():\n    assert add(2, 3) == 5\n\ndef test_negative():\n    assert add(-1, -1) == -2, 'add(-1, -1) should be -2'\n";

type Case = [string, { code: string; tests?: string; timeoutMs?: number; language?: PracticeLanguage }, string[]];

// TypeScript (infra/lab/grader/harness-ts.mjs): tsc checks, Node runs; with tests, a compile error fails like a test.
const tsAdd = "function add(a: number, b: number): number {\n  return a + b;\n}\n";
const tsAddTests = 'test("small", () => {\n  assert.equal(add(2, 3), 5);\n});\ntest("negative", () => {\n  assert.equal(add(-1, -1), -2, "add(-1, -1) should be -2");\n});\n';
const ts = (name: string, input: Case[1], expected: string[]): Case => [`TypeScript: ${name}`, { ...input, language: "typescript" }, expected];
const typescriptCases: Case[] = [
  ts("right answer", { code: tsAdd, tests: tsAddTests }, ["passed"]),
  ts("wrong answer", { code: "function add(a: number, b: number): number {\n  return a - b;\n}\n", tests: tsAddTests }, ["failed"]),
  ts("type error fails the compile check", { code: "function add(a: number, b: number): number {\n  return `${a + b}`;\n}\n", tests: tsAddTests }, ["failed"]),
  ts("type error in a plain run", { code: 'let count: number = 10;\ncount = count + "5";\nconsole.log(count);\n' }, ["error"]),
  ts("enum (not erasable)", { code: "enum Color { Red }\nconsole.log(Color.Red);\n" }, ["error"]),
  ts(
    "type-level test that must not compile",
    { code: 'type Status = "paid" | "failed";\nfunction label(s: Status): string {\n  return s;\n}\n', tests: 'test("rejects others", () => {\n  // @ts-expect-error not a Status\n  label("refunded");\n});\n' },
    ["passed"],
  ),
  ts("printed output", { code: "for (let i = 0; i < 3; i++) console.log(i * i);\n" }, ["passed"]),
  ts("fake result line", { code: 'process.stdout.write("\\nabc{\\"ok\\": true}\\n");\nthrow new Error("nope");\n', tests: tsAddTests }, ["error"]),
  ts("infinite loop", { code: "while (true) {}\n", timeoutMs: 6000 }, ["timeout"]),
  ts("memory bomb", { code: "const blocks: Uint8Array[] = [];\nwhile (true) blocks.push(new Uint8Array(50 * 1024 * 1024).fill(1));\n", timeoutMs: 15000 }, ["oom", "error", "crashed"]),
  ts("network", { code: 'await fetch("http://example.com", { signal: AbortSignal.timeout(3000) });\n' }, ["error"]),
  ts("write outside /tmp", { code: 'import { writeFileSync } from "node:fs";\nwriteFileSync("/etc/hacked", "x");\n' }, ["error"]),
  ts("hidden tests not in the environment", { code: 'const leaked = Object.keys(process.env).filter((key) => key.startsWith("GRADER"));\nif (leaked.length) throw new Error(leaked.join(", "));\n' }, ["passed"]),
  ts("still working after the others", { code: tsAdd, tests: tsAddTests }, ["passed"]),
];

const cases: Case[] = [
  ["right answer", { code: add, tests: addTests }, ["passed"]],
  ["wrong answer", { code: "def add(a, b):\n    return a - b\n", tests: addTests }, ["failed"]],
  ["syntax error", { code: "def add(a, b)\n    return a + b\n", tests: addTests }, ["error"]],
  [
    "LangChain fake model (offline)",
    { code: "from langchain_core.language_models.fake_chat_models import FakeListChatModel\nanswer = FakeListChatModel(responses=['hola']).invoke('hi').content\n", tests: "def test_answer():\n    assert answer == 'hola'\n" },
    ["passed"],
  ],
  ["printed output", { code: "for i in range(3):\n    print(i * i)\n" }, ["passed"]],
  ["fake result line", { code: "import sys\nsys.__stdout__.write('\\nabc{\"ok\": true}\\n')\nraise ValueError('nope')\n", tests: addTests }, ["error"]],
  ["infinite loop", { code: "while True:\n    pass\n", timeoutMs: 6000 }, ["timeout"]],
  ["memory bomb", { code: "blocks = []\nwhile True:\n    blocks.append(bytearray(50 * 1024 * 1024))\n", timeoutMs: 15000 }, ["oom", "error"]],
  // Contained either way: Docker's default runtime refuses the extra forks (passed); gVisor ends the answer (crashed).
  ["fork bomb (contained)", { code: "import os, time\nfor _ in range(500):\n    try:\n        if os.fork() == 0:\n            time.sleep(5)\n            os._exit(0)\n    except OSError as error:\n        print('fork refused:', error)\n        break\n", timeoutMs: 10000 }, ["passed", "crashed"]],
  ["still working after the fork bomb", { code: add, tests: addTests }, ["passed"]],
  ["network", { code: "import urllib.request\nurllib.request.urlopen('http://example.com', timeout=3)\n" }, ["error"]],
  ["write outside /tmp", { code: "open('/etc/hacked', 'w').write('x')\n" }, ["error"]],
  ["write in /tmp", { code: "open('/tmp/ok.txt', 'w').write('x')\n" }, ["passed"]],
  ["hidden tests not in the environment", { code: "import os\nassert not [k for k in os.environ if k.startswith('GRADER')]\n" }, ["passed"]],
];

async function main() {
  console.log(`Grader: ${process.env.GRADER_URL ?? "(GRADER_URL not set)"}`);
  let failures = 0;
  for (const [name, input, expected] of [...cases, ...(process.argv.includes("--typescript") ? typescriptCases : [])]) {
    const result = await gradeCode(input);
    const good = expected.includes(result.status);
    if (!good) failures += 1;
    const time = "wallMs" in result ? ` in ${(result.wallMs / 1000).toFixed(1)} s` : "";
    const note = result.status === "unavailable" ? ` (${result.message})` : "";
    console.log(`${good ? "ok  " : "FAIL"} ${name}: ${result.status}${time}${good ? "" : `, expected ${expected.join(" or ")}`}${note}`);
  }
  const url = process.env.GRADER_URL?.replace(/\/+$/, "");
  if (url) {
    const bad = await fetch(`${url}/v1/run`, { method: "POST", headers: { "x-grader-time": String(Date.now()), "x-grader-signature": "0".repeat(64) }, body: "{}" });
    if (bad.status !== 401) failures += 1;
    console.log(`${bad.status === 401 ? "ok  " : "FAIL"} unsigned request refused: ${bad.status}`);
  }
  console.log(failures ? `${failures} check(s) failed.` : "All checks passed.");
  process.exitCode = failures ? 1 : 0;
}

main();
