import { Type, type Schema, type ThinkingLevel } from "@google/genai";
import { hintRevealsAnswer, type AiItemFacts } from "@intellectif/lk-core";
import { chainStartingAt, generateWithFallback, TUTOR_CHAIN } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import type { Answer, SessionItem } from "@/lib/practice/learner";
import type { TaskContent } from "@/lib/practice/tasks";

// Hints (docs/practice.md, "Hints"): before answering a task, a learner can ask for up to three hints, each more
// specific than the last, written by DeepSeek V4.1 Flash for their attempt so far. A hint never gives the answer away:
// for choice, fill and predict tasks lk-core's hintRevealsAnswer checks it against the key (as it does for the OCW
// quizzes' AI hints); for code, a hint may not carry a code block or a line of the solution. The number of hints goes
// into the answer's evidence (lk-practice's hintsUsed), so a hinted right answer counts for less.

export const MAX_HINTS = 3;
/** Hints a learner can ask for in 24 hours, across tasks: each is one model call. */
const DAILY_HINTS = 40;
const HINT_MODEL = "deepseek-flash";
const MAX_LENGTH = 600;

const SYSTEM_PROMPT = `You are a patient programming tutor (Python, LangChain, LangGraph). A learner is working on a practice task and asked for a hint before answering.

Write ONE hint: one to three short sentences, in the learner's language.
- Never give the answer: not the right option, not the word or value that fills the blank, not what the code prints, and no code that solves the task (no code blocks; inline names of functions, parameters or types in backticks are fine).
- Use your own words. Don't reuse the distinctive words or phrases of the right option or of the key: a learner who matches your words against the options must not find the answer that way.
- Hint 1 stays general: which idea from the lesson applies, or what kind of thing the question is really about. Hint 2 narrows down where to look or what to check. Hint 3 is nearly there, but still leaves the last step to the learner.
- Plain sentences: no headings, lists or bold; backticks only for code names.
- Build on the earlier hints: don't repeat them.
- When the learner's attempt so far shows a misunderstanding, nudge them on that.
Answer with JSON: {"hint": "..."}.`;

const RESPONSE_SCHEMA: Schema = { type: Type.OBJECT, properties: { hint: { type: Type.STRING } }, required: ["hint"] };

/** lk-core's facts for the answer check: a choice task as multiple choice, fill and predict as one blank. */
function factsFor(taskId: string, content: TaskContent): AiItemFacts | null {
  if (content.form === "choice") {
    return {
      activityId: taskId,
      title: "",
      activityType: "multiple-choice",
      question: content.promptEn,
      mode: "single",
      options: [...(content.optionsEn ?? []), ...(content.optionsEs ?? [])].map((text, index) => ({
        id: String(index),
        text,
        chosen: false,
        correct: index % 4 === content.answerIndex,
      })),
    };
  }
  const accepted = content.form === "fill" ? (content.answers ?? []) : content.form === "predict" && content.expectedOutput ? [content.expectedOutput.trim()] : null;
  if (!accepted?.length) return null;
  return {
    activityId: taskId,
    title: "",
    activityType: "fill-in-the-blanks",
    passage: content.promptEn,
    blanks: [{ id: "1", position: 1, typed: "", accepted, correct: null }],
  };
}

/** Whether a hint gives the answer away: lk-core's check for questions; for code, a code block or a solution line. */
function revealsAnswer(taskId: string, content: TaskContent, hint: string): boolean {
  if (hint.includes("```")) return true;
  const facts = factsFor(taskId, content);
  if (facts && hintRevealsAnswer(facts, hint)) return true;
  if (content.form === "code" || content.form === "debug") {
    const squash = (text: string) => text.replace(/\s+/g, "");
    const given = new Set((content.code ?? "").split("\n").map(squash));
    const flat = squash(hint);
    return (content.solution ?? "")
      .split("\n")
      .map(squash)
      .some((line) => line.length >= 16 && !given.has(line) && flat.includes(line));
  }
  return false;
}

function keyFor(content: TaskContent): string {
  switch (content.form) {
    case "choice":
      return `Options:\n${(content.optionsEn ?? []).map((option, index) => `${index}. ${option}`).join("\n")}\nRight option: ${content.answerIndex}.`;
    case "fill":
      return `Accepted answers: ${(content.answers ?? []).join(" | ")}`;
    case "predict":
      return `Code:\n${content.code}\nIt prints:\n${content.expectedOutput}`;
    case "code":
      return `Starter:\n${content.code}\nHidden tests:\n${content.tests}\nReference solution:\n${content.solution}`;
    case "debug":
      return `Buggy code:\n${content.code}\nHidden tests:\n${content.tests}\nFixed code:\n${content.solution}`;
  }
}

