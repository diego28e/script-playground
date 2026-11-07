import { createHash, randomUUID } from "node:crypto";
import { Type, type Schema, type ThinkingLevel } from "@google/genai";
import { admitCandidate, validateItems, type CandidateItem, type CandidateProof, type PracticeItem, type SkillNode } from "@intellectif/lk-practice";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AUTHORING_CHAIN, chainStartingAt, generateWithFallback } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { practice } from "@/lib/practice/config";
import type { PublishedGraph } from "@/lib/practice/graph";
import { gradeCode } from "@/lib/practice/grader";

// Practice tasks (docs/practice.md, "Tasks"): a model writes one task for one skill at one stage; the platform proves it
// (code runs on the grader: the reference passes and wrong code fails; a question is answered blind by a second
// model, from another provider, which must agree with the key); lk-practice admits it as a proven item; it joins the
// skill's pool. One task per call, so a call fits inside one Amplify request (about 30 s).

export const FORMS = ["choice", "fill", "predict", "code", "debug"] as const;
export type TaskForm = (typeof FORMS)[number];

// The task-writing model, unless the admin picks another: fast, and good at Python and tests.
export const DEFAULT_TASK_MODEL = "claude-sonnet-5-5";

/** What each stage of the two ladders asks of the learner. */
const STAGES: Record<string, string> = {
  recognise: "RECOGNISE: tell the correct statement, term or behaviour apart from plausible wrong ones.",
  recall: "RECALL: produce a fact, name, parameter or value from memory, with no options to pick from.",
  produce: "PRODUCE: use the idea in a very small, guided case: predict what short code does, or write a few lines.",
  apply: "APPLY: use the idea to solve a small realistic problem, without being told how.",
  example: "EXAMPLE: study a short worked example and show you understand it, usually by predicting what it prints.",
  complete: "COMPLETE: finish partly written code (one missing piece), or fix one small mistake in it.",
  write: "WRITE: write the code from a short description.",
  transfer: "TRANSFER: apply the skill in a new context, different from the lesson's, without hints.",
};

const FORM_RULES: Record<TaskForm, string> = {
  choice:
    "choice: a question with exactly 4 options and one correct answer. Distractors come from real misconceptions, are about as long as the answer, and are clearly wrong to someone who has the skill. Fill options (es and en, same order) and answerIndex (0-based). No 'all/none of the above'.",
  fill:
    "fill: the prompt shows exactly one blank written as ____ (in a sentence or in a code block). answers lists 1 to 4 accepted answers, each short (a word, a name, a value or a tiny expression); comparison ignores case, spaces at the ends and surrounding backticks or quotes.",
  predict:
    "predict: code is a Python snippet of at most 20 lines that prints something deterministic (no randomness, time, network, set or dict-order tricks, object ids). expectedOutput is exactly what it prints; wrongOutput is the most likely wrong prediction. The prompt asks what it prints and shows nothing of the output.",
  code:
    "code: code is the starter the learner edits (imports, a function signature with a docstring, and `raise NotImplementedError`). tests holds 2 to 5 functions named test_* that use plain assert with a short English message, are deterministic, print nothing and run in under 5 seconds. solution is a correct full replacement of the starter; wrongSolution is a plausible wrong one (a typical mistake) that fails at least one test. recipeEs and recipeEn are the same 3 to 7 steps (one string each, in the same order in both languages) a learner can follow to write the solution themselves, like a teacher's recipe: what to compute, in what order, and what to call each result. Plain words only: no code, no function calls, no operators or expressions; a step may name a variable, parameter or function in backticks (`max_budget`), never show how to write it. Precise enough to follow, leaving every bit of Python to the learner.",
  debug:
    "debug: code is a short program (at most 25 lines) with exactly one realistic bug. tests holds 2 to 5 functions named test_* (plain assert, short English message) that fail on the bug and pass when it is fixed. solution is the fixed program. The prompt says what the code should do and that it has a bug, without saying where.",
};

