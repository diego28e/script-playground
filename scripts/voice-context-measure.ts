// Measures the voice teachers' context on a real conversation (docs/voice-context.md, "Measured"): a scripted learner
// talks to the lesson teacher through the real pipeline (lib/lesson-tutor/turn.ts → lib/voice/turn.ts), and each turn
// prints what the model was sent, part by part, what the provider read from its cache, and how long the first words
// took. It needs the database and the model keys in .env; it spends about 170,000 input tokens on the cheapest model.
//
//   pnpm voice:context:measure            the long conversation: 21 turns, 5 compactions, then two recall questions
//   pnpm voice:context:measure moving     6 turns with the audio at another moment each time
//   … --keep                              leave the conversation in the database (it is deleted otherwise)
//   … --out file.json                     also write the rows to a file
//
// The recall questions are the test of the memory: by then the turns they ask about were folded into the summary long
// ago, so the model can only answer from the notes. The script exits 1 when a recall check fails.
import "./load-env";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { runLessonTurn } from "@/lib/lesson-tutor/turn";

type Check = { name: string; pass: (reply: string, early: string[]) => boolean };
type Scenario = { lesson: string; at: (turn: number) => number; learner: string[]; checks: Record<number, Check[]> };

const SCENARIOS: Record<string, Scenario> = {
  long: {
    lesson: "03.08",
    at: () => 312,
    learner: [
      "Before we start: please go slowly and use AWS examples, I learn better that way. What is a TTL in DNS? I think it's how long the authoritative server keeps the record before deleting it.",
      "Oh, so it's about the resolvers remembering the answer, not the server deleting it. Okay.",
      "next",
      "Because each resolver asked at a different moment, so each one forgets at a different moment?",
      "next",
      "I'd lower the TTL to 60 first, wait, and then change the record.",
      "How long do I have to wait after lowering it?",
      "next",
      "What's the difference between the resolver and the authoritative server again?",
      "So the machine only talks to the resolver in resolv.conf, and the resolver asks the authority.",
      "next",
      "deeper",
      "What does dig do differently from getent hosts?",
      "next",
      "And the hosts file, where does it fit?",
      "So dig could show the right IP while curl still goes to the wrong one because of the hosts file?",
      "next",
      "How does this map to Route 53? What would I actually click or run?",
      "next",
      "Okay. Now remind me: what did I get wrong at the very beginning of this conversation, and how did I ask you to explain things?",
      "And what was the first exact value or command you gave me for the TTL?",
    ],
    checks: {
      20: [
        { name: "recalls how the learner asked to be taught (slowly, AWS examples)", pass: (reply) => /AWS/.test(reply) && /slow/i.test(reply) },
        { name: "recalls the learner's first mistake (the server deleting the record)", pass: (reply) => /delet/i.test(reply) },
      ],
      21: [{ name: "recalls an exact value from the first replies", pass: (reply, early) => early.some((value) => reply.includes(value)) }],
    },
  },
  // The audio at another moment on every question: what changes each turn must not cost the turns their cache.
  moving: {
    lesson: "00.04",
    at: (turn) => 60 + turn * 95,
    learner: ["What is this part about?", "Why does that matter in a screening call?", "next", "Give me an example of doing it badly.", "next", "And how long should it take to say?"],
    checks: {},
  },
};

async function main() {
  const args = process.argv.slice(2);
  const scenario = SCENARIOS[args.find((arg) => arg in SCENARIOS) ?? "long"];
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" }, select: { id: true } });
  const lesson = await prisma.lesson.findFirstOrThrow({ where: { code: scenario.lesson, module: { course: { slug: "sre-interview-readiness" } } }, select: { id: true } });
  let conversationId: string | null = null;
  const rows: Record<string, unknown>[] = [];
  const failed: string[] = [];
  let everything = 0;
  for (const [index, question] of scenario.learner.entries()) {
    const turn = index + 1;
    const started = Date.now();
    let firstText = 0;
    const result = await runLessonTurn(admin.id, lesson.id, { question, at: scenario.at(turn), conversationId, spoken: true, language: "en" }, (event) => {
      if (event.type === "delta" && !firstText) firstText = Date.now() - started;
    });
    if (!result.ok) throw new Error(`turn ${turn} failed: ${JSON.stringify(result)}`);
    conversationId = result.conversationId ?? conversationId;
    const message = await prisma.voiceMessage.findFirstOrThrow({ where: { conversationId: conversationId!, role: "teacher" }, orderBy: { seq: "desc" }, select: { meta: true } });
    const meta = message.meta as { context: Record<string, number>; messagesSent: number; shortened: number; summarised: number; tokens?: { input?: number; output?: number; cached?: number } };
    // What sending every earlier message word for word would have weighed, for comparison.
    const allTurns = everything + question.length;
    everything += question.length + result.reply.length;
    rows.push({ turn, question, reply: result.reply, firstTextMs: firstText, totalMs: Date.now() - started, ...meta.context, allTurns, messagesSent: meta.messagesSent, summarised: meta.summarised, shortened: meta.shortened, tokens: meta.tokens });
    console.log(
      `turn ${String(turn).padStart(2)} | sent ${String(meta.messagesSent).padStart(2)} msgs | turns ${String(meta.context.turns).padStart(5)} ch (everything: ${String(allTurns).padStart(5)}) | memory ${String(meta.context.memory).padStart(4)} | now ${String(meta.context.situation).padStart(4)} | total ${meta.context.total} ch | in ${meta.tokens?.input} tok, cached ${meta.tokens?.cached ?? "?"} | summary up to ${String(meta.summarised).padStart(2)} | first text ${firstText} ms`,
    );
    const checks = scenario.checks[turn];
    if (checks) {
      // Exact values the teacher gave in the first replies: the ones the first compaction folded away.
      const early = await prisma.voiceMessage.findMany({ where: { conversationId: conversationId!, role: "teacher", seq: { lte: 6 } }, select: { text: true } });
      const values = [...new Set(early.flatMap((entry) => [...entry.text.matchAll(/`([^`\n]{2,80})`/g)].map((match) => match[1])))];
      console.log(`   Q: ${question}\n   A: ${result.reply.replace(/\s+/g, " ")}`);
      for (const check of checks) {
        const pass = check.pass(result.reply, values);
        if (!pass) failed.push(check.name);
        console.log(`   ${pass ? "ok  " : "FAIL"} ${check.name}`);
      }
    }
    // Compaction runs after the reply; a person talking leaves it at least this long.
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  const conversation = await prisma.voiceConversation.findUniqueOrThrow({ where: { id: conversationId! }, select: { id: true, title: true, summary: true, summarySeq: true, messageCount: true } });
  console.log(`\nconversation ${conversation.id} | messages ${conversation.messageCount} | summary covers up to ${conversation.summarySeq}\n--- summary (${conversation.summary?.length ?? 0} ch) ---\n${conversation.summary ?? "(none)"}`);
  if (out) writeFileSync(out, JSON.stringify({ conversation, rows }, null, 1));
  if (!args.includes("--keep")) await prisma.voiceConversation.delete({ where: { id: conversation.id } });
  console.log(failed.length ? `\n${failed.length} recall check(s) FAILED` : "\nRecall checks passed.");
  process.exitCode = failed.length ? 1 : 0;
}
main().finally(() => prisma.$disconnect());
