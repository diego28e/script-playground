// Checks the whiteboard's contract on the platform's side (docs/whiteboard-contract.md): the signed launch and service
// tokens, the events Didactra may send, and how a learner's practice state and a session's summary are told to the
// teacher. No database and no model: these are pure functions.
//
//   pnpm board:check
import type { PracticeState } from "@intellectif/lk-practice";
import { issueLaunch, issueService, LAUNCH_MS, readLaunch, serviceSession } from "@/lib/board/token";
import { BoardEvent } from "@/lib/board/events";
import { stateName, summaryText } from "@/lib/board/context";

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

console.log(failures ? `${failures} FAILED` : "All passed.");
process.exit(failures ? 1 : 0);
