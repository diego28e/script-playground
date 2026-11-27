// Checks the whiteboard's contract on the platform's side (docs/whiteboard-contract.md): the signed launch and service
// tokens, the events Didactra may send, and how a learner's practice state and a session's summary are told to the
// teacher. No database and no model: these are pure functions.
//
//   pnpm board:check
import type { PracticeState } from "@intellectif/lk-practice";
import { issueLaunch, issueService, LAUNCH_MS, readLaunch, serviceSession } from "@/lib/board/token";
import { BoardEvent } from "@/lib/board/events";
import { stateName, summaryText } from "@/lib/board/context";
import { fileScope } from "@/lib/preferences";
import { assemble } from "@/lib/voice/context";
import { requestConversation, requestOrigin, resolvePrompt } from "@/lib/practice/tutor-requests";

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

console.log(failures ? `${failures} FAILED` : "All passed.");
process.exit(failures ? 1 : 0);
