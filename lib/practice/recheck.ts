import { Type, type Schema, type ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { AUTHORING_CHAIN, chainStartingAt, generateWithFallback } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { RUNNABLE_PYTHON, RUNNABLE_TYPESCRIPT } from "@/lib/practice/draft";
import { LANGUAGE, practiceLanguage } from "@/lib/practice/language";
import { courseSubject } from "@/lib/practice/tasks";

// Re-checking whether code tasks can practise a course's skills (docs/practice.md, "Languages"), without redrafting
// them: a skill's `runnable` flag was decided when it was drafted, against the rule of the course's language then. When
// that rule was wrong for the course (the TypeScript course's skills were drafted before there was a TypeScript rule,
// against "plain Python"), a cheap model reads each skill again with the drafter's own rule for the course's language
// and only the flag changes: keys, labels, prerequisites, approvals and tasks stay. It reaches learners with the next
// published version. A batch of skills per call, so each call ends well inside one request.

export const RECHECK_BATCH = 24;
const MODEL = "deepseek-flash";

const SYSTEM_PROMPT = `You check one property of practice skills in an online course: whether short code tasks can practise each one. Learners practise each skill with short tasks (1 to 3 minutes); a skill marked runnable also gets code tasks (predict what code prints, write a small piece of code, fix a broken snippet), the others get questions and spoken explanations only.

THE RULE, as the course's skill drafter applies it:
{RULE}

For EVERY skill listed, answer runnable true or false by the rule, with a reason of at most 15 words. Judge the skill as described, not the lesson's other topics. Answer with JSON: {"skills": [{"key": "...", "runnable": true, "reason": "..."}]}.`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    skills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { key: { type: Type.STRING }, runnable: { type: Type.BOOLEAN }, reason: { type: Type.STRING } },
        required: ["key", "runnable", "reason"],
      },
    },
  },
  required: ["skills"],
};
const Answer = z.object({ skills: z.array(z.object({ key: z.string(), runnable: z.boolean(), reason: z.string().default("") })) });

export type RecheckChange = { key: string; label: string; runnable: boolean; reason: string };
export type RecheckResult =
  | { ok: true; checked: number; total: number; next: number | null; changed: RecheckChange[]; model: string; language: string }
  | { ok: false; error: string };

/** Re-checks the code flag of the course's skills `offset`..`offset + RECHECK_BATCH` (in course order) and saves what changed. */
export async function recheckCodeFlags(input: { courseId: string; offset: number; userId: string; deadline: number }): Promise<RecheckResult> {
  const course = await prisma.course.findUnique({ where: { id: input.courseId }, select: { title: true, summary: true, practiceLanguage: true } });
  if (!course) return { ok: false, error: "Course not found." };
  const language = practiceLanguage(course.practiceLanguage);
  const where = { courseId: input.courseId };
  const total = await prisma.practiceSkill.count({ where });
  const skills = await prisma.practiceSkill.findMany({
    where,
    orderBy: [{ lesson: { module: { position: "asc" } } }, { lesson: { position: "asc" } }, { position: "asc" }, { id: "asc" }],
    skip: Math.max(0, input.offset),
    take: RECHECK_BATCH,
    select: { id: true, key: true, labelEn: true, descriptionEn: true, criteriaHint: true, knowledge: true, runnable: true, lesson: { select: { code: true, title: true } } },
  });
  if (!skills.length) return { ok: true, checked: 0, total, next: null, changed: [], model: "", language: LANGUAGE[language].label };

  const list = skills
    .map((skill) => `- ${skill.key} (${skill.knowledge.toLowerCase()}; lesson ${skill.lesson.code ?? ""} ${skill.lesson.title.replaceAll("`", "")}): ${skill.labelEn}. ${skill.descriptionEn}${skill.criteriaHint ? ` What shows it: ${skill.criteriaHint}` : ""}`)
    .join("\n");
  const result = await generateWithFallback({
    feature: "graph",
    pool: "AUTHORING",
    userId: input.userId,
    models: chainStartingAt(AUTHORING_CHAIN, MODEL),
    chosenFirst: true,
    deadline: input.deadline,
    contents: [{ role: "user", parts: [{ text: `# THE COURSE\n${courseSubject(course)}\n\n# SKILLS\n${list}` }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT.replace("{RULE}", language === "typescript" ? RUNNABLE_TYPESCRIPT : RUNNABLE_PYTHON),
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel },
      maxOutputTokens: 4096,
    },
  });
  if (!result.ok) return { ok: false, error: result.reason === "quota" ? "Today's authoring allowance is used up." : "No model could check these skills in time. Run it again: it carries on where it stopped." };
  let answer: z.infer<typeof Answer>;
  try {
    answer = Answer.parse(JSON.parse(result.text));
  } catch {
    return { ok: false, error: `${result.model} didn't answer in the expected shape. Run it again: it carries on where it stopped.` };
  }

  // Only the flags that change; a skill the model left out keeps its own.
  const verdicts = new Map(answer.skills.map((entry) => [entry.key, entry]));
  const changed: RecheckChange[] = [];
  for (const skill of skills) {
    const verdict = verdicts.get(skill.key);
    if (!verdict || verdict.runnable === skill.runnable) continue;
    await prisma.practiceSkill.update({ where: { id: skill.id }, data: { runnable: verdict.runnable } });
    changed.push({ key: skill.key, label: skill.labelEn, runnable: verdict.runnable, reason: verdict.reason });
  }
  const next = input.offset + skills.length;
  return { ok: true, checked: skills.length, total, next: next < total ? next : null, changed, model: result.model, language: LANGUAGE[language].label };
}
