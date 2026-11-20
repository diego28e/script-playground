import { Type, type Schema, type ThinkingLevel } from "@google/genai";
import type { AiPool } from "@prisma/client";
import { chainStartingAt, generateWithFallback, TUTOR_CHAIN } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { pacificDay } from "@/lib/ai/quota";
import type { TaskContent } from "@/lib/practice/tasks";

// Explain in your words (docs/practice.md, "Explain in your words"): the learner explains an idea, by voice or typing,
// and a model grades the explanation against the task's rubric: the points a good answer makes and the misconceptions
// to watch for. The same grader proves a task before it joins the pool (lib/practice/tasks.ts): an expert's blind
// answer must pass and a poor answer must fail.

/** DeepSeek first: a learner waits for the grade, and it answers in a few seconds. Then the free Gemini models. */
const GRADE_MODEL = "deepseek-flash";
export const GRADE_CHAIN = chainStartingAt(TUTOR_CHAIN, GRADE_MODEL);
/** Explanations a learner may have graded in a day: each is one model call. */
export const GRADES_PER_DAY = 60;
/** Under this many words there's nothing to grade: the answer fails without a model call. */
const MIN_WORDS = 12;
/** The share of the rubric an explanation needs to pass, with no misconception or wrong claim. */
export const PASS_SCORE = 0.6;
/** What each misconception held or clearly wrong claim takes off the score. */
const ERROR_PENALTY = 0.25;

export type PointMade = "yes" | "partly" | "no";
export type ExplainGrade = {
  points: { made: PointMade; note: string }[];
  /** Indexes into the task's misconceptions that the answer holds. */
  misconceptions: number[];
  /** Other clearly false statements, in the learner's language. */
  otherErrors: string[];
  /** To the learner, in their language: what was strong, and the one thing to add or fix. */
  feedback: string;
  confidence: "high" | "medium" | "low";
  score: number;
  passed: boolean;
};

const SYSTEM_PROMPT = `You grade a learner's explanation for a practice task against the task's rubric. The learner may have spoken it (speech-to-text) or typed it.

RULES
- Judge the ideas, not the wording. Ignore transcription slips, filler words, repetitions, unfinished sentences and grammar. Spanish, English or both mixed are fine.
- For each POINT, in order: "yes" when the answer makes it, in any words, clearly enough that a colleague would understand it; "partly" when it is touched on but vague, incomplete or only implied; "no" when it is missing. Be fair, not generous: naming a term without what it means is "partly" at most.
- misconceptions: one entry per listed MISCONCEPTION, in order: true only when the answer states it or clearly relies on it, else false. Mentioning one in order to reject it is not holding it, and a different mistake is not this one (put it in otherErrors).
- otherErrors: any other statement in the answer that is clearly false (not an imprecision, not a simplification), each in a few words. Usually none.
- note (per point): at most 20 words, in the learner's language: what they said for it, or what is missing.
- feedback: one to three sentences to the learner ("you"), in their language: first what was strong, then the single most useful thing to add or fix. Don't write the whole answer for them.
- confidence: "low" when the answer is garbled or too unclear to judge, "medium" when some points were hard to call, else "high".

Answer with the JSON object only, in exactly this shape (one entry in "points" per POINT and one in "misconceptions" per MISCONCEPTION, in order; "made" is "yes", "partly" or "no"):
{"points": [{"made": "yes", "note": "..."}, {"made": "partly", "note": "..."}, {"made": "no", "note": "..."}], "misconceptions": [false, true], "otherErrors": [], "feedback": "...", "confidence": "high"}`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    points: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { made: { type: Type.STRING, enum: ["yes", "partly", "no"] }, note: { type: Type.STRING } },
        required: ["made", "note"],
        propertyOrdering: ["made", "note"],
      },
    },
    misconceptions: { type: Type.ARRAY, items: { type: Type.BOOLEAN } },
    otherErrors: { type: Type.ARRAY, items: { type: Type.STRING } },
    feedback: { type: Type.STRING },
    confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
  },
  required: ["points", "misconceptions", "otherErrors", "feedback", "confidence"],
  propertyOrdering: ["points", "misconceptions", "otherErrors", "feedback", "confidence"],
};

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * A point's verdict as a model wrote it. Models that only take "JSON mode" (DeepSeek) don't see the schema's enum and
 * may write "Yes", "partial" or true: read those too, and anything else as not made.
 */
function readMade(value: unknown): PointMade {
  if (value === true) return "yes";
  const text = String(value ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "made", "full", "fully", "sí", "si"].includes(text)) return "yes";
  if (text.startsWith("part") || text === "half" || text === "parcial" || text === "a medias") return "partly";
  return "no";
}