export const SYSTEM_PROMPT = `You write practice tasks for a programming course (Python, LangChain, LangGraph), for spaced practice after each lesson. Learners practise on a web page: they answer questions there and their code runs in a sandbox with Python 3.12 and the course's packages (langchain, langchain-core, langgraph and their usual dependencies), with NO network and NO API keys.

Write ONE task, for the skill and stage given, in the form given.

RULES
- The task practises exactly this skill at this stage, and is answerable by someone who has the skill in 1 to 5 minutes. It doesn't need the lesson's text open.
- Never require the network, an API key, a real model, a GPU or files outside /tmp. Where a chat model is needed in code, use LangChain's fake models (from langchain_core.language_models.fake_chat_models import FakeListChatModel, GenericFakeChatModel).
- Code is valid Python 3.12, deterministic, and uses English names. Text fields come in Spanish (Es) and English (En), saying the same thing; keep code, API names and identifiers in English in both. Write prompts in Markdown; put code in fenced blocks.
- explanationEs/En: 2 to 4 sentences the learner reads after answering: why the answer is right, and the misconception behind the likely wrong one.
- difficulty: your estimate for this stage, from -1 (easy for it) to 1 (hard for it); 0 is typical.
- expectedSeconds: how long someone with the skill needs: about 30 for choice, 45 for fill, 60 for predict, 120 to 240 for code and debug.
- Leave fields that don't belong to the form out.
- Don't repeat the tasks listed under EXISTING TASKS; vary the situation, not just the names.

FORMS
${FORMS.map((form) => `- ${FORM_RULES[form]}`).join("\n")}

Answer with one JSON object, for example (the content is only an illustration):
{"form": "predict", "difficulty": 0, "expectedSeconds": 60, "promptEs": "¿Qué imprime este código?\\n\\n\`\`\`python\\nprint(sorted([3, 1, 2])[0])\\n\`\`\`", "promptEn": "What does this code print?\\n\\n\`\`\`python\\nprint(sorted([3, 1, 2])[0])\\n\`\`\`", "code": "print(sorted([3, 1, 2])[0])", "expectedOutput": "1", "wrongOutput": "3", "explanationEs": "…", "explanationEn": "…"}`;

const TaskSchema = z.object({
  form: z.enum(FORMS),
  difficulty: z.number().min(-3).max(3),
  expectedSeconds: z.number().int().min(10).max(900),
  promptEs: z.string().min(10),
  promptEn: z.string().min(10),
  explanationEs: z.string().min(10),
  explanationEn: z.string().min(10),
  optionsEs: z.array(z.string().min(1)).optional(),
  optionsEn: z.array(z.string().min(1)).optional(),
  answerIndex: z.number().int().optional(),
  answers: z.array(z.string().min(1)).optional(),
  code: z.string().optional(),
  expectedOutput: z.string().optional(),
  wrongOutput: z.string().optional(),
  tests: z.string().optional(),
  solution: z.string().optional(),
  wrongSolution: z.string().optional(),
  // Code tasks: the steps to the solution in plain words (docs/practice.md, "Recipes").
  recipeEs: z.array(z.string().min(1)).optional(),
  recipeEn: z.array(z.string().min(1)).optional(),
});
export type TaskContent = z.infer<typeof TaskSchema>;

export const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    form: { type: Type.STRING, enum: [...FORMS] },
    difficulty: { type: Type.NUMBER },
    expectedSeconds: { type: Type.INTEGER },
    promptEs: { type: Type.STRING },
    promptEn: { type: Type.STRING },
    optionsEs: { type: Type.ARRAY, items: { type: Type.STRING } },
    optionsEn: { type: Type.ARRAY, items: { type: Type.STRING } },
    answerIndex: { type: Type.INTEGER },
    answers: { type: Type.ARRAY, items: { type: Type.STRING } },
    code: { type: Type.STRING },
    expectedOutput: { type: Type.STRING },
    wrongOutput: { type: Type.STRING },
    tests: { type: Type.STRING },
    solution: { type: Type.STRING },
    wrongSolution: { type: Type.STRING },
    recipeEs: { type: Type.ARRAY, items: { type: Type.STRING } },
    recipeEn: { type: Type.ARRAY, items: { type: Type.STRING } },
    explanationEs: { type: Type.STRING },
    explanationEn: { type: Type.STRING },
  },
  required: ["form", "difficulty", "expectedSeconds", "promptEs", "promptEn", "explanationEs", "explanationEn"],
  propertyOrdering: [
    "form",
    "difficulty",
    "expectedSeconds",
    "promptEs",
    "promptEn",
    "optionsEs",
    "optionsEn",
    "answerIndex",
    "answers",
    "code",
    "expectedOutput",
    "wrongOutput",
    "tests",
    "solution",
    "wrongSolution",
    "recipeEs",
    "recipeEn",
    "explanationEs",
    "explanationEn",
  ],
};

