// Checks the whiteboard's contract on the platform's side (docs/whiteboard-contract.md): the signed launch and service
// tokens, the events Didactra may send, and how a learner's practice state and a session's summary are told to the
// teacher, and how an interview-challenge lesson is split for the AI features that read it (lib/lesson-sections.ts).
// No database and no model: these are pure functions.
//
//   pnpm board:check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PracticeState } from "@intellectif/lk-practice";
import { issueLaunch, issueService, LAUNCH_MS, readLaunch, serviceSession } from "@/lib/board/token";
import { BoardEvent } from "@/lib/board/events";
import { stateName, summaryText } from "@/lib/board/context";
import { fileScope } from "@/lib/preferences";
import { assemble } from "@/lib/voice/context";
import { requestConversation, requestOrigin, resolvePrompt } from "@/lib/practice/tutor-requests";
import { clipText } from "@/lib/lesson-text";
import { CHALLENGE_BUDGETS, challengeParts, challengeText, clipPart, isChallengeLesson, lessonTextFor, splitAtSolutions, type ChallengePart } from "@/lib/lesson-sections";

let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  if (!pass) failures += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};

const secret = "s".repeat(40);
const now = 1_795_650_000_000;
const launch = { sid: "sess1", userId: "user1", name: "Diego", language: "es" as const, role: "ADMIN" as const, view: "board" as const };

