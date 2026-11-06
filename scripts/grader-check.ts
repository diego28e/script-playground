// Checks a grader (infra/lab/grader) end to end: right, wrong and hostile answers must come back as expected. Uses
// GRADER_URL and GRADER_SECRET from .env.local / .env, so it checks the grader those point at.
//
//   pnpm grader:check
import "./load-env";
import { gradeCode } from "@/lib/practice/grader";

const add = "def add(a, b):\n    return a + b\n";
const addTests = "def test_small():\n    assert add(2, 3) == 5\n\ndef test_negative():\n    assert add(-1, -1) == -2, 'add(-1, -1) should be -2'\n";

const cases: [string, { code: string; tests?: string; timeoutMs?: number }, string[]][] = [
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
  for (const [name, input, expected] of cases) {
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