/** The fields of each form, beside the ones every task has. */
const FORM_FIELDS: Record<TaskForm, (keyof TaskContent)[]> = {
  choice: ["optionsEs", "optionsEn", "answerIndex"],
  fill: ["answers"],
  predict: ["code", "expectedOutput", "wrongOutput"],
  code: ["code", "tests", "solution", "wrongSolution", "recipeEs", "recipeEn"],
  debug: ["code", "tests", "solution"],
};

/**
 * The response schema for one form: only its fields, all required. The form is chosen before the model is asked, and a
 * schema of every form's fields, mostly optional, is more than Claude's structured outputs take ("Schema is too
 * complex", once code tasks gained their recipe).
 */
export function schemaFor(form: TaskForm): Schema {
  const keep = new Set<string>(["form", "difficulty", "expectedSeconds", "promptEs", "promptEn", ...FORM_FIELDS[form], "explanationEs", "explanationEn"]);
  const properties = Object.fromEntries(Object.entries(RESPONSE_SCHEMA.properties ?? {}).filter(([key]) => keep.has(key)));
  properties.form = { type: Type.STRING, enum: [form] };
  const ordering = (RESPONSE_SCHEMA.propertyOrdering ?? []).filter((key) => keep.has(key));
  return { type: Type.OBJECT, properties, required: ordering, propertyOrdering: ordering };
}

/** The fields each form needs, and its shape rules. Null when the task is complete. */
function shapeProblem(task: TaskContent): string | null {
  const need = (fields: (keyof TaskContent)[]) => fields.find((field) => task[field] === undefined || task[field] === "");
  switch (task.form) {
    case "choice": {
      const missing = need(["optionsEs", "optionsEn", "answerIndex"]);
      if (missing) return `choice without ${missing}`;
      if (task.optionsEs!.length !== 4 || task.optionsEn!.length !== 4) return "choice needs exactly 4 options in each language";
      if (task.answerIndex! < 0 || task.answerIndex! > 3) return "answerIndex out of range";
      return null;
    }
    case "fill": {
      const missing = need(["answers"]);
      if (missing) return `fill without ${missing}`;
      if (!task.promptEn.includes("____") || !task.promptEs.includes("____")) return "fill prompt without a ____ blank";
      return null;
    }
    case "predict":
      return need(["code", "expectedOutput", "wrongOutput"]) ? "predict without code, expectedOutput or wrongOutput" : null;
    case "code":
      if (need(["code", "tests", "solution", "wrongSolution"])) return "code without code, tests, solution or wrongSolution";
      return recipeProblem(task);
    case "debug":
      return need(["code", "tests", "solution"]) ? "debug without code, tests or solution" : null;
  }
}

/**
 * A code task's recipe (docs/practice.md, "Recipes"): 3 to 7 steps, the same number in both languages, each a short
 * plain sentence. It may name things in backticks (a variable, a parameter, a function) but never show code: no code
 * block, no backticked call, operator or expression, and no line of the solution.
 */