// The launch.
const token = issueLaunch(secret, launch, now);
const read = readLaunch(secret, token, now + 1000);
check("a launch reads back whole", read?.sid === "sess1" && read.userId === "user1" && read.name === "Diego" && read.language === "es" && read.role === "ADMIN" && read.view === "board");
check("a launch lasts a minute", readLaunch(secret, token, now + LAUNCH_MS) !== null && readLaunch(secret, token, now + LAUNCH_MS + 1) === null);
check("another secret doesn't read it", readLaunch("t".repeat(40), token, now) === null);
const [payload, signature] = token.split(".");
const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), u: "someone-else" })).toString("base64url")}.${signature}`;
check("a changed payload is refused", readLaunch(secret, forged, now) === null);
check("a token with extra parts is refused", readLaunch(secret, `${token}.x`, now) === null);
check("the board view isn't written, others are", !JSON.parse(Buffer.from(payload, "base64url").toString()).view && readLaunch(secret, issueLaunch(secret, { ...launch, view: "replay" }, now), now)?.view === "replay");
check("a service token isn't a launch", readLaunch(secret, issueService(secret, "sess1", now), now) === null);

// Service calls.
const service = issueService(secret, "sess1", now);
check("a service token opens its own session", serviceSession(secret, `Bearer ${service}`, "sess1", now + 1000));
check("not another session", !serviceSession(secret, `Bearer ${service}`, "sess2", now));
check("not after a minute", !serviceSession(secret, `Bearer ${service}`, "sess1", now + 60_001));
check("not a launch token", !serviceSession(secret, `Bearer ${token}`, "sess1", now));
check("not without Bearer", !serviceSession(secret, service, "sess1", now) && !serviceSession(secret, null, "sess1", now));

// Events.
const ended = {
  id: "e3",
  type: "ended",
  at: now,
  minutes: 31.5,
  costUsd: 1.27,
  summary: { taught: ["what packageManager pins"], learnerDid: ["explained corepack"], struggles: [], readyToPractise: true, profileNotes: ["likes drawing it first"] },
};
check("the contract's events parse", BoardEvent.safeParse({ id: "e1", type: "started", at: now, didactraSession: "d3c0d46e5976" }).success && BoardEvent.safeParse({ id: "e2", type: "usage", at: now, minutes: 10.2, costUsd: 0.41, model: "claude-sonnet-5-5", voice: "pocket-es" }).success && BoardEvent.safeParse(ended).success);
const minimal = BoardEvent.safeParse({ ...ended, summary: {} });
check("a summary's missing lists default to empty", minimal.success && minimal.data.type === "ended" && minimal.data.summary.taught.length === 0 && minimal.data.summary.readyToPractise === false);
check("an unknown type is refused", !BoardEvent.safeParse({ id: "e4", type: "paused", at: now }).success);
check("negative minutes are refused", !BoardEvent.safeParse({ id: "e5", type: "usage", at: now, minutes: -1, costUsd: 0 }).success);
check("an event without an id is refused", !BoardEvent.safeParse({ type: "usage", at: now, minutes: 1, costUsd: 0 }).success);

// The learner's state in a skill, from lk-practice's state.
const skill = (over: Record<string, unknown>) => ({ skills: { a: { evidenceCount: 3, mastered: false, top: { successes: 0 }, ...over } } }) as unknown as PracticeState;
check("no state is new", stateName(null, "a") === "new" && stateName(skill({}), "b") === "new" && stateName(skill({ evidenceCount: 0 }), "a") === "new");
check("evidence without top successes is learning", stateName(skill({}), "a") === "learning");
check("top successes not yet mastered is reviewing", stateName(skill({ top: { successes: 1 } }), "a") === "reviewing");
check("mastered is secure", stateName(skill({ mastered: true, top: { successes: 3 } }), "a") === "secure");

// Earlier sessions, as the teacher reads them.
const earlier = summaryText(ended.summary, "en");
check("a summary reads as one line", earlier === "Taught: what packageManager pins. Showed: explained corepack. Ready to practise.", earlier ?? "null");
check("a summary in Spanish", summaryText(ended.summary, "es")?.startsWith("Se enseñó: what packageManager pins") === true);
check("an empty summary is nothing", summaryText({ taught: [], learnerDid: [], struggles: [], readyToPractise: false }, "en") === null && summaryText(null, "en") === null);

// Preferences (docs/whiteboard-teaching.md §2): a line about the board is the board's, whatever scope it came with.
const boardLines = [
  "Draw a diagram before you explain",
  "Let me type the code in the trace myself",
  "Keep one space per idea on the board",
  "Usa la pizarra solo para el código",
  "Dibuja primero, luego explica",
  "Use arrows to show the flow",
];
const teacherLines = ["Go in small steps and wait for me", "Use examples from AWS", "Explícame la teoría primero", "Short answers, please", "Answer in English"];
check("board lines are filed as board", boardLines.every((line) => fileScope(line, "all") === "board"), boardLines.filter((line) => fileScope(line, "all") !== "board").join(" | "));
check("teaching lines keep their scope", teacherLines.every((line) => fileScope(line, "all") === "all") && fileScope("Go slowly", "board") === "board", teacherLines.filter((line) => fileScope(line, "all") !== "all").join(" | "));
check("a remember parses", BoardEvent.safeParse({ id: "p1", type: "preference", at: now, action: "remember", scope: "board", text: "Draw first" }).success);
check("a forget by id parses, scope defaults to all", (() => {
  const parsed = BoardEvent.safeParse({ id: "p2", type: "preference", at: now, action: "forget", preferenceId: "pref_2" });
  return parsed.success && parsed.data.type === "preference" && parsed.data.scope === "all";
})());
check("an unknown action is refused", !BoardEvent.safeParse({ id: "p3", type: "preference", at: now, action: "replace", text: "x" }).success);
const withObjectives = BoardEvent.safeParse({ ...ended, id: "e7", summary: { ...ended.summary, objectives: [{ text: "Run a .ts file", met: true }, { text: "Explain why Node runs it", met: false, untickedByLearner: true }] } });
check("objectives parse, untickedByLearner defaults to false", withObjectives.success && withObjectives.data.type === "ended" && withObjectives.data.summary.objectives[0].untickedByLearner === false && withObjectives.data.summary.objectives[1].untickedByLearner === true);
check("more than 6 objectives are refused", !BoardEvent.safeParse({ ...ended, id: "e8", summary: { ...ended.summary, objectives: Array.from({ length: 7 }, (_, index) => ({ text: `o${index}`, met: false })) } }).success);

// Practice from the board: picks in the summary, and the learner asking during the lesson.
const picks = BoardEvent.safeParse({
  ...ended,
  id: "e9",
  summary: { ...ended.summary, practice: [{ skill: "narrow a union with typeof before using it", why: "struggled", happened: "Called .toUpperCase() on string | number.", challenge: "Format an id that is a string or a number." }, { skill: "read a tsc error's first line" }] },
});
check("practice picks parse, why defaults to new", picks.success && picks.data.type === "ended" && picks.data.summary.practice.length === 2 && picks.data.summary.practice[1].why === "new");
check("a summary without picks has none", minimal.success && minimal.data.type === "ended" && minimal.data.summary.practice.length === 0);
check("more than 5 picks are refused", !BoardEvent.safeParse({ ...ended, id: "e10", summary: { ...ended.summary, practice: Array.from({ length: 6 }, (_, index) => ({ skill: `skill ${index}` })) } }).success);
const asked = BoardEvent.safeParse({ id: "q1", type: "practice", at: now, skill: "use Array.prototype.reduce to sum", challenge: "Sum the cart's prices." });
check("a practice event parses, why defaults to asked", asked.success && asked.data.type === "practice" && asked.data.why === "asked");
check("a practice event needs its skill", !BoardEvent.safeParse({ id: "q2", type: "practice", at: now }).success && !BoardEvent.safeParse({ id: "q3", type: "practice", at: now, skill: "x" }).success);
const boardDetail = { source: "whiteboard" as const, why: "struggled" as const, happened: "Called .toUpperCase() on string | number.", challenge: "Format an id.", boardSkill: "narrowing" };
check("the resolver reads the board's challenge", requestConversation(boardDetail).includes("# The board's challenge\nFormat an id.") && !requestConversation(boardDetail).includes("conversation (oldest first)"));
check("the resolver says it came from the board", requestOrigin("REQUESTED", boardDetail).startsWith("on the whiteboard: something the learner found hard") && requestOrigin("REQUESTED", {}) === "the learner asked for more practice on it");
check("the resolver keeps the lab's conversation", requestConversation({ messages: [{ role: "user", content: "hi" }] }) === "# The conversation (oldest first)\n## user\nhi");
check("the resolver speaks the course's language", resolvePrompt("typescript").includes("(TypeScript and Node.js for the backend)") && resolvePrompt("typescript").includes("one TypeScript file") && !resolvePrompt("typescript").includes("Python") && resolvePrompt("python").includes("plain offline Python"));

// The voice teachers: the learner's own instructions come before the observed notes, under their own heading.
const system = assemble({ role: "ROLE", grounding: "GROUNDING", preferences: ["Go in small steps"], profile: "PROFILE", summary: null, digest: [] }, "en").system;
check("preferences sit before the profile, after the grounding", system.indexOf("GROUNDING") < system.indexOf("- Go in small steps") && system.indexOf("- Go in small steps") < system.indexOf("PROFILE") && system.includes("HOW THIS LEARNER ASKED TO BE TAUGHT"));
check("no preferences, no heading", !assemble({ role: "R", grounding: "G", preferences: [], profile: null, summary: null, digest: [] }, "en").system.includes("ASKED TO BE TAUGHT"));

// Interview-challenge lessons, split into parts (docs/whiteboard-interview-mode.md §4). The fixture is lesson 01.01 of
// the "Live-Coding Interview Challenges in TypeScript" course, copied as it was imported.
const lesson = readFileSync(join(__dirname, "fixtures", "challenge-01-01-bounded-promise-pool.md"), "utf8");
const parts = challengeParts(lesson);
check("a challenge lesson is recognized by its headings", isChallengeLesson(lesson) && parts !== null);
check(
  "the brief runs from the title to the follow-up questions, without the setup",
  Boolean(parts?.brief?.startsWith("# 01.01 · Bounded Promise Pool")) &&
    Boolean(parts?.brief?.includes("## Learning objectives")) &&
    Boolean(parts?.brief?.includes("### Testing expectations")) &&
    !parts?.brief?.includes("## Your setup") &&
    !parts?.brief?.includes("## Interview follow-up questions") &&
    !parts?.brief?.includes("## Solutions"),
);
check("the brief keeps one divider where the setup was", !/---\s*\n\s*---/.test(parts?.brief ?? ""));
check("the follow-ups are the numbered list", Boolean(parts?.followUps?.startsWith("1. ")) && (parts?.followUps?.match(/^\d+\. /gm)?.length ?? 0) === 7 && !parts?.followUps?.includes("---"));
check("the interviewer's notes are the talk-through, without its heading", Boolean(parts?.interviewerNotes) && !parts?.interviewerNotes?.includes("###") && !parts?.interviewerNotes?.includes("```ts"));
check(
  "the reference is the solution and how the tests check it, with both headings",
  Boolean(parts?.reference?.startsWith("### The reference solution")) && Boolean(parts?.reference?.includes("### How the tests check it")) && !parts?.reference?.includes("### Answers"),
);
check("the model answers are every numbered answer", Boolean(parts?.modelAnswers?.startsWith("**1. ")) && Boolean(parts?.modelAnswers?.includes("**7. ")) && !parts?.modelAnswers?.includes("###"));
const teaching: ChallengePart[] = ["brief", "followUps", "reference", "modelAnswers"];
const board = parts ? challengeText(parts, teaching, 37_000) : "";
check(
  "the board's text keeps the parts in order, under their headings, whole",
  board.indexOf("## The challenge") < board.indexOf("## Interview follow-up questions") &&
    board.indexOf("## Interview follow-up questions") < board.indexOf("## Solutions") &&
    board.indexOf("## Solutions") < board.indexOf("### The reference solution") &&
    board.indexOf("### How the tests check it") < board.indexOf("### Answers to the follow-up questions") &&
    !board.includes("### Talking it through") &&
    !board.includes("more characters)") &&
    !board.includes("left out for length"),
);
const small = parts ? challengeText(parts, teaching, 12_000) : "";
check(
  "within a small limit, the problem and the follow-ups come whole and the solution is cut, saying so",
  small.length <= 12_000 && small.includes(parts?.brief ?? "?") && small.includes(parts?.followUps ?? "?") && small.includes("more characters)"),
  String(small.length),
);
const tiny = parts ? challengeText(parts, teaching, 7_000) : "";
check("a part with no room is left out and named", tiny.length <= 7_000 && tiny.includes("left out for length: the reference solution, the answers to the follow-up questions") && tiny.includes("## Interview follow-up questions"), String(tiny.length));
const drafter = parts ? challengeText(parts, ["brief", "reference", "modelAnswers"], 35_000) : "";
check("the drafter's text has no follow-up list", !drafter.includes("## Interview follow-up questions") && drafter.includes("### Answers to the follow-up questions"));

