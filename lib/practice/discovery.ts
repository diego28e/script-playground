import { Type, type Schema, type ThinkingLevel } from "@google/genai";
import {
  checkPrerequisiteHypothesis,
  discoveryExtension,
  prerequisiteReport,
  prerequisiteRequest,
  type Evidence,
  type PracticeEvent,
  type PracticeItem,
  type PracticeState,
  type PrerequisiteHypothesis,
  type ReviewLogEntry,
  type SkillNode,
} from "@intellectif/lk-practice";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AUTHORING_CHAIN, chainStartingAt, generateWithFallback } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { practice } from "@/lib/practice/config";
import { normaliseKey } from "@/lib/practice/draft";
import { skillForms } from "@/lib/practice/graph";
import { composeLearnerGraph, latestGraph, loadLearner, type Answer, type Feedback, type LearnerExtension, type LearnerGraph, type SessionItem } from "@/lib/practice/learner";
import { generateTask, type TaskContent } from "@/lib/practice/tasks";
import { pendingTutorRequests, resolveNextTutorRequest, tutorRequestedSkills } from "@/lib/practice/tutor-requests";

// Missing prerequisites (docs/practice.md, "Missing prerequisites"). When a learner fails a skill twice in a row at its
// stage, lk-practice suggests a diagnosis; a model names up to two prerequisites that may be missing (a course skill,
// or a new one the course doesn't teach); lk-practice checks them and opens each as a hypothesis; short probes on the
// prerequisite alone decide it. Only a confirmed one joins the learner's graph, as a soft prerequisite practised
// before the skill it blocked. The admin sees every proposal with how its probes went, and decides whether the course
// keeps it for everyone.

/** New skills a diagnosis names go under this prefix: "found.<name>". */
const FOUND_PREFIX = "found";
const MAX_HYPOTHESES = 2;
/** Diagnoses per learner per 24 hours: each is one model call, plus the probe tasks it may need written. */
const MAX_DIAGNOSES_PER_DAY = 3;
/** Distinct probe tasks a hypothesis gets today: two answers can settle it (both failed confirm, both passed refute). */
const PROBES_PER_DAY = 2;
export const DIAGNOSIS_MODEL = "claude-sonnet-5-5";

/** What the learner is told after an answer settled a hypothesis. */
export type DiscoveryNote = { verdict: "confirmed" | "refuted"; skill: { es: string; en: string }; forSkill: { es: string; en: string } };

function ladderOf(node: SkillNode): readonly string[] {
  return node.stages ?? practice.config.ladders[node.knowledge === "procedural" ? "procedural" : "declarative"];
}

function labels(published: LearnerGraph, key: string) {
  const meta = published.skills[key];
  return { es: meta?.labelEs ?? key, en: meta?.labelEn ?? key };
}

/**
 * Called after an answer was recorded, with lk-practice's events: queues a diagnosis when one is suggested, and
 * counts and admits decided hypotheses. Returns the diagnosis to run (the page runs it in the background) and what to
 * tell the learner.
 */
export async function afterAnswer(input: {
  userId: string;
  courseId: string;
  learnerId: string;
  state: PracticeState;
  events: readonly PracticeEvent[];
  evidenceId: string;
  entry: SessionItem;
}): Promise<{ diagnosisId: string | null; discovery: DiscoveryNote | null }> {
  let diagnosisId: string | null = null;
  let discovery: DiscoveryNote | null = null;
  for (const event of input.events) {
    if (event.type === "skill.diagnosis-suggested" && !input.entry.probe) {
      diagnosisId = await queueDiagnosis(input.learnerId, input.evidenceId, event.skillId, event.stage, input.entry.taskId);
    }
    if (event.type === "hypothesis.decided") {
      const hypothesis = input.state.hypotheses?.[event.hypothesisId];
      if (!hypothesis) continue;
      await prisma.practiceDiscoveredEdge.updateMany({
        where: { courseId: input.courseId, fromKey: hypothesis.skillId, toKey: hypothesis.forSkillId },
        data: event.verdict === "confirmed" ? { confirmed: { increment: 1 } } : { refuted: { increment: 1 } },
      });
      if (event.verdict === "confirmed") await admit(input.userId, input.courseId, input.learnerId, input.state, event.hypothesisId);
      const loaded = await loadLearner(input.userId, input.courseId);
      if (loaded) discovery = { verdict: event.verdict, skill: labels(loaded.published, hypothesis.skillId), forSkill: labels(loaded.published, hypothesis.forSkillId) };
    }
  }
  return { diagnosisId, discovery };
}