/** The score and verdict from the points made and the errors: yes counts 1, partly a half, each error takes a quarter. */
export function scoreExplanation(points: PointMade[], errors: number): { score: number; passed: boolean } {
  const made = points.reduce((sum, point) => sum + (point === "yes" ? 1 : point === "partly" ? 0.5 : 0), 0);
  const score = Math.max(0, Math.min(1, made / Math.max(points.length, 1) - errors * ERROR_PENALTY));
  return { score: Math.round(score * 100) / 100, passed: score >= PASS_SCORE && errors === 0 };
}

export type GradeOutcome = { ok: true; grade: ExplainGrade; model: string | null } | { ok: false; error: string };

/**
 * Grades one explanation. `pool` is whose allowance the call draws on: the tutor's for a learner, authoring for a
 * task's proof. Ends by `deadline` (epoch ms).
 */
export async function gradeExplanation(input: {
  content: Pick<TaskContent, "promptEn" | "pointsEn" | "misconceptionsEn">;
  answer: string;
  language: "es" | "en";
  userId: string;
  pool: AiPool;
  deadline: number;
  subject?: string;
}): Promise<GradeOutcome> {
  const points = input.content.pointsEn ?? [];
  const misconceptions = input.content.misconceptionsEn ?? [];
  if (!points.length) return { ok: false, error: "This task has no rubric." };
  const es = input.language === "es";
  if (words(input.answer) < MIN_WORDS) {
    const { score, passed } = scoreExplanation(points.map(() => "no"), 0);
    return {
      ok: true,
      model: null,
      grade: {
        points: points.map(() => ({ made: "no", note: "" })),
        misconceptions: [],
        otherErrors: [],
        feedback: es ? "Es demasiado corta para valorarla: explícalo con más detalle, como se lo contarías a un colega." : "That's too short to grade: explain it in more detail, as you would to a colleague.",
        confidence: "high",
        score,
        passed,
      },
    };
  }
  const facts = [
    input.subject ? `# The course\n${input.subject}` : "",
    `# The task\n${input.content.promptEn}`,
    `# POINTS a good answer makes\n${points.map((point, index) => `${index + 1}. ${point}`).join("\n")}`,
    `# MISCONCEPTIONS to watch for\n${misconceptions.map((wrong, index) => `${index + 1}. ${wrong}`).join("\n") || "(none listed)"}`,
    `# The learner's answer\n${input.answer.slice(0, 8000)}`,
    `Grade it. Write the notes and the feedback in ${es ? "Spanish" : "English"}. Give exactly ${points.length} points and ${misconceptions.length} misconceptions, in order.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await generateWithFallback({
    feature: "grade",
    pool: input.pool,
    userId: input.userId,
    models: GRADE_CHAIN,
    chosenFirst: true,
    deadline: input.deadline,
    contents: [{ role: "user", parts: [{ text: facts }] }],
    config: { systemInstruction: SYSTEM_PROMPT, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: 2048 },
  });
  if (!result.ok) return { ok: false, error: result.reason === "quota" ? "quota" : "unavailable" };
  let raw: { points?: { made?: unknown; note?: string }[]; misconceptions?: unknown[]; otherErrors?: string[]; feedback?: string; confidence?: string };
  try {
    raw = JSON.parse(result.text);
  } catch {
    return { ok: false, error: "unreadable" };
  }
  const given = Array.isArray(raw.points) ? raw.points : [];
  const graded = points.map((_, index) => {
    const point = given[index];
    const made = readMade(point?.made);
    return { made, note: String(point?.note ?? "").trim().slice(0, 240) };
  });
  // One verdict per misconception, in order ("yes" and "true" read as held, like a point's verdict).
  const verdicts = Array.isArray(raw.misconceptions) ? raw.misconceptions : [];
  const held = misconceptions.map((_, index) => index).filter((index) => readMade(verdicts[index]) === "yes");
  const otherErrors = (raw.otherErrors ?? []).map((text) => String(text).trim()).filter(Boolean).slice(0, 3);
  const { score, passed } = scoreExplanation(
    graded.map((point) => point.made),
    held.length + otherErrors.length,
  );
  const confidence = raw.confidence === "high" || raw.confidence === "low" ? raw.confidence : "medium";
  return {
    ok: true,
    model: result.model,
    grade: { points: graded, misconceptions: held, otherErrors, feedback: String(raw.feedback ?? "").trim().slice(0, 800), confidence, score, passed },
  };
}

/** Whether the learner may have another explanation graded today. */
export async function canGrade(userId: string): Promise<boolean> {
  return (await prisma.aiRequest.count({ where: { userId, day: pacificDay(), feature: "grade" } })) < GRADES_PER_DAY;
}