// Each part's budget.
const long = (heading: string, size: number) => `${heading}\n\n${"word ".repeat(size / 5)}`;
const big = [
  "# 99.01 · Big",
  long("## The challenge", 20_000),
  long("## Interview follow-up questions", 3_000),
  "## Solutions",
  long("### Talking it through in an interview", 4_000),
  long("### The reference solution", 6_000),
  long("### How the tests check it", 3_000),
  long("### Answers to the follow-up questions", 13_000),
].join("\n\n");
const bigParts = challengeParts(big);
const bigText = bigParts ? challengeText(bigParts, ["brief", "followUps", "interviewerNotes", "reference", "modelAnswers"], 60_000) : "";
const within = (part: ChallengePart) => {
  const clipped = clipPart(bigParts?.[part] ?? "", CHALLENGE_BUDGETS[part]);
  return bigText.includes(clipped) && clipped.includes("more characters)") && clipped.length <= CHALLENGE_BUDGETS[part] + 40;
};
check("each part is clipped to its own budget, with the note", (["brief", "followUps", "interviewerNotes", "reference", "modelAnswers"] as const).every(within));
const code = "```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter the code.";
check(
  "a cut inside a code block closes it before the note, and a cut after one doesn't",
  clipPart(code, 18) === `${code.slice(0, 18)}\n\`\`\`\n… (${code.length - 18} more characters)` && clipPart(code, 40) === clipText(code, 40),
);
const fenced = challengeParts("# T\n\n## The challenge\n\n```bash\n## not a heading\n```\n\n## Solutions\n\n### The reference solution\n\nx");
check("a heading inside a code block doesn't split the lesson", Boolean(fenced?.brief?.includes("## not a heading")) && fenced?.reference === "### The reference solution\n\nx");