async function queueDiagnosis(learnerId: string, evidenceId: string, skillKey: string, stage: string, taskId: string): Promise<string | null> {
  const since = new Date(Date.now() - 86_400_000);
  const [recent, running] = await Promise.all([
    prisma.practiceDiagnosis.count({ where: { learnerId, createdAt: { gte: since } } }),
    prisma.practiceDiagnosis.count({ where: { learnerId, skillKey, status: { in: ["PENDING", "RUNNING"] } } }),
  ]);
  if (recent >= MAX_DIAGNOSES_PER_DAY || running) return null;
  const row = await prisma.practiceDiagnosis.create({ data: { learnerId, evidenceId, skillKey, stage, taskId } });
  return row.id;
}

/** A confirmed hypothesis joins the learner's graph: its extension is stored, and loadLearner replays the log against it. */
async function admit(userId: string, courseId: string, learnerId: string, state: PracticeState, hypothesisId: string) {
  const admission = discoveryExtension(state, hypothesisId);
  if (!admission.ok) {
    console.error(JSON.stringify({ event: "practice.discovery_admit_failed", learnerId, hypothesisId, issues: admission.issues.slice(0, 3) }));
    return;
  }
  const learner = await prisma.practiceLearner.findUnique({ where: { id: learnerId }, select: { extensions: true } });
  const stored = (learner?.extensions ?? []) as unknown as LearnerExtension[];
  if (stored.some((extension) => "hypothesisId" in extension && extension.hypothesisId === hypothesisId)) return;
  await prisma.practiceLearner.update({ where: { id: learnerId }, data: { extensions: [...stored, admission.extension] as unknown as Prisma.InputJsonArray } });
  await loadLearner(userId, courseId);
}

// ---------------------------------------------------------------------------------------------------------------
// The diagnosis

const SYSTEM_PROMPT = `You diagnose why a learner keeps failing a skill in a programming course (Python, LangChain, LangGraph). They failed tasks for the BLOCKED skill twice in a row at its current stage. Name at most ${MAX_HYPOTHESES} prerequisites that are plausibly MISSING for this learner: knowledge the blocked skill relies on that their answer suggests they lack. Each will be tested with short questions on the prerequisite alone, so name concrete, testable skills.

RULES
- Prefer a course skill when one covers the gap: give its id exactly as listed under COURSE SKILLS in existingSkillId. It must not be the blocked skill, one of its PREREQUISITES, or one that builds on the blocked skill.
- Otherwise propose a new skill the course doesn't teach (usually general Python or programming background: dictionaries, f-strings, comprehensions, classes, async/await, JSON, type hints, decorators, HTTP basics) in newSkill: a short kebab-case key, labels and a one-sentence description in Spanish and English, knowledge ("declarative" for facts and concepts, "procedural" for how-to), and runnable=true when plain offline Python can practise it.
- One narrow gap each ("read nested dict values with [] and .get", not "Python basics").
- Never propose what's listed under ALREADY TESTED.
- If the failures look like a slip, a misread question, or a gap in the blocked skill itself rather than in something before it, return an empty list.
- rationale: one sentence in English saying what in the answers points to the gap.
Answer with the JSON object only.`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    hypotheses: {
      type: Type.ARRAY,
      items: {
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
            },
            required: ["key", "labelEs", "labelEn", "descriptionEs", "descriptionEn", "knowledge", "runnable"],
          },
          rationale: { type: Type.STRING },
        },
        required: ["rationale"],
      },
    },
  },
  required: ["hypotheses"],
};

const ProposalSchema = z.object({
  hypotheses: z
    .array(
      z.object({
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
          })
          .optional(),
        rationale: z.string().default(""),
      }),
    )
    .max(5),
});

