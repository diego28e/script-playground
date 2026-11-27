import { Type, type Content, type Schema, type ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { authoringChain, generateWithFallback, isAuthoringModel } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { lessonTextFor, type ChallengePart } from "@/lib/lesson-sections";
import { REQUEST_BUDGET_MS } from "@/lib/request-budget";
import { practiceLanguage, type PracticeLanguage } from "@/lib/practice/language";

// Drafting a lesson's practice skills (docs/practice.md, "The skill graph"): a model reads the lesson (objectives,
// prerequisites and the notebook or reading itself) and the skills earlier lessons already have, and proposes this
// lesson's skills with their prerequisites. The draft is saved for an admin to review on /admin/practice; nothing
// reaches learners until a graph version is published (lib/practice/graph.ts).

export const SYSTEM_PROMPT = `You design the skill graph behind spaced practice for an online course: a programming course, or one on engineering practice (site reliability, cloud, operations, interviews). Learners practise each skill later with short tasks (1 to 3 minutes): multiple-choice and fill-in questions, explaining an idea aloud in their own words, and, where Python can practise it, predicting a snippet's output, writing a small piece of code, or fixing a broken snippet. A planner schedules them and unlocks a skill once its hard prerequisites are mastered.

For ONE lesson, propose the skills it teaches.

RULES
- 2 to 6 skills, about one per learning objective. Each is one ability a learner can show in a short task: "read an environment variable with a default", not "configuration". Merge objectives that are the same ability; split one that holds two.
- Skip one-time chores (creating an account, installing a package, opening a file) unless there is knowledge in them worth keeping, such as "which value wins when override=True".
- Never repeat a skill the course already has (listed under EXISTING SKILLS). If the lesson revisits one, leave it out; you may name it as a prerequisite instead.
- key: English kebab-case, 2 to 6 words, specific to the skill ("dotenv-override-precedence"). Unique in the course.
- labelEn / labelEs: a short can-do label, verb first, at most 8 words, in English and in Spanish. Keep code names (functions, classes, parameters) in English in both.
- descriptionEn / descriptionEs: one sentence on what a learner who has the skill can do.
- knowledge: "declarative" for knowing and explaining (what, why, which, when) or "procedural" for doing (writing or running code, following a procedure).
- runnable: true when a short task can practise it offline with plain Python and the course's packages: no network, no API keys, no GPU, no Docker. LangChain's fake chat models count as offline. False when it only makes sense against a live service, or isn't about Python at all (shell, cloud consoles, Kubernetes, incident response, interview answers): then it gets questions and explanations.
- criteriaHint: in English, how a grader can tell from an answer that this skill, and not a neighbouring one, is shown.
- prerequisites: only the DIRECT ones, at most 3 per skill: keys from EXISTING SKILLS, or keys of skills earlier in your own list. "hard" when the skill cannot be practised without it; "soft" when it helps. Give a short reason. Never point to a later skill.

RESPONSE
Answer with one JSON object, for example (the content is only an illustration):
{"skills": [{"key": "dotenv-load-env-file", "labelEn": "Load a .env file with python-dotenv", "labelEs": "Cargar un archivo .env con python-dotenv", "descriptionEn": "Loads settings from a .env file into the environment and says where the file is found.", "descriptionEs": "Carga la configuración de un archivo .env en el entorno y sabe dónde se busca el archivo.", "knowledge": "procedural", "runnable": true, "criteriaHint": "Calls load_dotenv (or find_dotenv) before reading the variable; not just os.environ access.", "prerequisites": [{"key": "env-var-read-default", "strength": "hard", "reason": "Loading a .env file only matters once you read the variables."}]}]}`;

/**
 * The drafting instructions for a course whose code practice is in `language` (docs/practice.md, "Languages"). Python is
 * SYSTEM_PROMPT as it always was; TypeScript changes only what code tasks can practise, and the example.
 */
export function draftPrompt(language: PracticeLanguage): string {
  if (language === "python") return SYSTEM_PROMPT;
  const swap = (text: string, from: string, to: string) => {
    if (!text.includes(from)) throw new Error(`The drafting prompt changed: "${from.slice(0, 40)}…" is not in it.`);
    return text.replace(from, to);
  };
  let prompt = swap(SYSTEM_PROMPT, "where Python can practise it,", "where TypeScript can practise it,");
  prompt = swap(prompt, RUNNABLE_PYTHON, RUNNABLE_TYPESCRIPT);
  // The example is the prompt's last line: a TypeScript skill instead of the Python one.
  const example = prompt.indexOf(EXAMPLE_PYTHON);
  if (example === -1) throw new Error("The drafting prompt changed: its example is not where it was.");
  return `${prompt.slice(0, example)}{"skills": [${EXAMPLE_TYPESCRIPT_SKILL}]}`;
}

export const RUNNABLE_PYTHON =
  "- runnable: true when a short task can practise it offline with plain Python and the course's packages: no network, no API keys, no GPU, no Docker. LangChain's fake chat models count as offline. False when it only makes sense against a live service, or isn't about Python at all (shell, cloud consoles, Kubernetes, incident response, interview answers): then it gets questions and explanations.";
export const RUNNABLE_TYPESCRIPT =
  "- runnable: true when a short task can practise it in ONE TypeScript file that tsc checks in strict mode and Node.js runs, with Node's built-in modules only (node:fs, node:path, node:assert…): no npm packages (no Express, NestJS, TypeORM, Zod or Vitest), no network, no database, no Docker. Skills about types count: a task's tests can check what a value is at run time and also that a wrong use does NOT compile. False when it needs a package, a server, a database, the shell, a tsconfig file, an editor or a version manager, or isn't about code (choosing a tool, reading an error out loud): then it gets questions and explanations.";
const EXAMPLE_PYTHON = `{"skills": [{"key": "dotenv-load-env-file"`;
const EXAMPLE_TYPESCRIPT_SKILL = `{"key": "narrow-union-with-typeof", "labelEn": "Narrow a union with typeof", "labelEs": "Estrechar una unión con typeof", "descriptionEn": "Checks typeof before using a string | number value, so each branch only uses what that type allows.", "descriptionEs": "Comprueba typeof antes de usar un valor string | number, de modo que cada rama solo usa lo que ese tipo permite.", "knowledge": "procedural", "runnable": true, "criteriaHint": "Branches on typeof and uses a type-specific method in each branch with no cast; not just a union annotation.", "prerequisites": [{"key": "read-union-types", "strength": "hard", "reason": "Narrowing only makes sense once the union is read."}]}`;

const DraftSchema = z.object({
  skills: z
    .array(
      z.object({
        key: z.string(),
        labelEn: z.string().min(1),
        labelEs: z.string().min(1),
        descriptionEn: z.string().min(1),
        descriptionEs: z.string().min(1),
        knowledge: z.enum(["declarative", "procedural"]),
        runnable: z.boolean(),
        criteriaHint: z.string().optional(),
        prerequisites: z.array(z.object({ key: z.string(), strength: z.enum(["hard", "soft"]), reason: z.string().optional() })).default([]),
      }),
    )
    .min(1),
});
export type SkillDraft = z.infer<typeof DraftSchema>["skills"][number];

export const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    skills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING },
          labelEn: { type: Type.STRING },
          labelEs: { type: Type.STRING },
          descriptionEn: { type: Type.STRING },
          descriptionEs: { type: Type.STRING },
          knowledge: { type: Type.STRING, enum: ["declarative", "procedural"] },
          runnable: { type: Type.BOOLEAN },
          criteriaHint: { type: Type.STRING },
          prerequisites: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { key: { type: Type.STRING }, strength: { type: Type.STRING, enum: ["hard", "soft"] }, reason: { type: Type.STRING } },
              required: ["key", "strength"],
              propertyOrdering: ["key", "strength", "reason"],
            },
          },
        },
        required: ["key", "labelEn", "labelEs", "descriptionEn", "descriptionEs", "knowledge", "runnable", "prerequisites"],
        propertyOrdering: ["key", "labelEn", "labelEs", "descriptionEn", "descriptionEs", "knowledge", "runnable", "criteriaHint", "prerequisites"],
      },
    },
  },
  required: ["skills"],
};