// Ordinary lessons, and challenges without some sections.
const ordinary = "# 01.04 · Package managers\n\n## What\n\ntext\n\n## Exercises\n\n### 1. Paths\n\n## Solutions\n\n### 1. Paths\n\nanswer";
check("an ordinary lesson with ## Solutions isn't a challenge", !isChallengeLesson(ordinary) && challengeParts(ordinary) === null && !isChallengeLesson("# x\n\n## The challenge\n\ntext"));
/** The text without one section: its heading up to the next heading of its level or above. */
const without = (text: string, heading: string) => {
  const start = text.indexOf(`\n${heading}\n`);
  const level = heading.startsWith("### ") ? 3 : 2;
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`^#{2,${level}} `, "m"));
  return text.slice(0, start + 1) + (next < 0 ? "" : rest.slice(next));
};
const noFollowUps = challengeParts(without(lesson, "## Interview follow-up questions"));
check("without follow-up questions, the brief runs to the solutions", noFollowUps?.followUps === null && Boolean(noFollowUps?.brief?.includes("### Testing expectations")) && !noFollowUps?.brief?.includes("## Solutions"));
const noAnswers = challengeParts(without(without(lesson, "### Answers to the follow-up questions"), "### Talking it through in an interview"));
const noAnswersText = noAnswers ? challengeText(noAnswers, teaching, 37_000) : "";
check(
  "without the model answers or the talk-through, those parts are null and not shown",
  noAnswers?.modelAnswers === null && noAnswers.interviewerNotes === null && Boolean(noAnswers.reference) && !noAnswersText.includes("### Answers"),
);
const noSetup = challengeParts(without(lesson, "## Your setup"));
check("without a setup, the brief is the same", noSetup?.brief === parts?.brief);
const noSolutionParts = challengeParts("# T\n\n## The challenge\n\nspec\n\n## Interview follow-up questions\n\n1. Why?\n\n## Solutions\n\nSee the repository.");
check(
  "a challenge whose solutions have no known sections gives the problem alone",
  noSolutionParts !== null && noSolutionParts.reference === null && challengeText(noSolutionParts, teaching, 37_000) === "# T\n\n## The challenge\n\nspec\n\n## Interview follow-up questions\n\n1. Why?",
);
check("Windows line endings split the same", challengeParts(lesson.replace(/\n/g, "\r\n"))?.modelAnswers === parts?.modelAnswers);