export function recipeProblem(task: Pick<TaskContent, "recipeEs" | "recipeEn" | "solution">): string | null {
  const es = task.recipeEs ?? [];
  const en = task.recipeEn ?? [];
  if (!es.length || !en.length) return "code without a recipe (recipeEs and recipeEn)";
  if (es.length !== en.length) return "the recipe has a different number of steps in Spanish and English";
  if (en.length < 3 || en.length > 7) return "the recipe needs 3 to 7 steps";
  const solutionLines = (task.solution ?? "")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line.length >= 12 && !/^(#|def |"""|'''|from |import )/.test(line));
  for (const step of [...es, ...en]) {
    if (step.length > 280) return "a recipe step is longer than 280 characters";
    if (step.includes("```")) return "a recipe step holds a code block";
    for (const span of step.match(/`[^`]*`/g) ?? []) {
      // A name (`max_budget`), a short quoted value the task asks for (`'buffer'`), or a number: not code.
      if (!/^`([A-Za-z_][\w.]*|(['"])[^'"`]{0,30}\2|-?\d+(\.\d+)?)`$/.test(span)) return `a recipe step shows code (${span.slice(0, 40)})`;
    }
    const flat = step.replace(/\s+/g, " ");
    if (solutionLines.some((line) => flat.includes(line))) return "a recipe step repeats a line of the solution";
  }
  return null;
}

/** Printed output compared line by line, ignoring trailing spaces and blank lines at the end. */
export const sameOutput = (a: string, b: string) => {
  const tidy = (text: string) => text.replace(/\r/g, "").split("\n").map((line) => line.trimEnd()).join("\n").trimEnd();
  return tidy(a) === tidy(b);
};

/** A fill answer as compared: no surrounding spaces, backticks or quotes; spaces collapsed; case ignored. */
export const normaliseAnswer = (text: string) =>
  text
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

type Proof = { ok: true; proof: CandidateProof; note: string } | { ok: false; reason: string };

/** Code tasks: the starter or buggy code fails the tests, the solution passes, wrong code fails. */
async function proveByRunning(task: TaskContent): Promise<Proof> {
  if (task.form === "predict") {
    const run = await gradeCode({ code: task.code! });
    if (run.status === "unavailable") return { ok: false, reason: `grader unavailable: ${run.message}` };
    if (run.status !== "passed") return { ok: false, reason: `the snippet didn't run cleanly (${run.status}${run.error ? `: ${run.error.message.split("\n").at(-1)}` : ""})` };
    if (!sameOutput(run.stdout, task.expectedOutput!)) return { ok: false, reason: `the snippet prints ${JSON.stringify(run.stdout.slice(0, 200))}, not the key ${JSON.stringify(task.expectedOutput!.slice(0, 200))}` };
    if (sameOutput(run.stdout, task.wrongOutput!)) return { ok: false, reason: "the wrong prediction equals the real output" };
    return { ok: true, proof: { kind: "executable", at: Date.now(), referencePassed: true, wrongSolutionsFailed: 1, runner: "academia-grader" }, note: `printed the key in ${run.wallMs} ms` };
  }
  const wrongs = task.form === "code" ? [task.code!, task.wrongSolution!] : [task.code!];
  const [reference, ...others] = await Promise.all([task.solution!, ...wrongs].map((code) => gradeCode({ code, tests: task.tests! })));
  if (reference.status === "unavailable") return { ok: false, reason: `grader unavailable: ${reference.message}` };
  if (reference.status !== "passed") {
    const failed = reference.tests.filter((test) => !test.passed).map((test) => `${test.name}: ${test.message}`)[0] ?? reference.error?.message.split("\n").at(-1) ?? reference.status;
    return { ok: false, reason: `the reference solution doesn't pass (${failed})` };
  }
  if (reference.tests.length < 2) return { ok: false, reason: "fewer than 2 tests ran" };
  const caught = others.filter((run) => run.status !== "unavailable" && run.status !== "passed").length;
  if (caught < others.length) return { ok: false, reason: task.form === "debug" ? "the buggy code passes the tests" : "the starter or the wrong solution passes the tests" };
  return { ok: true, proof: { kind: "executable", at: Date.now(), referencePassed: true, wrongSolutionsFailed: caught, runner: "academia-grader" }, note: `reference passed ${reference.tests.length} tests; ${caught} wrong version(s) failed` };
}

const CheckSchema: Schema = {
  type: Type.OBJECT,
  properties: { answerIndex: { type: Type.INTEGER }, answer: { type: Type.STRING } },
};

/** Questions: a model from another provider answers blind; its answer must match the key. */
async function proveByModel(task: TaskContent, writer: string, userId: string, deadline: number): Promise<Proof> {
  const checker = writer.startsWith("claude") ? "deepseek-flash" : "claude-sonnet-5-5";
  const question =
    task.form === "choice"
      ? `${task.promptEn}\n\nOptions:\n${task.optionsEn!.map((option, index) => `${index}. ${option}`).join("\n")}\n\nAnswer with JSON: {"answerIndex": <the number of the correct option>}.`
      : `${task.promptEn}\n\nWhat goes in the blank (____)? Answer with JSON: {"answer": "<only the text that fills the blank>"}.`;
  const result = await generateWithFallback({
    feature: "graph",
    pool: "AUTHORING",
    userId,
    models: chainStartingAt(AUTHORING_CHAIN, checker).filter((entry) => entry.model !== writer),
    chosenFirst: true,
    deadline,
    contents: [{ role: "user", parts: [{ text: question }] }],
    config: {
      systemInstruction: "You answer a practice question about Python, LangChain and LangGraph as an expert would. Reply with the JSON object only.",
      responseMimeType: "application/json",
      responseSchema: CheckSchema,
      thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel },
      maxOutputTokens: 2048,
    },
  });
  if (!result.ok) return { ok: false, reason: "no second model could check the key" };
  let reply: { answerIndex?: number; answer?: string };
  try {
    reply = JSON.parse(result.text);
  } catch {
    return { ok: false, reason: "the checking model didn't answer in JSON" };
  }
  const agreed =
    task.form === "choice"
      ? reply.answerIndex === task.answerIndex
      : typeof reply.answer === "string" && task.answers!.map(normaliseAnswer).includes(normaliseAnswer(reply.answer));
  if (!agreed) return { ok: false, reason: `${result.model} answered ${JSON.stringify(reply.answerIndex ?? reply.answer)}, not the key` };
  return { ok: true, proof: { kind: "model-checked", at: Date.now(), model: result.model, agreed: true }, note: `${result.model} agreed` };
}

/**
 * The writing model rates a task from -1 (easy for its stage) to 1 (hard); 0 is typical. lk-practice's difficulty is in
 * logits against the learner's ability (a newcomer's is 0), and its planner aims tasks at 85% expected success, which
 * is -1.73 for a newcomer. So a typical task maps to -1.73, and -1..1 to about 93% .. 72% expected success.
 */
export function toItemDifficulty(rated: number): number {
  const clamped = Math.min(Math.max(rated, -1.5), 1.5);
  return Math.round((clamped * 0.8 - 1.73) * 100) / 100;
}

/** A newcomer's chance of getting a task right, from its lk-practice difficulty (shown on the admin page). */
export const expectedSuccess = (difficulty: number) => 1 / (1 + Math.exp(difficulty));

export type GenerateResult =
  | { ok: true; taskId: string; form: TaskForm; model: string; note: string }
  | { ok: false; error: string; taskId?: string; form?: TaskForm; model?: string };

/** The skill a task practises: its node (published, or a skill a diagnosis found), its lesson, and a graph to check items with. */
async function skillFor(courseId: string, skillKey: string) {
  const version = await prisma.skillGraphVersion.findFirst({ where: { courseId }, orderBy: { version: "desc" }, select: { graph: true } });
  if (!version) return { error: "Publish a version of the skill graph first: tasks are written for published skills." } as const;
  const published = version.graph as unknown as PublishedGraph;
  let node: SkillNode | undefined = published.graph.skills.find((skill) => skill.id === skillKey);
  let meta: { lessonId: string } | undefined = published.skills[skillKey];
  // A skill a diagnosis found, which the course doesn't teach (docs/practice.md, "Missing prerequisites").
  let found: { forLabel: string; tutor: boolean; context: string | null } | null = null;
  if (!node || !meta) {
    const row = await prisma.practiceFoundSkill.findUnique({ where: { courseId_key: { courseId, key: skillKey } } });
    if (row) {
      node = row.node as unknown as SkillNode;
      meta = { lessonId: row.lessonId };
      const edge = await prisma.practiceDiscoveredEdge.findFirst({ where: { courseId, fromKey: row.key }, orderBy: { createdAt: "asc" }, select: { toKey: true } });
      found = {
        forLabel: (edge && published.graph.skills.find((skill) => skill.id === edge.toKey)?.label) ?? "a later skill",
        tutor: row.origin === "TUTOR",
        context: row.context,
      };
    }
  }
  if (!node || !meta) return { error: "This skill isn't in the published graph yet: approve its lesson and publish." } as const;
  // Items are checked against a graph that has the skill: a found one joins the published graph for the check.
  const checkGraph = found ? { ...published.graph, skills: [...published.graph.skills, node] } : published.graph;
  return { node, meta, found, checkGraph } as const;
}

/** What a model is told about the skill, stage and form, before it writes or edits a task. */
async function taskContext(skill: Exclude<Awaited<ReturnType<typeof skillFor>>, { error: string }>, stage: string, form: TaskForm) {
  const { node, meta, found } = skill;
  const lesson = await prisma.lesson.findUnique({ where: { id: meta.lessonId }, select: { code: true, title: true, objectives: true } });
  const ladder = Object.keys(node.forms ?? {});
  return [
    `# Skill: ${node.label} (key ${node.id})\n${node.description ?? ""}\nKind: ${node.knowledge}. Ladder: ${ladder.join(" → ")}.${node.criteriaHint ? `\nWhat shows the skill: ${node.criteriaHint}` : ""}`,
    `# Stage: ${stage}\n${STAGES[stage] ?? stage}`,
    `# Form: ${form}\n${FORM_RULES[form]}`,
    found?.tutor
      ? `# A skill a learner asked their tutor to practise\nIt came up while working on "${found.forLabel}" (a detour, or the learner asking for more practice). The tutor's challenge looked like this: ${found.context ?? "(not kept)"}\nWrite the task in the same spirit: a small realistic scenario (calling AI models, rate limits, costs, tokens, audio, data) with concrete numbers, where this skill is the heart of the solution. Plain Python; the course's libraries only if the skill is about them.`
      : found
        ? `# Background skill\nThe course doesn't teach this skill: it's a prerequisite found because a learner kept failing "${found.forLabel}". Practise the basic idea itself, in plain Python where possible, without the course's libraries unless the skill is about them.`
        : "",
    lesson ? `# ${found ? "Where the learner met the gap: lesson" : "From lesson"} ${lesson.code ?? ""}: ${lesson.title}\nObjectives:\n${lesson.objectives.map((objective) => `- ${objective}`).join("\n")}` : "",
  ].filter(Boolean);
}

/**
 * Proves a task (code on the grader, a question by a second model) and stores it: PROVEN with lk-practice's item when
 * it passes; when it fails, REJECTED with the reason if `keepRejected`, otherwise not at all.
 */
async function proveAndStore(input: {
  courseId: string;
  skillKey: string;
  stage: string;
  form: TaskForm;
  task: TaskContent;
  model: string;
  traceId?: string;
  userId: string;
  deadline: number;
  checkGraph: PublishedGraph["graph"];
  keepRejected: boolean;
  editedFromId?: string;
}): Promise<GenerateResult> {
  const { task, form } = input;
  const shape = shapeProblem(task);
  const proof: Proof = shape
    ? { ok: false, reason: shape }
    : form === "choice" || form === "fill"
      ? await proveByModel(task, input.model, input.userId, input.deadline)
      : await proveByRunning(task);

  const taskId = randomUUID();
  const contentHash = createHash("sha256").update(JSON.stringify([form, task.promptEn, task.code ?? "", task.optionsEn ?? []])).digest("hex");
  const expectedSeconds = Math.round(Math.min(Math.max(task.expectedSeconds, 15), 600));
  const difficulty = toItemDifficulty(task.difficulty);

  let item: PracticeItem | null = null;
  let reason = proof.ok ? null : proof.reason;
  if (proof.ok) {
    const candidate: CandidateItem = {
      id: `task:${taskId}`,
      skills: [{ skillId: input.skillKey, weight: 1 }],
      stage: input.stage,
      difficulty,
      expectedSeconds,
      fluentSeconds: Math.round(expectedSeconds * 0.5),
      slowSeconds: Math.round(expectedSeconds * 1.5),
      form,
      contentHash,
      origin: "generated",
      status: "unproven",
      content: null,
    };
    const admitted = admitCandidate(candidate, proof.proof, practice.config);
    if (!admitted.ok) reason = `lk-practice refused it: ${admitted.issues.map((issue) => issue.code).join(", ")}`;
    else {
      const valid = validateItems([admitted.item], input.checkGraph, practice.config);
      if (!valid.ok) reason = `lk-practice refused it: ${valid.issues.map((issue) => issue.code).join(", ")}`;
      else item = admitted.item;
    }
  }
  if (!item && !input.keepRejected) return { ok: false, form, model: input.model, error: `It didn't pass its proof: ${reason}` };

  try {
    await prisma.practiceTask.create({
      data: {
        id: taskId,
        courseId: input.courseId,
        skillKey: input.skillKey,
        stage: input.stage,
        form,
        difficulty,
        expectedSeconds,
        content: task as unknown as Prisma.InputJsonObject,
        item: item ? (item as unknown as Prisma.InputJsonObject) : undefined,
        status: item ? "PROVEN" : "REJECTED",
        rejectReason: reason,
        model: input.model,
        traceId: input.traceId,
        contentHash,
        editedFromId: input.editedFromId,
      },
    });
  } catch {
    return { ok: false, form, model: input.model, error: input.editedFromId ? "Nothing changed: the pool already has this exact task." : "The model repeated a task the pool already has." };
  }
  if (!item) return { ok: false, taskId, form, model: input.model, error: `Rejected: ${reason}` };
  return { ok: true, taskId, form, model: input.model, note: proof.ok ? proof.note : "" };
}

/**
 * Writes, proves and stores one task for `skillKey` at `stage`, in `form` (or the form the pool has least of). A task
 * that fails its proof is stored as REJECTED with the reason. Everything ends by `deadline` (epoch ms).
 */
export async function generateTask(input: {
  courseId: string;
  skillKey: string;
  stage: string;
  form?: TaskForm;
  model?: string;
  userId: string;
  deadline: number;
}): Promise<GenerateResult> {
  const skill = await skillFor(input.courseId, input.skillKey);
  if ("error" in skill) return { ok: false, error: skill.error ?? "This skill isn't published yet." };
  const forms = (skill.node.forms?.[input.stage] ?? []) as TaskForm[];
  if (!forms.length) return { ok: false, error: `The skill has no stage "${input.stage}".` };

  const existing = await prisma.practiceTask.findMany({
    where: { courseId: input.courseId, skillKey: input.skillKey, stage: input.stage, status: "PROVEN" },
    select: { form: true, content: true },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  // The form this stage's pool has least of, unless one was asked for.
  const form = input.form && forms.includes(input.form) ? input.form : [...forms].sort((a, b) => existing.filter((task) => task.form === a).length - existing.filter((task) => task.form === b).length)[0];
  const context = [
    ...(await taskContext(skill, input.stage, form)),
    `# EXISTING TASKS (don't repeat)\n${existing.map((task) => `- (${task.form}) ${String((task.content as TaskContent).promptEn).replace(/\s+/g, " ").slice(0, 160)}`).join("\n") || "(none yet)"}`,
  ].join("\n\n");

  const chosen = AUTHORING_CHAIN.some((entry) => entry.model === input.model) ? input.model! : DEFAULT_TASK_MODEL;
  // Leave room for the proof: running code or asking a second model takes a few seconds.
  const writeDeadline = input.deadline - (form === "choice" || form === "fill" ? 9_000 : 6_000);
  const written = await generateWithFallback({
    feature: "graph",
    pool: "AUTHORING",
    userId: input.userId,
    models: chainStartingAt(AUTHORING_CHAIN, chosen),
    chosenFirst: true,
    deadline: writeDeadline,
    contents: [{ role: "user", parts: [{ text: context }, { text: `Write the ${form} task as the JSON object.` }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: schemaFor(form),
      thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel },
      maxOutputTokens: 8192,
    },
  });
  if (!written.ok) return { ok: false, form, error: written.reason === "quota" ? "Today's authoring allowance is used up." : "No model could write the task in time. Try again." };

  let task: TaskContent;
  try {
    task = TaskSchema.parse(JSON.parse(written.text));
  } catch {
    return { ok: false, form, model: written.model, error: `${written.model} didn't answer with a valid task.` };
  }
  task = { ...task, form };
  // Models tend to put the right option first: shuffle, the same way in both languages, and move the key with it.
  if (form === "choice" && task.optionsEs?.length === 4 && task.optionsEn?.length === 4 && task.answerIndex !== undefined) {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    task = { ...task, optionsEs: order.map((i) => task.optionsEs![i]), optionsEn: order.map((i) => task.optionsEn![i]), answerIndex: order.indexOf(task.answerIndex) };
  }
  return proveAndStore({ ...input, form, task, model: written.model, traceId: written.traceId, checkGraph: skill.checkGraph, keepRejected: true });
}

// --- Admins' edits (docs/practice.md, "Editing a task") --------------------------------------------------------------

/**
 * A model's rewrite of one task, following the admin's instruction: returned for the admin to review, not stored.
 * The form stays; everything the instruction doesn't mention should too.
 */
export async function aiEditTask(input: { taskId: string; instruction: string; model: string; userId: string; deadline: number }): Promise<{ ok: true; task: TaskContent; model: string } | { ok: false; error: string }> {
  const row = await prisma.practiceTask.findUnique({ where: { id: input.taskId }, select: { courseId: true, skillKey: true, stage: true, form: true, content: true } });
  if (!row) return { ok: false, error: "That task is gone." };
  const skill = await skillFor(row.courseId, row.skillKey);
  if ("error" in skill) return { ok: false, error: skill.error ?? "This skill isn't published yet." };
  const form = row.form as TaskForm;
  const context = [
    ...(await taskContext(skill, row.stage, form)),
    `# THE TASK NOW\n${JSON.stringify(row.content, null, 1)}`,
    `# WHAT THE ADMIN WANTS CHANGED\n${input.instruction}`,
  ].join("\n\n");
  const chosen = AUTHORING_CHAIN.some((entry) => entry.model === input.model) ? input.model : DEFAULT_TASK_MODEL;
  const written = await generateWithFallback({
    feature: "graph",
    pool: "AUTHORING",
    userId: input.userId,
    models: chainStartingAt(AUTHORING_CHAIN, chosen),
    chosenFirst: true,
    deadline: input.deadline,
    contents: [
      {
        role: "user",
        parts: [
          { text: context },
          {
            text: `Rewrite THE TASK NOW as the admin asks, as a ${form} task for the same skill and stage. Keep everything the request doesn't ask to change, keep Spanish and English saying the same thing, and keep the key, tests and solutions consistent with any change. Answer with the whole task as the JSON object.`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: schemaFor(form),
      thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel },
      maxOutputTokens: 8192,
    },
  });
  if (!written.ok) return { ok: false, error: written.reason === "quota" ? "Today's authoring allowance is used up." : "No model could rewrite the task in time. Try again." };
  try {
    const task = TaskSchema.parse(JSON.parse(written.text));
    return { ok: true, task: { ...task, form }, model: written.model };
  } catch {
    return { ok: false, error: `${written.model} didn't answer with a valid task.` };
  }
}

/**
 * Saves an admin's edit (made by hand or with a model): the edited task is proven like a new one; when it passes, it
 * joins the pool as a new task and the old one is retired, so past answers keep pointing at what learners saw.
 */
export async function saveTaskEdit(input: { taskId: string; task: unknown; editedWith: string | null; userId: string; deadline: number }): Promise<GenerateResult> {
  const row = await prisma.practiceTask.findUnique({ where: { id: input.taskId }, select: { id: true, courseId: true, skillKey: true, stage: true, form: true, status: true } });
  if (!row) return { ok: false, error: "That task is gone." };
  if (row.status === "RETIRED") return { ok: false, error: "That task was retired or already replaced by an edit." };
  const parsed = TaskSchema.safeParse(input.task);
  if (!parsed.success) return { ok: false, error: `The task isn't complete: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).slice(0, 3).join("; ")}` };
  const skill = await skillFor(row.courseId, row.skillKey);
  if ("error" in skill) return { ok: false, error: skill.error ?? "This skill isn't published yet." };
  const form = row.form as TaskForm;
  // The writer decides who checks a question: a model other than the one that wrote it.
  const writer = input.editedWith && AUTHORING_CHAIN.some((entry) => entry.model === input.editedWith) ? input.editedWith : "admin";
  const result = await proveAndStore({
    courseId: row.courseId,
    skillKey: row.skillKey,
    stage: row.stage,
    form,
    task: { ...parsed.data, form },
    model: writer === "admin" ? "edited by an admin" : `${writer}, edited`,
    userId: input.userId,
    deadline: input.deadline,
    checkGraph: skill.checkGraph,
    keepRejected: false,
    editedFromId: row.id,
  });
  if (result.ok) await prisma.practiceTask.update({ where: { id: row.id }, data: { status: "RETIRED" } });
  return result;
}
