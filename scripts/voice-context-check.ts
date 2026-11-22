// Checks the voice teachers' context rules (lib/voice/context.ts, docs/voice-context.md) on made-up conversations: when
// a conversation is compacted and where the cut lands, what the model is sent word for word, and the order of the
// layers. No database and no model: the rules are pure functions.
//
//   pnpm voice:context:check
import { isEcho, isInterruption, wordsOf } from "@/lib/voice/barge";
import { splitNote } from "@/lib/voice/profile";
import { assemble, BUDGET, compactionCut, fitSummary, SECTIONS, turnsFor, unsummarised, type StoredMessage } from "@/lib/voice/context";

/** A conversation of `count` messages, learner first, each reply `replyChars` long. */
const make = (count: number, replyChars = 900): StoredMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    role: index % 2 === 0 ? ("learner" as const) : ("teacher" as const),
    text: index % 2 === 0 ? `question ${index / 2 + 1}` : `reply ${(index + 1) / 2} `.padEnd(replyChars, "x"),
    status: "ok" as const,
  }));

let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  if (!pass) failures += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const textOf = (content: { parts?: { text?: string }[] } | undefined) => String(content?.parts?.[0]?.text ?? "");

// Compaction: nothing until the recent window plus a batch has piled up; then everything but the window is folded.
check("no compaction at 13 messages", compactionCut(make(13), 0) === null);
const first = compactionCut(make(14), 0);
check("compaction at 14 folds the first 6", first === 6, `cut ${first}`);
const kept = unsummarised(make(14), first ?? 0);
check("8 messages stay word for word, starting with the learner", kept.length === BUDGET.recentMessages && kept[0].role === "learner", `${kept.length}, first ${kept[0].role}`);
check("no second compaction at 19", compactionCut(make(19), 6) === null);
check("second compaction at 20 folds up to 12", compactionCut(make(20), 6) === 12, `cut ${compactionCut(make(20), 6)}`);
// A failed reply leaves two learner messages in a row: the cut still lands just before a learner's message.
const odd = make(15).map((message) => (message.seq === 8 ? { ...message, status: "failed" as const } : message));
const oddCut = compactionCut(odd, 0);
check("the cut lands just before a learner's message", odd.find((message) => message.seq === (oddCut ?? 0) + 1)?.role === "learner", `cut ${oddCut}`);

// The turns: they start with the learner, alternate, and end with the new question.
const turns = turnsFor(make(8), 0, "new question", "en");
check("8 stored messages and the question make 9 turns", turns.contents.length === 9 && turns.contents[0].role === "user" && turns.contents.at(-1)?.role === "user", `${turns.contents.length}`);
check("the two sides alternate", turns.contents.every((content, index) => index === 0 || content.role !== turns.contents[index - 1].role));
const withFailure = turnsFor(make(8).map((message) => (message.seq === 8 ? { ...message, status: "failed" as const } : message)), 0, "again?", "en");
check("a failed reply is left out and its question joins the next", withFailure.contents.length === 7 && textOf(withFailure.contents.at(-1)).includes("question 4\n\nagain?"));
const interrupted = turnsFor(make(2).map((message) => (message.seq === 2 ? { ...message, status: "interrupted" as const } : message)), 0, "and then?", "en");
check("a reply the learner cut off says so to the model", textOf(interrupted.contents[1]).includes("cut you off"));
const long = turnsFor(make(13, 2500), 0, "q", "en");
check("over the budget, the oldest replies are shortened", long.shortened > 0 && long.chars <= BUDGET.recentChars + 2600, `shortened ${long.shortened}, ${long.chars} chars`);
check("the newest reply stays whole", textOf(long.contents.at(-2)).length >= 2500);

// The layers: always in the same order, what never changes first.
const { system } = assemble({ role: "ROLE", grounding: "GROUNDING", summary: "notes", digest: ["an earlier question (2026-11-20)"] }, "en");
const order = ["ROLE", "GROUNDING", "THIS CONVERSATION SO FAR", "EARLIER CONVERSATIONS"].map((mark) => system.indexOf(mark));
check("the system instruction in order: role, grounding, memory", order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), order.join(" < "));
check("no memory layer before the first compaction", !assemble({ role: "R", grounding: "G", summary: null, digest: [] }, "en").system.includes("SO FAR"));
// What changes every turn sits last: nothing in the system instruction, and only the final message carries it.
check("the system instruction holds nothing that changes every turn", !system.includes("RIGHT NOW"));
const withNow = turnsFor(make(8), 0, "new question", "en", "paused at 5:12");
const lastText = textOf(withNow.contents.at(-1));
check("the situation is in the last message only, above the question", lastText.indexOf("# RIGHT NOW") === 0 && lastText.endsWith("new question") && withNow.contents.slice(0, -1).every((content) => !textOf(content).includes("RIGHT NOW")));
// The cache rule itself: one turn later, with another situation, everything before the previous question is unchanged.
const after = turnsFor([...make(8), { seq: 9, role: "learner", text: "new question", status: "ok" }, { seq: 10, role: "teacher", text: "the reply", status: "ok" }], 0, "one more", "en", "paused at 9:40");
check("a new turn and a new situation leave the earlier turns byte for byte the same", withNow.contents.slice(0, -1).every((content, index) => textOf(content) === textOf(after.contents[index])));