/** What the learner answered and what the grading said, short, for the model. */
function describeAttempt(content: TaskContent, answer: Answer | null, feedback: Feedback | null): string {
  const lines = [`Task (${content.form}):\n${content.promptEn}`];
  if (content.form === "choice") {
    lines.push(`Options:\n${(content.optionsEn ?? []).map((option, index) => `${index}. ${option}`).join("\n")}\nCorrect: ${content.answerIndex}. Learner picked: ${answer?.index ?? "nothing"}.`);
  } else if (content.form === "fill") {
    lines.push(`Accepted: ${(content.answers ?? []).join(" | ")}. Learner wrote: ${JSON.stringify(answer?.text ?? "")}.`);
  } else if (content.form === "predict") {
    lines.push(`Code:\n${content.code}\nIt prints: ${JSON.stringify(content.expectedOutput)}. Learner predicted: ${JSON.stringify(answer?.text ?? "")}.`);
  } else {
    lines.push(`Learner's code:\n${(answer?.code ?? "").slice(0, 2500)}`);
    const failed = (feedback?.tests ?? []).filter((test) => !test.passed).map((test) => `${test.name}: ${test.message}`);
    if (failed.length) lines.push(`Failing tests:\n${failed.slice(0, 5).join("\n")}`);
    if (feedback?.error) lines.push(`Error: ${feedback.error.type}: ${feedback.error.message.split("\n").slice(-3).join(" ")}`);
  }
  return lines.join("\n");
}

export type DiagnosisResult = { ok: true; opened: number } | { ok: false; error: string };

/**
 * Runs a queued diagnosis: the model's proposals, lk-practice's check, and the accepted ones opened as hypotheses.
 * Ends by `deadline` (epoch ms). Only the learner it belongs to can run it, once.
 */
