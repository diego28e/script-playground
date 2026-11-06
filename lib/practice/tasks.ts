import { createHash, randomUUID } from "node:crypto";
import { Type, type Schema, type ThinkingLevel } from "@google/genai";
import { admitCandidate, validateItems, type CandidateItem, type CandidateProof, type PracticeItem } from "@intellectif/lk-practice";
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
    "code: code is the starter the learner edits (imports, a function signature with a docstring, and `raise NotImplementedError`). tests holds 2 to 5 functions named test_* that use plain assert with a short English message, are deterministic, print nothing and run in under 5 seconds. solution is a correct full replacement of the starter; wrongSolution is a plausible wrong one (a typical mistake) that fails at least one test.",
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
    "explanationEs",
    "explanationEn",
  ],
};

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
      return need(["code", "tests", "solution", "wrongSolution"]) ? "code without code, tests, solution or wrongSolution" : null;
    case "debug":
      return need(["code", "tests", "solution"]) ? "debug without code, tests or solution" : null;
  }
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
  const version = await prisma.skillGraphVersion.findFirst({ where: { courseId: input.courseId }, orderBy: { version: "desc" }, select: { graph: true } });
  if (!version) return { ok: false, error: "Publish a version of the skill graph first: tasks are written for published skills." };
  const published = version.graph as unknown as PublishedGraph;
  const node = published.graph.skills.find((skill) => skill.id === input.skillKey);
  const meta = published.skills[input.skillKey];
  if (!node || !meta) return { ok: false, error: "This skill isn't in the published graph yet: approve its lesson and publish." };
  const forms = (node.forms?.[input.stage] ?? []) as TaskForm[];
  if (!forms.length) return { ok: false, error: `The skill has no stage "${input.stage}".` };

  const existing = await prisma.practiceTask.findMany({
    where: { courseId: input.courseId, skillKey: input.skillKey, stage: input.stage, status: "PROVEN" },
    select: { form: true, content: true },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  // The form this stage's pool has least of, unless one was asked for.
  const form = input.form && forms.includes(input.form) ? input.form : [...forms].sort((a, b) => existing.filter((task) => task.form === a).length - existing.filter((task) => task.form === b).length)[0];

  const lesson = await prisma.lesson.findUnique({ where: { id: meta.lessonId }, select: { code: true, title: true, objectives: true } });
  const ladder = Object.keys(node.forms ?? {});
  const context = [
    `# Skill: ${node.label} (key ${node.id})\n${node.description ?? ""}\nKind: ${node.knowledge}. Ladder: ${ladder.join(" → ")}.${node.criteriaHint ? `\nWhat shows the skill: ${node.criteriaHint}` : ""}`,
    `# Stage: ${input.stage}\n${STAGES[input.stage] ?? input.stage}`,
    `# Form: ${form}\n${FORM_RULES[form]}`,
    lesson ? `# From lesson ${lesson.code ?? ""}: ${lesson.title}\nObjectives:\n${lesson.objectives.map((objective) => `- ${objective}`).join("\n")}` : "",
    `# EXISTING TASKS (don't repeat)\n${existing.map((task) => `- (${task.form}) ${String((task.content as TaskContent).promptEn).replace(/\s+/g, " ").slice(0, 160)}`).join("\n") || "(none yet)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

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
      responseSchema: RESPONSE_SCHEMA,
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
  const shape = shapeProblem(task);
  const proof: Proof = shape
    ? { ok: false, reason: shape }
    : form === "choice" || form === "fill"
      ? await proveByModel(task, written.model, input.userId, input.deadline)
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
      const valid = validateItems([admitted.item], published.graph, practice.config);
      if (!valid.ok) reason = `lk-practice refused it: ${valid.issues.map((issue) => issue.code).join(", ")}`;
      else item = admitted.item;
    }
  }

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
        model: written.model,
        traceId: written.traceId,
        contentHash,
      },
    });
  } catch {
    return { ok: false, form, model: written.model, error: "The model repeated a task the pool already has." };
  }
  if (!item) return { ok: false, taskId, form, model: written.model, error: `Rejected: ${reason}` };
  return { ok: true, taskId, form, model: written.model, note: proof.ok ? proof.note : "" };
}