// The summary: each section holds its own limit, so a long list can't push out what is known about the learner.
const concepts = Array.from({ length: 40 }, (_, index) => `- concept ${index + 1}: explained up to what goes wrong, with an example`).join("\n");
const written = `# NOTES\n\n**TOPIC NOW:** locking\nSTEP REACHED:\n- in practice; next: what goes wrong\nCOVERED:\n${concepts}\nTHE LEARNER:\n- asked for slow steps and AWS examples\n- thought a TTL deletes the record; corrected\nEXACT THINGS GIVEN:\n- \`terraform force-unlock <ID>\`: frees a stuck lock\nOPEN: none`;
const fitted = fitSummary(written, "en");
const places = SECTIONS.map((section) => fitted.indexOf(`${section.en}:`));
check("the summary comes back in the fixed order, the learner first", places[0] === 0 && places.every((at, index) => index === 0 || at > places[index - 1]), places.join(" < "));
check("a long list of concepts leaves the learner's section whole", fitted.includes("slow steps and AWS examples") && fitted.includes("thought a TTL deletes the record"));
check("the list loses its oldest lines, not its newest", fitted.includes("concept 40:") && !fitted.includes("concept 1:"));
const limit = SECTIONS.reduce((sum, section) => sum + section.chars + section.en.length + 4, 0);
check("the whole summary holds its budget", fitted.length <= limit && limit <= BUDGET.summaryChars + 200, `${fitted.length} of ${limit}`);
check("a heading with nothing under it reads none", /OPEN:\nnone/.test(fitted));
check("fitting a fitted summary changes nothing", fitSummary(fitted, "en") === fitted);
// The same model writes the headings with a colon on one compaction and without on the next: both are read.
const bare = fitSummary(`THE LEARNER\n- wants AWS examples\n\nTOPIC NOW\nlocking\n\n## COVERED\n${concepts}\n\n**EXACT THINGS GIVEN**\n- \`terraform plan\`: shows the change`, "en");
check("headings without a colon are read too", bare.startsWith("THE LEARNER:\n- wants AWS examples") && bare.includes("EXACT THINGS GIVEN:\n- `terraform plan`") && bare.length <= limit, `${bare.length} chars`);
check("a line of text that begins with a heading's word isn't a heading", fitSummary("THE LEARNER:\n- fine\nOPEN:\n- OPEN questions were answered\nCOVERED:\n- locking", "en").includes("- OPEN questions were answered"));
check("a note without the headings is cut to the whole budget", fitSummary("x".repeat(5000), "en").length <= BUDGET.summaryChars + 1);

// Interrupting by voice (lib/voice/barge.ts): what the microphone hears while the teacher speaks.
const speaking = "The resolver remembers the answer for as long as the TTL says, so lowering the TTL a day before a migration means every resolver asks again within a minute of the change.";
check("a real question cuts the teacher off", isInterruption("wait so what happens with the old answer", speaking));
check("a stop word alone is enough", isInterruption("wait", speaking) && isInterruption("espera", speaking));
check("listening sounds don't interrupt", !isInterruption("mm-hm okay yeah", speaking) && !isInterruption("sí, vale", speaking));
check("two words aren't enough", !isInterruption("the resolver", speaking));
check("the teacher's own voice coming back isn't the learner", !isInterruption("remembers the answer for as long as the TTL says", speaking) && isEcho(wordsOf("every resolver asks again within a minute"), speaking));
check("a learner reusing the teacher's words in a question still interrupts", isInterruption("why does the resolver keep the old answer", speaking));

// The learner profile (lib/voice/profile.ts): two parts, each section to its own limit.
const longLines = Array.from({ length: 30 }, (_, index) => `- knows topic ${index + 1} well, explained it back`).join("\n");
const profileNote = [
  "HOW THEY LIKE TO LEARN:",
  "- learns by debating in conversation, not by listening",
  "- wants AWS examples",
  "WHAT WORKS:",
  "- worked examples",
  "WHAT DOESN'T:",
  "- being quizzed after every answer",
  "THEIR GOALS:",
  "- SRE interviews",
  "MISCONCEPTIONS:",
  "- thought TTL deletes the record (corrected)",
  "STILL SHAKY:",
  "- negative caching",
  "KNOWS WELL:",
  longLines,
].join("\n");
const { general, course } = splitNote(profileNote, "en");
check("the profile's general part keeps how they learn", general.startsWith("HOW THEY LIKE TO LEARN:\n- learns by debating") && general.includes("being quizzed after every answer") && !general.includes("KNOWS WELL"));
check("the course part keeps misconceptions whole and the newest of a long list", course.includes("thought TTL deletes the record") && course.includes("topic 30") && !course.includes("topic 1 well"));
check("the profile sits in memory, after the lesson and before the conversation's note", (() => {
  const built = assemble({ role: "ROLE", grounding: "GROUNDING", profile: "PROFILE", summary: "notes", digest: [] }, "en").system;
  return built.indexOf("GROUNDING") < built.indexOf("PROFILE") && built.indexOf("PROFILE") < built.indexOf("THIS CONVERSATION SO FAR");
})());

console.log(failures ? `${failures} FAILED` : "All passed.");
process.exit(failures ? 1 : 0);