function attemptFor(content: TaskContent, attempt: Answer): string {
  if (content.form === "choice") return attempt.index === undefined ? "(no option picked yet)" : `Leaning towards option ${attempt.index}.`;
  if (content.form === "code" || content.form === "debug") return attempt.code?.trim() ? `Their code now:\n${attempt.code.slice(0, 3000)}` : "(no code changed yet)";
  return attempt.text?.trim() ? `They typed: ${JSON.stringify(attempt.text.slice(0, 300))}` : "(nothing typed yet)";
}

export type HintResult = { ok: true; number: number; text: string; left: number } | { ok: false; error: string };

/** Writes the learner's next hint for an open task of their session. */
export async function askHint(input: { userId: string; sessionId: string; taskId: string; attempt: Answer; language: "es" | "en" }): Promise<HintResult> {
  const es = input.language === "es";
  const session = await prisma.practiceSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      items: true,
      learnerId: true,
      learner: { select: { userId: true } },
      answers: { where: { taskId: input.taskId }, select: { id: true } },
      hints: { where: { taskId: input.taskId }, orderBy: { number: "asc" }, select: { number: true, text: true } },
    },
  });
  if (!session || session.learner.userId !== input.userId) return { ok: false, error: es ? "Esta sesión de práctica no es tuya." : "This practice session isn't yours." };
  if (!(session.items as unknown as SessionItem[]).some((item) => item.taskId === input.taskId)) return { ok: false, error: es ? "Esa tarea no está en tu práctica." : "That task isn't in your practice." };
  if (session.answers.length) return { ok: false, error: es ? "Ya respondiste esta tarea." : "You've already answered this task." };
  if (session.hints.length >= MAX_HINTS) return { ok: false, error: es ? "Ya usaste todas las pistas de esta tarea." : "You've used every hint for this task." };
  const today = await prisma.practiceHint.count({ where: { session: { learnerId: session.learnerId }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (today >= DAILY_HINTS) return { ok: false, error: es ? "Por hoy no quedan más pistas. Vuelve mañana." : "No more hints today. Come back tomorrow." };

  const task = await prisma.practiceTask.findUnique({ where: { id: input.taskId }, select: { content: true } });
  const content = task?.content as unknown as TaskContent | undefined;
  if (!content) return { ok: false, error: es ? "Esa tarea ya no está disponible." : "That task is no longer available." };

  const number = session.hints.length + 1;
  const facts = [
    `# The task (${content.form})\n${es ? content.promptEs : content.promptEn}`,
    `# The key (for you only: never reveal it)\n${keyFor(content)}\nWhy: ${content.explanationEn}`,
    `# The learner's attempt so far\n${attemptFor(content, input.attempt)}`,
    `# Earlier hints\n${session.hints.map((hint) => `${hint.number}. ${hint.text}`).join("\n") || "(none)"}`,
    `Write hint ${number} of ${MAX_HINTS}, in ${es ? "Spanish" : "English"}.`,
  ].join("\n\n");

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateWithFallback({
      feature: "hint",
      pool: "TUTOR",
      userId: input.userId,
      models: chainStartingAt(TUTOR_CHAIN, HINT_MODEL),
      chosenFirst: true,
      deadline: Date.now() + 18_000,
      contents: [
        {
          role: "user",
          parts: [{ text: facts }, ...(attempt ? [{ text: "Your last hint gave the answer away. Write a vaguer one that leaves the answer to the learner." }] : [])],
        },
      ],
      config: { systemInstruction: SYSTEM_PROMPT, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: 1024 },
    });
    if (!result.ok) break;
    let text = "";
    try {
      text = String((JSON.parse(result.text) as { hint?: unknown }).hint ?? "").trim();
    } catch {
      continue;
    }
    if (!text || text.length > MAX_LENGTH || revealsAnswer(input.taskId, content, text)) {
      console.info(JSON.stringify({ event: "practice.hint_refused", taskId: input.taskId, number, model: result.model, length: text.length }));
      continue;
    }
    try {
      await prisma.practiceHint.create({ data: { sessionId: session.id, taskId: input.taskId, number, text, model: result.model } });
    } catch {
      // Two requests at once: the other one wrote this hint.
      return { ok: false, error: es ? "Ya hay una pista nueva: recarga la página." : "There's already a new hint: reload the page." };
    }
    return { ok: true, number, text, left: MAX_HINTS - number };
  }
  return { ok: false, error: es ? "Ahora no podemos darte una pista. Inténtalo de nuevo en un momento." : "We can't give you a hint right now. Try again in a moment." };
}