// The lesson page's fold (docs/lesson-solutions.md): everything after ## Solutions, wherever it is.
const split = splitAtSolutions(lesson);
check(
  "the page folds from the ## Solutions heading to the end",
  split !== null &&
    split.heading === "Solutions" &&
    !split.before.includes("## Solutions") &&
    split.before.includes("## Interview follow-up questions") &&
    split.solutions.includes("### Answers to the follow-up questions") &&
    `${split.before}\n## ${split.heading}\n${split.solutions}` === lesson.replace(/\r/g, ""),
);
check(
  "a lesson without ## Solutions isn't folded, nor one with it only in a code block",
  splitAtSolutions("# T\n\n## What\n\n```md\n## Solutions\n```") === null && splitAtSolutions(ordinary)?.solutions === "\n### 1. Paths\n\nanswer",
);

void (async () => {
  const course = { sourceRepoUrl: null, sourceRef: null };
  const longOrdinary = `${ordinary}\n\n${"more ".repeat(5_000)}`;
  const challenge = { order: teaching, limit: 37_000 };
  check("an ordinary lesson comes back cut at the limit, as before", (await lessonTextFor(course, { body: longOrdinary, sourcePath: null }, 12_000, challenge)) === clipText(longOrdinary, 12_000));
  check("a challenge lesson comes back in parts", (await lessonTextFor(course, { body: lesson, sourcePath: null }, 12_000, challenge)) === board);
  check("no text is still no text", (await lessonTextFor(course, { body: null, sourcePath: null }, 12_000, challenge)) === null);

  console.log(failures ? `${failures} FAILED` : "All passed.");
  process.exit(failures ? 1 : 0);
})();