export async function runDiagnosis(userId: string, courseId: string, diagnosisId: string, deadline: number): Promise<DiagnosisResult> {
  const claimed = await prisma.practiceDiagnosis.updateMany({ where: { id: diagnosisId, status: "PENDING", learner: { userId, courseId } }, data: { status: "RUNNING" } });
  if (!claimed.count) return { ok: false, error: "This diagnosis isn't waiting to run." };
  const diagnosis = await prisma.practiceDiagnosis.findUniqueOrThrow({ where: { id: diagnosisId } });
  const finish = (status: "OPENED" | "NONE" | "FAILED", data: { model?: string | null; proposals?: unknown; error?: string } = {}) =>
    prisma.practiceDiagnosis.update({
      where: { id: diagnosisId },
      data: { status, finishedAt: new Date(), model: data.model ?? null, proposals: (data.proposals ?? undefined) as Prisma.InputJsonValue | undefined, error: data.error ?? null },
    });

  try {
    const loaded = await loadLearner(userId, courseId);
    if (!loaded) {
      await finish("FAILED", { error: "no published graph" });
      return { ok: false, error: "Practice isn't set up for this course." };
    }
    const { graph } = loaded.published;
    // The failed answer as lk-practice logged it, the task, and what the learner gave.
    const [logged, task, answers] = await Promise.all([
      prisma.practiceLogEntry.findFirst({ where: { learnerId: diagnosis.learnerId, entry: { path: ["evidence", "id"], equals: diagnosis.evidenceId } }, select: { entry: true } }),
      prisma.practiceTask.findUnique({ where: { id: diagnosis.taskId }, select: { item: true, content: true } }),
      prisma.practiceAnswer.findMany({
        where: { session: { learnerId: diagnosis.learnerId }, task: { skillKey: diagnosis.skillKey } },
        orderBy: { createdAt: "desc" },
        take: 2,
        select: { answer: true, result: true, task: { select: { content: true } } },
      }),
    ]);
    const evidence = (logged?.entry as unknown as ReviewLogEntry | undefined)?.kind === "evidence" ? ((logged!.entry as unknown as { evidence: Evidence }).evidence) : null;
    if (!evidence || !task?.item) {
      await finish("FAILED", { error: "the failed answer or its task is gone" });
      return { ok: false, error: "The answer to diagnose is gone." };
    }
    const item = task.item as unknown as PracticeItem;
    const lastFeedback = (answers[0]?.result ?? null) as unknown as Feedback | null;
    const request = prerequisiteRequest(
      {
        graph,
        state: loaded.state,
        evidence,
        item,
        failedCriteria: (lastFeedback?.tests ?? []).filter((test) => !test.passed).map((test) => test.name),
        excerpt: describeAttempt(task.content as unknown as TaskContent, answers[0]?.answer as unknown as Answer, lastFeedback).slice(0, 1500),
      },
      { idPrefix: FOUND_PREFIX, seed: diagnosisId, maxCandidates: MAX_HYPOTHESES },
      practice.config,
    );

    const tested = [...request.open, ...request.refuted].map((id) => loaded.state.hypotheses?.[id]?.skillId).filter(Boolean);
    // The model sees no edges: leave out the skills that build on the blocked one (naming one would make a cycle) and
    // its prerequisites (listed on their own).
    const after = new Set<string>([request.blocked.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const edge of graph.edges) {
        if (after.has(edge.from) && !after.has(edge.to)) {
          after.add(edge.to);
          grew = true;
        }
      }
    }
    const prerequisiteIds = new Set(request.prerequisites.map((skill) => skill.id));
    const blockedMeta = loaded.published.skills[diagnosis.skillKey];
    const facts = [
      `# BLOCKED skill: ${request.blocked.id}\n${request.blocked.label ?? ""}\n${request.blocked.description ?? ""}\nKind: ${request.blocked.knowledge}. Current stage: ${request.blocked.stage} (ladder ${request.blocked.ladder.join(" → ")}).`,
      `# The learner's last two attempts\n${answers
        .map((row, index) => `## Attempt ${index + 1}\n${describeAttempt(row.task.content as unknown as TaskContent, row.answer as unknown as Answer, row.result as unknown as Feedback)}`)
        .join("\n\n")}`,
      `# PREREQUISITES of the blocked skill\n${request.prerequisites.map((skill) => `- ${skill.id} (${skill.strength}): ${skill.label ?? ""}`).join("\n") || "(none)"}`,
      `# NEARBY skills\n${request.nearby.map((skill) => `- ${skill.id}: ${skill.label ?? ""}`).join("\n") || "(none)"}`,
      `# ALREADY TESTED for this learner\n${tested.map((key) => `- ${key}`).join("\n") || "(none)"}`,
      `# COURSE SKILLS (id: label)\n${graph.skills
        .filter((skill) => !after.has(skill.id) && !prerequisiteIds.has(skill.id) && !loaded.published.skills[skill.id]?.found)
        .map((skill) => `- ${skill.id}: ${skill.label ?? ""}`)
        .join("\n")}`,
    ].join("\n\n");

    const result = await generateWithFallback({
      feature: "diagnose",
      pool: "AUTHORING",
      userId,
      models: chainStartingAt(AUTHORING_CHAIN, DIAGNOSIS_MODEL),
      chosenFirst: true,
      deadline,
      contents: [{ role: "user", parts: [{ text: facts }] }],
      config: { systemInstruction: SYSTEM_PROMPT, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: 4096 },
    });
    if (!result.ok) {
      await finish("FAILED", { error: `no model answered (${result.reason})` });
      return { ok: false, error: "No model could diagnose it in time." };
    }
    let proposal: z.infer<typeof ProposalSchema>;
    try {
      proposal = ProposalSchema.parse(JSON.parse(result.text));
    } catch {
      await finish("FAILED", { model: result.model, error: "the model's answer wasn't valid JSON" });
      return { ok: false, error: "The diagnosis came back unreadable." };
    }

    // The model's proposals as lk-practice hypotheses. A new skill reuses the course's found skill of the same key, so
    // every learner probes the same skill and its tasks are written once.
    const dismissed = await prisma.practiceDiscoveredEdge.findMany({ where: { courseId, toKey: diagnosis.skillKey, status: "DISMISSED" }, select: { fromKey: true } });
    const dismissedFrom = new Set(dismissed.map((row) => row.fromKey));
    const candidates: { skillId: string; edge: { kind: "prerequisite"; from: string; to: string; strength: "soft" }; skill?: SkillNode; rationale: string }[] = [];
    const newSkills = new Map<string, NonNullable<z.infer<typeof ProposalSchema>["hypotheses"][number]["newSkill"]>>();
    for (const entry of proposal.hypotheses.slice(0, MAX_HYPOTHESES)) {
      const existing = entry.existingSkillId?.trim();
      if (existing && graph.skills.some((skill) => skill.id === existing)) {
        if (!dismissedFrom.has(existing)) candidates.push({ skillId: existing, edge: { kind: "prerequisite", from: existing, to: diagnosis.skillKey, strength: "soft" }, rationale: entry.rationale });
        continue;
      }
      if (!entry.newSkill) continue;
      const key = `${FOUND_PREFIX}.${normaliseKey(entry.newSkill.key).slice(0, 60)}`;
      if (key === `${FOUND_PREFIX}.` || dismissedFrom.has(key)) continue;
      const row = await prisma.practiceFoundSkill.findUnique({ where: { courseId_key: { courseId, key } }, select: { node: true } });
      const node: SkillNode = row
        ? (row.node as unknown as SkillNode)
        : {
            id: key,
            knowledge: entry.newSkill.knowledge,
            label: entry.newSkill.labelEn,
            description: entry.newSkill.descriptionEn,
            forms: skillForms(entry.newSkill.knowledge === "procedural" ? "PROCEDURAL" : "DECLARATIVE", entry.newSkill.runnable),
            tags: ["found"],
          };
      if (graph.skills.some((skill) => skill.id === key)) {
        candidates.push({ skillId: key, edge: { kind: "prerequisite", from: key, to: diagnosis.skillKey, strength: "soft" }, rationale: entry.rationale });
      } else {
        candidates.push({ skillId: key, edge: { kind: "prerequisite", from: key, to: diagnosis.skillKey, strength: "soft" }, skill: node, rationale: entry.rationale });
      }
      newSkills.set(key, entry.newSkill);
    }
    const checked = checkPrerequisiteHypothesis(request, graph, { hypotheses: candidates }, practice.config);
    const proposals = {
      accepted: checked.accepted.map((hypothesis) => ({ id: hypothesis.id, skillId: hypothesis.skillId, isNew: Boolean(hypothesis.skill), rationale: hypothesis.rationale ?? "" })),
      rejected: checked.rejected.map((rejection) => ({ skillId: candidates[rejection.index]?.skillId ?? null, codes: rejection.issues.map((issue) => issue.code) })),
    };
    if (!checked.accepted.length) {
      await finish("NONE", { model: result.model, proposals });
      return { ok: true, opened: 0 };
    }

    // The found skills and the proposals, for the course; then the hypotheses opened in the learner's log. The state
    // is read again just before: the learner may have answered while the model thought.
    const lessonId = blockedMeta?.lessonId;
    for (const hypothesis of checked.accepted) {
      const fresh = newSkills.get(hypothesis.skillId);
      if (hypothesis.skill && fresh && lessonId) {
        await prisma.practiceFoundSkill.upsert({
          where: { courseId_key: { courseId, key: hypothesis.skillId } },
          create: {
            courseId,
            key: hypothesis.skillId,
            labelEs: fresh.labelEs,
            labelEn: fresh.labelEn,
            descriptionEs: fresh.descriptionEs,
            descriptionEn: fresh.descriptionEn,
            knowledge: fresh.knowledge === "procedural" ? "PROCEDURAL" : "DECLARATIVE",
            runnable: fresh.runnable,
            node: hypothesis.skill as unknown as Prisma.InputJsonObject,
            lessonId,
          },
          update: {},
        });
      }
      await prisma.practiceDiscoveredEdge.upsert({
        where: { courseId_fromKey_toKey: { courseId, fromKey: hypothesis.skillId, toKey: hypothesis.forSkillId } },
        create: { courseId, fromKey: hypothesis.skillId, toKey: hypothesis.forSkillId, rationale: hypothesis.rationale ?? null, opened: 1 },
        update: { opened: { increment: 1 } },
      });
    }
    const opened = await openHypotheses(userId, courseId, checked.accepted);
    await finish(opened ? "OPENED" : "FAILED", { model: result.model, proposals, ...(opened ? {} : { error: "lk-practice didn't open the hypotheses" }) });
    return { ok: true, opened };
  } catch (error) {
    console.error(JSON.stringify({ event: "practice.diagnosis_failed", diagnosisId, error: error instanceof Error ? error.message : String(error) }));
    await finish("FAILED", { error: error instanceof Error ? error.message.slice(0, 500) : "failed" });
    return { ok: false, error: "The diagnosis failed." };
  }
}

