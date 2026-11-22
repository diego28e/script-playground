// The JavaScript Compass's course inventory (docs/compass.md, "JavaScript"): reads every lesson of the TypeScript
// course in course order, finds the JavaScript and TypeScript constructs in its code blocks with the detector
// (lib/compass/javascript/detector.ts), and writes, beside the Python one and in the same shape,
// lib/compass/javascript/course-inventory.json (what the platform loads) and course-inventory.md (to read).
//
//   pnpm exec tsx scripts/compass-js-inventory.ts <course repository checkout> [--slug typescript-nestjs-course]
//
// A lesson is a Markdown file modules/NN-slug/NN-MM-slug.md; its code is the ```ts, ```typescript, ```js (…) blocks.
// Blocks after the lesson's "## Solutions" heading are counted apart, as Python's solution notebooks are: a learner
// reads them after trying, so they don't rank the cards. Reads the repository; writes only the two files here.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SYNTAX, conceptOf, detect } from "@/lib/compass/javascript/detector";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { slug: { type: "string", default: "typescript-nestjs-course" } } });
const repo = positionals[0];
if (!repo) {
  console.error("Pass the course repository: pnpm exec tsx scripts/compass-js-inventory.ts <path>");
  process.exit(1);
}
const OUT = join(process.cwd(), "lib", "compass", "javascript");
const FENCE = /^```(ts|typescript|tsx|js|javascript|mjs|cjs|mts|cts)\s*$/;
const JAVASCRIPT = new Set(["js", "javascript", "mjs", "cjs"]);

type Use = { lesson: string; path: string; line: number; text: string; order: number };
type Entry = { lessons: Set<string>; solutions: Set<string>; occurrences: number; first: Use | null; example: Use | null };

const lessons: { path: string; code: string; kind: "lesson"; module: string; concepts: string[]; solutionConcepts: string[] }[] = [];
const concepts = new Map<string, Entry>();
let blocks = 0;
const unparsed: string[] = [];

const modules = readdirSync(join(repo, "modules"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
let order = 0;
for (const folder of modules) {
  const files = readdirSync(join(repo, "modules", folder))
    .filter((file) => /^\d{2}-\d{2}-.+\.md$/.test(file))
    .sort((a, b) => a.slice(0, 5).localeCompare(b.slice(0, 5)) || a.localeCompare(b));
  for (const file of files) {
    const path = `modules/${folder}/${file}`;
    const code = `${file.slice(0, 2)}.${file.slice(3, 5)}`;
    const lines = readFileSync(join(repo, path), "utf8").replace(/\r\n/g, "\n").split("\n");
    const used = new Set<string>();
    const usedInSolutions = new Set<string>();
    let solutions = false;
    for (let at = 0; at < lines.length; at++) {
      if (/^##\s+Solutions\b/.test(lines[at])) solutions = true;
      const fence = FENCE.exec(lines[at]);
      if (!fence) continue;
      const start = at + 1;
      let end = start;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
      const block = lines.slice(start, end);
      at = end;
      blocks++;
      let found: Record<string, number[]>;
      try {
        found = detect(block.join("\n"), { typescript: !JAVASCRIPT.has(fence[1]) });
      } catch {
        unparsed.push(`${path} line ${start}`);
        continue;
      }
      for (const [key, hits] of Object.entries(found)) {
        if (!conceptOf(key)) continue;
        const entry = concepts.get(key) ?? { lessons: new Set(), solutions: new Set(), occurrences: 0, first: null, example: null };
        concepts.set(key, entry);
        entry.occurrences += hits.length;
        const use: Use = { lesson: code, path, line: start + hits[0], text: block[hits[0] - 1]?.trim() ?? "", order: order + start };
        if (solutions) {
          entry.solutions.add(code);
          usedInSolutions.add(key);
          continue;
        }
        entry.lessons.add(code);
        used.add(key);
        entry.first ??= use;
        // The example: the first line that is more than the construct's own keyword.
        if (!entry.example || (entry.example.text.length < 12 && use.text.length >= 12)) entry.example = use;
      }
    }
    lessons.push({ path, code, kind: "lesson", module: folder, concepts: [...used].sort(), solutionConcepts: [...usedInSolutions].filter((key) => !used.has(key)).sort() });
    order += 100_000;
  }
}

const taught = lessons.length;
const rows = [...concepts]
  .map(([key, entry]) => {
    const concept = conceptOf(key)!;
    return {
      key,
      group: concept.group,
      label: concept.label,
      labelEs: concept.labelEs,
      lessonCount: entry.lessons.size,
      share: Math.round((entry.lessons.size / Math.max(1, taught)) * 1000) / 1000,
      solutions: entry.solutions.size,
      occurrences: entry.occurrences,
      firstLesson: entry.first?.lesson ?? null,
      firstOrder: entry.first?.order ?? null,
      lessons: [...entry.lessons],
      example: entry.example ? { lesson: entry.example.lesson, path: entry.example.path, where: `line ${entry.example.line}`, line: entry.example.text.slice(0, 200) } : null,
      rank: 0,
    };
  })
  .sort((a, b) => b.lessonCount - a.lessonCount || (a.firstOrder ?? 1e12) - (b.firstOrder ?? 1e12));
rows.forEach((row, index) => (row.rank = index + 1));
const unusedConcepts = Object.entries(SYNTAX)
  .filter(([key]) => !concepts.has(key))
  .map(([key, concept]) => ({ key, group: concept.group, label: concept.label, labelEs: concept.labelEs }));

let commit = "";
try {
  commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  commit = "unknown";
}
// `taughtNotebooks` keeps the Python inventory's name, which the platform reads: here it counts Markdown lessons.
const inventory = { course: values.slug, commit, language: "javascript", notebooks: taught, taughtNotebooks: taught, codeBlocks: blocks, unparsedBlocks: unparsed, concepts: rows, unusedConcepts, lessons };
writeFileSync(join(OUT, "course-inventory.json"), `${JSON.stringify(inventory, null, 1)}\n`);

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/`/g, "ˋ");
const report = [
  "# The course's JavaScript and TypeScript, by use",
  "",
  `Generated by \`scripts/compass-js-inventory.ts\` from the course repository at commit \`${commit.slice(0, 12)}\`: ${taught} lessons, ${blocks} code blocks (TypeScript and JavaScript), the blocks after a lesson's "## Solutions" counted apart. **Lessons** is how many lessons teach with it; the order is the cards' starting order (learners' signals re-rank it later). A concept only in solutions ranks last.`,
  "",
  "| # | Concept | Group | Lessons | First in | Lines | In solutions | Example |",
  "|---:|---|---|---:|---|---:|---:|---|",
  ...rows.map((row) => `| ${row.rank} | ${cell(row.label)} (\`${row.key}\`) | ${row.group} | ${row.lessonCount} | ${row.firstLesson ?? "-"} | ${row.occurrences} | ${row.solutions} | \`${cell(row.example?.line ?? "")}\` |`),
  "",
  `## Not in the course yet (${unusedConcepts.length})`,
  "",
  unusedConcepts.map((concept) => `${concept.label} (\`${concept.key}\`)`).join(" · "),
  "",
];
writeFileSync(join(OUT, "course-inventory.md"), report.join("\n"));
console.log(`${rows.length} concepts in ${taught} lessons (${blocks} code blocks${unparsed.length ? `, ${unparsed.length} unreadable` : ""}); ${unusedConcepts.length} known but unused. Commit ${commit.slice(0, 12)}.`);
