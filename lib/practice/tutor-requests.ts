import { Type, type Schema, type ThinkingLevel } from "@google/genai";
import { admitExtension, checkDecomposition, decompositionRequest, type DiscoveryExtension, type GraphExtension, type SkillEdge, type SkillNode } from "@intellectif/lk-practice";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AUTHORING_CHAIN, chainStartingAt, generateWithFallback } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { practice } from "@/lib/practice/config";
import { normaliseKey } from "@/lib/practice/draft";
import { tutorSkillForms } from "@/lib/practice/graph";
import { loadLearner } from "@/lib/practice/learner";

// Practice from the tutor (docs/practice.md, "Practice from the tutor"). In the lab, when the tutor closes a detour or
// the learner asks for more practice on something, the panel offers "practise this in a few days"; the click stores a
// request: the skill in the tutor's words, the lesson, and the last messages (the detour's explanation and challenge).
// On the learner's next practice visit, each request is resolved here, once:
//   - to a course skill, when the tutor's words name one of them exactly (not a broader lesson topic that uses it);
//   - otherwise to a narrow skill made for it, a "found" skill like those a diagnosis finds, which joins this learner's
//     graph at once as lk-practice's goal extension (a component the lesson's skill encompasses, so nothing waits on
//     it), admitted by the learner's own request. Its tasks are code-first and written in the spirit of the tutor's
//     challenge, on the fly the first time they're needed (lib/practice/discovery.ts prepareDiscovery).
// The admin sees each such skill among the discoveries and may add it to the course for everyone.

const FOUND_PREFIX = "found";
const RESOLVE_MODEL = "claude-sonnet-5-5";
const MAX_TRIES = 3;

const SYSTEM_PROMPT = `A learner in a programming course (Python, LangChain, LangGraph) asked their AI tutor, while working on a notebook, to practise something later in their spaced practice: a missing prerequisite the tutor cleared in a detour, or more exercises on something they want to master. Decide what skill their practice should drill.

RULES
- The skill is the narrow thing the learner wanted to practise, read from the conversation: one idea ("use min() to find the binding limit among several capacities"), not the lesson's broader topic.
- If one of the COURSE SKILLS or FOUND SKILLS is that same narrow skill, give its id exactly in existingSkillId. A broader skill that merely uses it doesn't count.
- Otherwise define newSkill: a short kebab-case key; labels and a one-sentence description in Spanish and English; knowledge "procedural" for how-to (most cases), "declarative" for facts and concepts; runnable true when plain offline Python can practise it; criteriaHint: one sentence on what a correct answer shows.
- anchorSkillId: the course skill (from LESSON SKILLS when one fits) whose work uses the new skill, the one it is part of. Always give it with a new skill.
- context: two to four sentences in English describing the tutor's challenge (its scenario, its numbers, what the learner had to compute), so practice tasks can be written in the same spirit. No solution code.
- rationale: one sentence in English.
Answer with the JSON object only.`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    existingSkillId: { type: Type.STRING },
    newSkill: {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING },
        labelEs: { type: Type.STRING },
        labelEn: { type: Type.STRING },
        descriptionEs: { type: Type.STRING },
        descriptionEn: { type: Type.STRING },
        knowledge: { type: Type.STRING, enum: ["declarative", "procedural"] },
        runnable: { type: Type.BOOLEAN },
        criteriaHint: { type: Type.STRING },
      },
      required: ["key", "labelEs", "labelEn", "descriptionEs", "descriptionEn", "knowledge", "runnable", "criteriaHint"],
    },
    anchorSkillId: { type: Type.STRING },
    context: { type: Type.STRING },
    rationale: { type: Type.STRING },
  },
  required: ["context", "rationale"],
};

const ResolutionSchema = z.object({
  existingSkillId: z.string().optional(),
  newSkill: z
    .object({
      key: z.string().min(2),
      labelEs: z.string().min(3),
      labelEn: z.string().min(3),
      descriptionEs: z.string().min(3),
      descriptionEn: z.string().min(3),
      knowledge: z.enum(["declarative", "procedural"]),
      runnable: z.boolean(),
      criteriaHint: z.string().default(""),
    })
    .optional(),
  anchorSkillId: z.string().optional(),
  context: z.string().default(""),
  rationale: z.string().default(""),
});

type Detail = { notebookPath?: string; messages?: { role: string; content: string }[] };

async function courseLessonIds(courseId: string): Promise<string[]> {
  const lessons = await prisma.lesson.findMany({ where: { module: { courseId } }, select: { id: true } });
  return lessons.map((lesson) => lesson.id);
}

/** The requests of this learner for this course that wait to be resolved. */
export async function pendingTutorRequests(userId: string, courseId: string): Promise<number> {
  return prisma.practiceRequest.count({ where: { userId, resolvedAt: null, resolveTries: { lt: MAX_TRIES }, lessonId: { in: await courseLessonIds(courseId) } } });
}