/** Opens the hypotheses in the learner's log (lk-practice's act), saving the state only if nothing changed meanwhile. */
async function openHypotheses(userId: string, courseId: string, hypotheses: readonly PrerequisiteHypothesis[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const loaded = await loadLearner(userId, courseId);
    if (!loaded) return 0;
    let state = loaded.state;
    const appended: ReviewLogEntry[] = [];
    let opened = 0;
    for (const hypothesis of hypotheses) {
      const result = practice.act(state, loaded.published.graph, { id: `open:${hypothesis.id}`, at: Date.now(), action: { kind: "open-hypothesis", hypothesis } });
      if (result.kind !== "applied") continue;
      state = result.state;
      appended.push(...result.appended);
      opened++;
    }
    if (!opened) return 0;
    try {
      await prisma.$transaction(async (tx) => {
        const saved = await tx.practiceLearner.updateMany({ where: { id: loaded.learner.id, updatedAt: loaded.learner.updatedAt }, data: { state: state as unknown as Prisma.InputJsonObject } });
        if (!saved.count) throw new Error("changed");
        await tx.practiceLogEntry.createMany({ data: appended.map((log) => ({ learnerId: loaded.learner.id, seq: log.seq, at: new Date(log.at), entry: log as unknown as Prisma.InputJsonObject })) });
      });
      return opened;
    } catch {
      // The learner answered in between: read the state again and retry.
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Probe and practice tasks for today

/**
 * Puts what the learner's hypotheses need into today's set: probes of open ones (up to two distinct tasks a day), and
 * one practice task on each confirmed prerequisite not ready yet. When a needed task doesn't exist, writes one (at
 * most one per call, by `deadline`). Returns the items added and whether calling again may add more.
 */
export async function prepareDiscovery(userId: string, courseId: string, sessionId: string, deadline: number): Promise<{ added: SessionItem[]; more: boolean } | null> {
  const owned = await prisma.practiceSession.findFirst({ where: { id: sessionId, learner: { userId, courseId } }, select: { id: true, extra: true } });
  if (!owned) return null;
  // Practice the tutor asked for (lib/practice/tutor-requests.ts): one waiting request resolved per call, while there's
  // time for a model to answer; the page calls again while there's more.
  let resolvedMore = false;
  if (!owned.extra && deadline - Date.now() > 20_000 && (await pendingTutorRequests(userId, courseId)) > 0) {
    await resolveNextTutorRequest(userId, courseId, deadline - 8_000).catch((error) =>
      console.error(JSON.stringify({ event: "practice.tutor_request_failed", error: error instanceof Error ? error.message : String(error) })),
    );
    resolvedMore = (await pendingTutorRequests(userId, courseId)) > 0;
  }
  const loaded = await loadLearner(userId, courseId);
  if (!loaded) return null;
  const session = await prisma.practiceSession.findFirst({ where: { id: sessionId, learnerId: loaded.learner.id }, select: { id: true, items: true, createdAt: true, extra: true } });
  if (!session) return null;
  const items = [...(session.items as unknown as SessionItem[])];
  const { graph } = loaded.published;
  const nodeOf = (key: string) => graph.skills.find((skill) => skill.id === key);
  const hypotheses = Object.values(loaded.state.hypotheses ?? {}).filter((hypothesis) => !hypothesis.closedAt);

  const needs: { skillKey: string; stage: string; kind: "probe" | "discovered" | "tutor"; probe?: string; count: number }[] = [];
  for (const hypothesis of hypotheses) {
    const node = nodeOf(hypothesis.skillId);
    if (!node) continue;
    const ladder = ladderOf(node);
    if (hypothesis.verdict === "open") {
      const probes = items.filter((item) => item.probe === hypothesis.id).length;
      if (probes < PROBES_PER_DAY) needs.push({ skillKey: hypothesis.skillId, stage: ladder[ladder.length - 1], kind: "probe", probe: hypothesis.id, count: PROBES_PER_DAY - probes });
    } else if (hypothesis.verdict === "confirmed" && !hypothesis.readyAt) {
      if (!items.some((item) => item.skillKey === hypothesis.skillId && !item.probe)) {
        needs.push({ skillKey: hypothesis.skillId, stage: loaded.state.skills[hypothesis.skillId]?.stage ?? ladder[0], kind: "discovered", count: 1 });
      }
    }
  }
  // Skills the tutor asked this learner to practise, from the day after the request: started when lk-practice hasn't
  // started them yet, and practised again when they're due. A task is written for them when the pool has none.
  if (!session.extra) {
    const now = Date.now();
    const status = new Map(practice.status(loaded.state, graph, now).skills.map((skill) => [skill.skillId, skill]));
    for (const requested of await tutorRequestedSkills(userId, courseId)) {
      const node = nodeOf(requested.key);
      if (!node || requested.requestedAt >= session.createdAt) continue;
      if (items.some((item) => item.skillKey === requested.key) || needs.some((need) => need.skillKey === requested.key)) continue;
      const skill = status.get(requested.key);
      const started = Boolean(loaded.state.skills[requested.key]?.stage);
      if (started && !(skill?.due !== undefined && skill.due !== null && skill.due <= now)) continue;
      if (skill?.status === "suspended" || skill?.status === "locked") continue;
      needs.push({ skillKey: requested.key, stage: loaded.state.skills[requested.key]?.stage ?? ladderOf(node)[0], kind: "tutor", count: 1 });
    }
  }
  if (!needs.length) return { added: [], more: resolvedMore };

  const taken = new Set(items.map((item) => item.taskId));
  const added: SessionItem[] = [];
  let toWrite: (typeof needs)[number] | null = null;
  for (const need of needs) {
    const tasks = await prisma.practiceTask.findMany({ where: { courseId, skillKey: need.skillKey, stage: need.stage, status: "PROVEN" }, select: { id: true }, orderBy: { createdAt: "asc" } });
    const free = tasks.filter((task) => !taken.has(task.id)).slice(0, need.count);
    for (const task of free) {
      taken.add(task.id);
      added.push({ targetId: `added:${need.kind}:${need.probe ?? need.skillKey}:${task.id}`, taskId: task.id, skillKey: need.skillKey, stage: need.stage, kind: need.kind, added: true, ...(need.probe ? { probe: need.probe } : {}) });
    }
    if (free.length < need.count && !toWrite) toWrite = need;
  }
  const save = async () => {
    if (!added.length) return;
    // Read the items again: they only grow, and only here.
    const current = await prisma.practiceSession.findUniqueOrThrow({ where: { id: session.id }, select: { items: true } });
    const have = new Set((current.items as unknown as SessionItem[]).map((item) => item.taskId));
    const fresh = added.filter((item) => !have.has(item.taskId));
    await prisma.practiceSession.update({ where: { id: session.id }, data: { items: [...(current.items as unknown as SessionItem[]), ...fresh] as unknown as Prisma.InputJsonArray } });
  };
  await save();
  if (!toWrite || deadline - Date.now() < 20_000) return { added, more: resolvedMore || Boolean(toWrite) };

  const written = await generateTask({ courseId, skillKey: toWrite.skillKey, stage: toWrite.stage, userId, deadline });
  if (!written.ok) {
    console.error(JSON.stringify({ event: "practice.discovery_task_failed", skillKey: toWrite.skillKey, stage: toWrite.stage, error: written.error }));
    return { added, more: false };
  }
  const item: SessionItem = {
    targetId: `added:${toWrite.kind}:${toWrite.probe ?? toWrite.skillKey}:${written.taskId}`,
    taskId: written.taskId,
    skillKey: toWrite.skillKey,
    stage: toWrite.stage,
    kind: toWrite.kind,
    added: true,
    ...(toWrite.probe ? { probe: toWrite.probe } : {}),
  };
  added.push(item);
  await save();
  return { added, more: true };
}

// ---------------------------------------------------------------------------------------------------------------
// The admin's view

/**
 * Every proposed prerequisite of a course with how its probes went, and lk-practice's advice across the learners who
 * confirmed it (prerequisiteReport: practise, harden, revoke or keep).
 */
export async function courseDiscoveries(courseId: string) {
  const [edges, found, latest, learners] = await Promise.all([
    prisma.practiceDiscoveredEdge.findMany({ where: { courseId }, orderBy: [{ confirmed: "desc" }, { opened: "desc" }, { createdAt: "asc" }] }),
    prisma.practiceFoundSkill.findMany({ where: { courseId } }),
    latestGraph(courseId),
    prisma.practiceLearner.findMany({ where: { courseId }, select: { state: true, extensions: true }, take: 500, orderBy: { updatedAt: "desc" } }),
  ]);
  const advice = new Map<string, Record<string, number>>();
  if (latest) {
    for (const learner of learners) {
      const state = learner.state as unknown as PracticeState;
      if (!Object.keys(state.hypotheses ?? {}).length) continue;
      const { graph } = composeLearnerGraph(latest.published.graph, (learner.extensions ?? []) as unknown as LearnerExtension[], []);
      try {
        for (const entry of prerequisiteReport(state, graph, practice.config)) {
          const key = `${entry.skillId}>${entry.forSkillId}`;
          const counts = advice.get(key) ?? {};
          counts[entry.advice] = (counts[entry.advice] ?? 0) + 1;
          advice.set(key, counts);
        }
      } catch {
        // A state built on another version: its report waits for the learner's next visit.
      }
    }
  }
  const foundByKey = new Map(found.map((row) => [row.key, row]));
  const label = (key: string) => {
    const meta = latest?.published.skills[key];
    if (meta) return { es: meta.labelEs, en: meta.labelEn };
    const row = foundByKey.get(key);
    return row ? { es: row.labelEs, en: row.labelEn } : { es: key, en: key };
  };
  return edges.map((edge) => {
    const row = foundByKey.get(edge.fromKey);
    return {
      id: edge.id,
      from: { key: edge.fromKey, ...label(edge.fromKey), found: Boolean(row), description: row ? { es: row.descriptionEs, en: row.descriptionEn } : null },
      to: { key: edge.toKey, ...label(edge.toKey) },
      status: edge.status,
      rationale: edge.rationale,
      opened: edge.opened,
      confirmed: edge.confirmed,
      refuted: edge.refuted,
      advice: advice.get(`${edge.fromKey}>${edge.toKey}`) ?? {},
      createdAt: edge.createdAt.toISOString(),
    };
  });
}
export type CourseDiscovery = Awaited<ReturnType<typeof courseDiscoveries>>[number];

/**
 * Adds a proposed prerequisite to the course's own graph: a found skill becomes a skill of the lesson it was found in
 * (keeping its key, so learners' history follows it), and the edge a soft prerequisite. Takes effect when the admin
 * publishes the next version.
 */
export async function addDiscoveryToCourse(edgeId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const edge = await prisma.practiceDiscoveredEdge.findUnique({ where: { id: edgeId } });
  if (!edge) return { ok: false, error: "That proposal is gone." };
  const to = await prisma.practiceSkill.findFirst({ where: { courseId: edge.courseId, key: edge.toKey }, select: { id: true } });
  if (!to) return { ok: false, error: "The skill it's a prerequisite of isn't a course skill (add that one first)." };
  let from = await prisma.practiceSkill.findFirst({ where: { courseId: edge.courseId, key: edge.fromKey }, select: { id: true } });
  if (!from) {
    const found = await prisma.practiceFoundSkill.findUnique({ where: { courseId_key: { courseId: edge.courseId, key: edge.fromKey } } });
    if (!found) return { ok: false, error: "The prerequisite skill is gone." };
    const last = await prisma.practiceSkill.findFirst({ where: { lessonId: found.lessonId }, orderBy: { position: "desc" }, select: { position: true } });
    from = await prisma.practiceSkill.create({
      data: {
        courseId: edge.courseId,
        lessonId: found.lessonId,
        key: found.key,
        labelEs: found.labelEs,
        labelEn: found.labelEn,
        descriptionEs: found.descriptionEs,
        descriptionEn: found.descriptionEn,
        knowledge: found.knowledge,
        runnable: found.runnable,
        position: (last?.position ?? -1) + 1,
      },
      select: { id: true },
    });
  }
  await prisma.practiceSkillEdge.upsert({
    where: { fromId_toId: { fromId: from.id, toId: to.id } },
    create: { fromId: from.id, toId: to.id, strength: "SOFT", reason: edge.rationale ? `Found by practice: ${edge.rationale}` : "Found by practice." },
    update: {},
  });
  await prisma.practiceDiscoveredEdge.update({ where: { id: edgeId }, data: { status: "ADDED" } });
  return { ok: true };
}

export async function setDiscoveryStatus(edgeId: string, status: "PROPOSED" | "DISMISSED") {
  await prisma.practiceDiscoveredEdge.update({ where: { id: edgeId }, data: { status } });
}