const SOURCE_LIMIT = 30_000;
/**
 * An interview-challenge lesson (lib/lesson-sections.ts): the problem, the reference solution with how the tests check
 * it, and the model answers to the follow-up questions, without the setup. Their budgets add up to 34,000, past
 * SOURCE_LIMIT: at 30,000 the end of 30.01's model answers would be cut (30,262 characters whole).
 */
const CHALLENGE = { order: ["brief", "reference", "modelAnswers"] as readonly ChallengePart[], limit: 35_000 };

/** A key the graph accepts: lowercase kebab-case. */
export function normaliseKey(key: string): string {
  return key
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type DraftResult =
  | { ok: true; skills: number; edges: number; dropped: string[]; model: string }
  | { ok: false; error: string };

/**
 * Drafts one lesson's skills and saves them as DRAFTED. A skill whose key the lesson already had is updated in place
 * (its id, and the prerequisites later lessons drew to it, are kept); skills the new draft no longer has are removed.
 */
export async function draftLesson(lessonId: string, userId: string, model?: string, budgetMs = REQUEST_BUDGET_MS): Promise<DraftResult> {
  // The whole draft, models and fallbacks included, ends inside one Amplify request (lib/request-budget.ts); the
  // practice worker (no request limit) gives it longer.
  const deadline = Date.now() + budgetMs;
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      code: true,
      title: true,
      kind: true,
      position: true,
      objectives: true,
      prerequisites: true,
      body: true,
      sourcePath: true,
      module: {
        select: {
          position: true,
          title: true,
          course: {
            select: {
              id: true,
              title: true,
              practiceLanguage: true,
              sourceRepoUrl: true,
              sourceRef: true,
              modules: { orderBy: { position: "asc" }, select: { position: true, title: true } },
            },
          },
        },
      },
    },
  });
  if (!lesson) return { ok: false, error: "Lesson not found." };
  const course = lesson.module.course;

  // Skills of earlier lessons, in course order: the ones this lesson may build on.
  const allSkills = await prisma.practiceSkill.findMany({
    where: { courseId: course.id },
    select: { id: true, key: true, labelEn: true, lessonId: true, lesson: { select: { code: true, position: true, module: { select: { position: true } } } } },
  });
  const isEarlier = (other: { position: number; module: { position: number } }) =>
    other.module.position < lesson.module.position || (other.module.position === lesson.module.position && other.position < lesson.position);
  const earlier = allSkills.filter((skill) => skill.lessonId !== lesson.id && isEarlier(skill.lesson));

  const text = await lessonTextFor(course, lesson, SOURCE_LIMIT, CHALLENGE);
  const context = [
    `# Course: ${course.title}\n${course.modules.map((m) => `- Module ${String(m.position).padStart(2, "0")}: ${m.title}`).join("\n")}`,
    `# Lesson ${lesson.code ?? ""}: ${lesson.title} (module ${String(lesson.module.position).padStart(2, "0")}: ${lesson.module.title})`,
    `Learning objectives:\n${lesson.objectives.map((objective, index) => `${index + 1}. ${objective}`).join("\n") || "(none listed)"}`,
    `Prerequisites as the lesson states them: ${lesson.prerequisites ?? "(none listed)"}`,
    `# EXISTING SKILLS (earlier lessons; key — label (lesson))\n${earlier.map((skill) => `- ${skill.key} — ${skill.labelEn} (${skill.lesson.code ?? ""})`).join("\n") || "(none yet)"}`,
    text ? `# The lesson itself\n${text}` : "# The lesson itself\n(not available: work from the objectives)",
  ].join("\n\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: context }, { text: "Propose this lesson's skills as the JSON object." }] }];

  const chosen = isAuthoringModel(model) ? model : undefined;
  const result = await generateWithFallback({
    feature: "graph",
    pool: "AUTHORING",
    userId,
    models: authoringChain(chosen),
    chosenFirst: Boolean(chosen),
    deadline,
    contents,
    config: {
      systemInstruction: draftPrompt(practiceLanguage(course.practiceLanguage)),
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel },
      maxOutputTokens: 8192,
    },
  });
  if (!result.ok) {
    return { ok: false, error: result.reason === "quota" ? `Today's authoring allowance is used up; it resets at ${result.retryAt.toISOString()}.` : "No model could draft this lesson. Try again in a minute." };
  }

  let draft: SkillDraft[];
  try {
    draft = DraftSchema.parse(JSON.parse(result.text)).skills;
  } catch {
    return { ok: false, error: `${result.model} answered, but not with the skills JSON. Try again or choose another model.` };
  }

  // Keys: normalised, unique in the course. A key an earlier lesson already uses means a repeated skill: dropped.
  const dropped: string[] = [];
  const takenElsewhere = new Set(allSkills.filter((skill) => skill.lessonId !== lesson.id).map((skill) => skill.key));
  const earlierKeys = new Map(earlier.map((skill) => [skill.key, skill.id]));
  const skills: (SkillDraft & { key: string })[] = [];
  for (const skill of draft.slice(0, 8)) {
    const key = normaliseKey(skill.key);
    if (!key) continue;
    if (takenElsewhere.has(key) || skills.some((other) => other.key === key)) {
      dropped.push(`${key} (already in the graph)`);
      continue;
    }
    skills.push({ ...skill, key });
  }
  if (!skills.length) return { ok: false, error: "Every proposed skill is already in the graph. Edit the lesson by hand." };

  const saved = await prisma.$transaction(async (tx) => {
    const keep = new Set(skills.map((skill) => skill.key));
    await tx.practiceSkill.deleteMany({ where: { lessonId: lesson.id, key: { notIn: [...keep] } } });
    const ids = new Map<string, string>();
    for (const [position, skill] of skills.entries()) {
      const data = {
        labelEn: skill.labelEn.trim(),
        labelEs: skill.labelEs.trim(),
        descriptionEn: skill.descriptionEn.trim(),
        descriptionEs: skill.descriptionEs.trim(),
        knowledge: skill.knowledge === "procedural" ? ("PROCEDURAL" as const) : ("DECLARATIVE" as const),
        runnable: skill.runnable,
        criteriaHint: skill.criteriaHint?.trim() || null,
        position,
      };
      const row = await tx.practiceSkill.upsert({
        where: { courseId_key: { courseId: course.id, key: skill.key } },
        create: { courseId: course.id, lessonId: lesson.id, key: skill.key, ...data },
        update: data,
        select: { id: true },
      });
      ids.set(skill.key, row.id);
    }
    // This lesson's own prerequisites are redrawn; edges later lessons drew to its skills stay.
    await tx.practiceSkillEdge.deleteMany({ where: { toId: { in: [...ids.values()] } } });
    let edges = 0;
    for (const [index, skill] of skills.entries()) {
      const ownEarlier = new Map(skills.slice(0, index).map((other) => [other.key, ids.get(other.key)!]));
      for (const prerequisite of skill.prerequisites.slice(0, 3)) {
        const key = normaliseKey(prerequisite.key);
        const fromId = earlierKeys.get(key) ?? ownEarlier.get(key);
        if (!fromId) {
          dropped.push(`${skill.key} ← ${key} (no such earlier skill)`);
          continue;
        }
        await tx.practiceSkillEdge.upsert({
          where: { fromId_toId: { fromId, toId: ids.get(skill.key)! } },
          create: { fromId, toId: ids.get(skill.key)!, strength: prerequisite.strength === "hard" ? "HARD" : "SOFT", reason: prerequisite.reason?.trim() || null },
          update: { strength: prerequisite.strength === "hard" ? "HARD" : "SOFT", reason: prerequisite.reason?.trim() || null },
        });
        edges += 1;
      }
    }
    await tx.practiceLessonDraft.upsert({
      where: { lessonId: lesson.id },
      create: { lessonId: lesson.id, model: result.model, traceId: result.traceId },
      update: { status: "DRAFTED", model: result.model, traceId: result.traceId, draftedAt: new Date(), approvedAt: null, approvedById: null },
    });
    return { skills: skills.length, edges };
  });
  return { ok: true, ...saved, dropped, model: result.model };
}