/** This learner's resolved requests for this course: the skills the tutor asked them to practise. */
export async function tutorRequestedSkills(userId: string, courseId: string): Promise<{ key: string; requestedAt: Date }[]> {
  const rows = await prisma.practiceRequest.findMany({
    where: { userId, resolvedKey: { not: null }, resolution: { in: ["course", "found"] }, lessonId: { in: await courseLessonIds(courseId) } },
    orderBy: { createdAt: "asc" },
    select: { resolvedKey: true, createdAt: true },
  });
  const first = new Map<string, Date>();
  for (const row of rows) if (row.resolvedKey && !first.has(row.resolvedKey)) first.set(row.resolvedKey, row.createdAt);
  return [...first].map(([key, requestedAt]) => ({ key, requestedAt }));
}

export type ResolveResult = { resolved: boolean; skillKey?: string; resolution?: "course" | "found" | "none" };

/** Resolves the oldest waiting request of this learner for this course, by `deadline`. */
export async function resolveNextTutorRequest(userId: string, courseId: string, deadline: number): Promise<ResolveResult | null> {
  const lessonIds = await courseLessonIds(courseId);
  const request = await prisma.practiceRequest.findFirst({
    where: { userId, resolvedAt: null, resolveTries: { lt: MAX_TRIES }, lessonId: { in: lessonIds } },
    orderBy: { createdAt: "asc" },
  });
  if (!request || !request.lessonId) return null;
  // Claimed: a second visit at the same moment moves on to the next request (or none).
  const claimed = await prisma.practiceRequest.updateMany({ where: { id: request.id, resolveTries: request.resolveTries }, data: { resolveTries: { increment: 1 } } });
  if (!claimed.count) return null;
  const done = async (resolution: "course" | "found" | "none", key: string | null) => {
    await prisma.practiceRequest.update({ where: { id: request.id }, data: { resolution, resolvedKey: key, resolvedAt: new Date() } });
    return { resolved: true, skillKey: key ?? undefined, resolution } as ResolveResult;
  };
  const giveUp = async (reason: string) => {
    console.error(JSON.stringify({ event: "practice.tutor_request_unresolved", requestId: request.id, tries: request.resolveTries + 1, reason }));
    if (request.resolveTries + 1 >= MAX_TRIES) return done("none", null);
    return { resolved: false } as ResolveResult;
  };

  const loaded = await loadLearner(userId, courseId);
  if (!loaded) return giveUp("no published graph");
  const { graph } = loaded.published;
  const base = (await prisma.skillGraphVersion.findFirst({ where: { courseId }, orderBy: { version: "desc" }, select: { graph: true } }))?.graph as unknown as {
    graph: { skills: SkillNode[] };
  } | null;
  const courseSkillIds = new Set((base?.graph.skills ?? []).map((skill) => skill.id));
  const [lesson, foundRows] = await Promise.all([
    prisma.lesson.findUnique({ where: { id: request.lessonId }, select: { code: true, title: true, objectives: true } }),
    prisma.practiceFoundSkill.findMany({ where: { courseId }, select: { key: true, labelEn: true, node: true, lessonId: true } }),
  ]);
  const meta = loaded.published.skills;
  const lessonSkills = Object.entries(meta).filter(([key, entry]) => entry.lessonId === request.lessonId && courseSkillIds.has(key));
  const detail = (request.detail ?? {}) as Detail;
  const facts = [
    `# The request\nIn the tutor's words: ${request.skill}\nHow it came: ${request.evidence === "REQUESTED" ? "the learner asked for more practice on it" : request.evidence === "PASSED" ? "a detour the learner passed" : "a detour the learner skipped (said they knew it)"}`,
    lesson ? `# The lesson: ${lesson.code ?? ""} ${lesson.title}\nObjectives:\n${lesson.objectives.map((objective) => `- ${objective}`).join("\n")}` : "",
    `# The conversation (oldest first)\n${(detail.messages ?? []).map((message) => `## ${message.role}\n${message.content}`).join("\n\n") || "(not kept)"}`,
    `# LESSON SKILLS (id: label)\n${lessonSkills.map(([key, entry]) => `- ${key}: ${entry.labelEn}`).join("\n") || "(none)"}`,
    `# COURSE SKILLS (id: label)\n${[...courseSkillIds].map((key) => `- ${key}: ${meta[key]?.labelEn ?? key}`).join("\n")}`,
    `# FOUND SKILLS (id: label)\n${foundRows.map((row) => `- ${row.key}: ${row.labelEn}`).join("\n") || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateWithFallback({
    feature: "diagnose",
    pool: "AUTHORING",
    userId,
    models: chainStartingAt(AUTHORING_CHAIN, RESOLVE_MODEL),
    chosenFirst: true,
    deadline,
    contents: [{ role: "user", parts: [{ text: facts }] }],
    config: { systemInstruction: SYSTEM_PROMPT, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: 2048 },
  });
  if (!result.ok) return giveUp(`no model answered (${result.reason})`);
  let answer: z.infer<typeof ResolutionSchema>;
  try {
    answer = ResolutionSchema.parse(JSON.parse(result.text));
  } catch {
    return giveUp("unreadable answer");
  }

  // A skill already in the learner's graph (a course skill, or a found one they have): practise that.
  const existing = answer.existingSkillId?.trim();
  if (existing && graph.skills.some((skill) => skill.id === existing)) return done(courseSkillIds.has(existing) ? "course" : "found", existing);

  // A found skill: one the course already has (from another learner or a diagnosis) is reused, so its tasks are shared.
  const foundRow = existing ? foundRows.find((row) => row.key === existing) : undefined;
  const key = foundRow?.key ?? (answer.newSkill ? `${FOUND_PREFIX}.${normaliseKey(answer.newSkill.key).slice(0, 60)}` : null);
  if (!key || key === `${FOUND_PREFIX}.`) return giveUp("neither an existing skill nor a new one");
  const sameKeyRow = foundRow ?? foundRows.find((row) => row.key === key);
  const fresh = answer.newSkill;
  const node: SkillNode | null = sameKeyRow
    ? (sameKeyRow.node as unknown as SkillNode)
    : fresh
      ? {
          id: key,
          knowledge: fresh.knowledge,
          label: fresh.labelEn,
          description: fresh.descriptionEn,
          ...(fresh.criteriaHint ? { criteriaHint: fresh.criteriaHint } : {}),
          forms: tutorSkillForms(fresh.knowledge === "procedural" ? "PROCEDURAL" : "DECLARATIVE", fresh.runnable),
          tags: ["found", "tutor"],
        }
      : null;
  if (!node) return giveUp("no skill to add");
  const anchor = answer.anchorSkillId && courseSkillIds.has(answer.anchorSkillId) ? answer.anchorSkillId : lessonSkills[0]?.[0];
  if (!anchor) return giveUp("no course skill to anchor it to");

  if (!sameKeyRow && fresh) {
    await prisma.practiceFoundSkill.upsert({
      where: { courseId_key: { courseId, key } },
      create: {
        courseId,
        key,
        labelEs: fresh.labelEs,
        labelEn: fresh.labelEn,
        descriptionEs: fresh.descriptionEs,
        descriptionEn: fresh.descriptionEn,
        knowledge: fresh.knowledge === "procedural" ? "PROCEDURAL" : "DECLARATIVE",
        runnable: fresh.runnable,
        node: node as unknown as Prisma.InputJsonObject,
        lessonId: request.lessonId,
        origin: "TUTOR",
        context: answer.context.slice(0, 2000) || null,
      },
      update: {},
    });
  }

  // The learner's goal extension: the skill, encompassed by the lesson's skill that uses it (nothing waits on it), checked
  // and admitted by lk-practice, then composed into their graph on the next load (with a replay of their log).
  if (!graph.skills.some((skill) => skill.id === key)) {
    const edges: SkillEdge[] = [{ kind: "encompasses", from: anchor, to: key, weight: 0.5 }];
    const goal = decompositionRequest(
      { id: `tutor:${request.id}`, text: request.skill, anchorSkillIds: [anchor] },
      graph,
      { idPrefix: FOUND_PREFIX, seed: request.id, maxSkills: 1, knowledge: ["declarative", "procedural"] },
      practice.config,
    );
    const checked = checkDecomposition(goal, graph, { skills: [node], edges }, practice.config);
    if (!checked.ok) return giveUp(`lk-practice refused the skill: ${checked.issues.map((issue) => issue.code).join(", ")}`);
    const admitted = admitExtension(checked.extension, { by: "learner", at: Date.now(), approverId: userId });
    if (!admitted.ok) return giveUp(`lk-practice didn't admit it: ${admitted.issues.map((issue) => issue.code).join(", ")}`);
    const row = await prisma.practiceLearner.findUniqueOrThrow({ where: { id: loaded.learner.id }, select: { extensions: true } });
    const stored = (row.extensions ?? []) as unknown as (GraphExtension | DiscoveryExtension)[];
    if (!stored.some((extension) => extension.id === admitted.extension.id)) {
      await prisma.practiceLearner.update({
        where: { id: loaded.learner.id },
        data: { extensions: [...stored, admitted.extension] as unknown as Prisma.InputJsonArray },
      });
    }
  }
  // For the admin: the skill among the discoveries, with where it came from, to add to the course if it keeps coming up.
  await prisma.practiceDiscoveredEdge.upsert({
    where: { courseId_fromKey_toKey: { courseId, fromKey: key, toKey: anchor } },
    create: { courseId, fromKey: key, toKey: anchor, rationale: `From the tutor: ${answer.rationale || request.skill}`.slice(0, 500), opened: 1 },
    update: { opened: { increment: 1 } },
  });
  const resolved = await done("found", key);
  // Composed now, so the page that asked sees it.
  await loadLearner(userId, courseId);
  return resolved;
}
