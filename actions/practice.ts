"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTHORING_CHAIN } from "@/lib/ai/gemini";
import { draftLesson, normaliseKey } from "@/lib/practice/draft";
import { publishGraph, type PublishedGraph } from "@/lib/practice/graph";
import { generateTask, type TaskContent, type TaskForm } from "@/lib/practice/tasks";

// The practice skill graph's admin page (/admin/practice, docs/practice.md): draft each lesson's skills with a model,
// edit and approve them, then publish a version for learners.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.role === "ADMIN" ? session : null;
}

const denied = { success: false as const, error: "Only admins can edit the practice graph." };
const refresh = () => revalidatePath("/admin/practice");

/** Everything the page shows: per course, its lessons in order with their skills and prerequisites, and its versions. */
export async function getPracticeGraph() {
  if (!(await requireAdmin())) throw new Error("Only admins can see the practice graph.");
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      skillGraphs: { orderBy: { version: "desc" }, take: 1, select: { version: true, skillCount: true, edgeCount: true, publishedAt: true, graph: true } },
      modules: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          title: true,
          lessons: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              code: true,
              title: true,
              objectives: true,
              practiceDraft: { select: { status: true, model: true, draftedAt: true, approvedAt: true } },
              practiceSkills: {
                orderBy: { position: "asc" },
                select: {
                  id: true,
                  key: true,
                  labelEs: true,
                  labelEn: true,
                  descriptionEs: true,
                  descriptionEn: true,
                  knowledge: true,
                  runnable: true,
                  criteriaHint: true,
                  requires: { orderBy: { createdAt: "asc" }, select: { id: true, strength: true, reason: true, from: { select: { id: true, key: true, labelEn: true } } } },
                  _count: { select: { requiredBy: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  // Practice tasks: each published skill's stages, and how many proven tasks each stage has.
  const counts = await prisma.practiceTask.groupBy({ by: ["courseId", "skillKey", "stage"], where: { status: "PROVEN" }, _count: { _all: true } });
  return {
    models: AUTHORING_CHAIN.map(({ model, label }) => ({ id: model, label })),
    courses: courses.map(({ skillGraphs, ...course }) => {
      const latest = skillGraphs[0] ?? null;
      const graph = latest ? (latest.graph as unknown as PublishedGraph).graph : null;
      const stages: Record<string, string[]> = Object.fromEntries((graph?.skills ?? []).map((skill) => [skill.id, ladderOrder(Object.keys(skill.forms ?? {}))]));
      const tasks: Record<string, Record<string, number>> = {};
      for (const row of counts.filter((entry) => entry.courseId === course.id)) (tasks[row.skillKey] ??= {})[row.stage] = row._count._all;
      return {
        ...course,
        latest: latest && { version: latest.version, skillCount: latest.skillCount, edgeCount: latest.edgeCount, publishedAt: latest.publishedAt },
        stages,
        tasks,
      };
    }),
  };
}
export type PracticeGraphData = Awaited<ReturnType<typeof getPracticeGraph>>;

export async function draftLessonSkills(lessonId: string, model?: string): Promise<Result<{ skills: number; edges: number; dropped: string[]; model: string }>> {
  const session = await requireAdmin();
  if (!session) return denied;
  const result = await draftLesson(lessonId, session.user.id, model);
  if (!result.ok) return { success: false, error: result.error };
  refresh();
  return { success: true, skills: result.skills, edges: result.edges, dropped: result.dropped, model: result.model };
}

export async function setLessonApproval(lessonId: string, approved: boolean): Promise<Result> {
  const session = await requireAdmin();
  if (!session) return denied;
  const skills = await prisma.practiceSkill.count({ where: { lessonId } });
  if (approved && !skills) return { success: false, error: "Draft or add at least one skill before approving." };
  await prisma.practiceLessonDraft.upsert({
    where: { lessonId },
    create: { lessonId, status: approved ? "APPROVED" : "DRAFTED", approvedAt: approved ? new Date() : null, approvedById: approved ? session.user.id : null },
    update: { status: approved ? "APPROVED" : "DRAFTED", approvedAt: approved ? new Date() : null, approvedById: approved ? session.user.id : null },
  });
  refresh();
  return { success: true };
}

/** Approves every lesson of the course that waits for review and has skills; returns how many were approved. */
export async function approveAllLessons(courseId: string): Promise<Result<{ approved: number }>> {
  const session = await requireAdmin();
  if (!session) return denied;
  const { count } = await prisma.practiceLessonDraft.updateMany({
    where: { status: "DRAFTED", lesson: { module: { courseId }, practiceSkills: { some: {} } } },
    data: { status: "APPROVED", approvedAt: new Date(), approvedById: session.user.id },
  });
  refresh();
  return { success: true, approved: count };
}

const SkillSchema = z.object({
  key: z.string().min(1).max(80),
  labelEs: z.string().trim().min(1).max(120),
  labelEn: z.string().trim().min(1).max(120),
  descriptionEs: z.string().trim().min(1).max(400),
  descriptionEn: z.string().trim().min(1).max(400),
  knowledge: z.enum(["DECLARATIVE", "PROCEDURAL"]),
  runnable: z.boolean(),
  criteriaHint: z.string().trim().max(400).nullable(),
});
export type SkillInput = z.infer<typeof SkillSchema>;

export async function updateSkill(id: string, input: SkillInput): Promise<Result> {
  if (!(await requireAdmin())) return denied;
  const parsed = SkillSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const key = normaliseKey(parsed.data.key);
  if (!key) return { success: false, error: "The key needs letters or digits." };
  const skill = await prisma.practiceSkill.findUnique({ where: { id }, select: { courseId: true } });
  if (!skill) return { success: false, error: "That skill no longer exists." };
  const clash = await prisma.practiceSkill.findFirst({ where: { courseId: skill.courseId, key, id: { not: id } }, select: { id: true } });
  if (clash) return { success: false, error: `Another skill already uses the key ${key}.` };
  await prisma.practiceSkill.update({ where: { id }, data: { ...parsed.data, key, criteriaHint: parsed.data.criteriaHint || null } });
  refresh();
  return { success: true };
}

export async function addSkill(lessonId: string): Promise<Result> {
  if (!(await requireAdmin())) return denied;
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { code: true, module: { select: { courseId: true } }, _count: { select: { practiceSkills: true } } } });
  if (!lesson) return { success: false, error: "Lesson not found." };
  const base = normaliseKey(`new-skill-${lesson.code ?? "lesson"}`);
  let key = base;
  for (let n = 2; await prisma.practiceSkill.findFirst({ where: { courseId: lesson.module.courseId, key }, select: { id: true } }); n += 1) key = `${base}-${n}`;
  await prisma.practiceSkill.create({
    data: {
      courseId: lesson.module.courseId,
      lessonId,
      key,
      labelEs: "Nueva habilidad",
      labelEn: "New skill",
      descriptionEs: "Describe qué puede hacer quien la domina.",
      descriptionEn: "Describe what someone who has it can do.",
      knowledge: "PROCEDURAL",
      position: lesson._count.practiceSkills,
    },
  });
  await prisma.practiceLessonDraft.upsert({ where: { lessonId }, create: { lessonId }, update: {} });
  refresh();
  return { success: true };
}

export async function deleteSkill(id: string): Promise<Result> {
  if (!(await requireAdmin())) return denied;
  await prisma.practiceSkill.delete({ where: { id } }).catch(() => null);
  refresh();
  return { success: true };
}

/** Course order of a skill's lesson, to keep prerequisites pointing back: no cycles, nothing learned later. */
async function placeOf(skillId: string) {
  const skill = await prisma.practiceSkill.findUnique({
    where: { id: skillId },
    select: { courseId: true, position: true, lessonId: true, lesson: { select: { position: true, module: { select: { position: true } } } } },
  });
  return skill && { courseId: skill.courseId, lessonId: skill.lessonId, order: [skill.lesson.module.position, skill.lesson.position, skill.position] as const };
}

/** Adds, changes (strength) or removes (null) the prerequisite `fromId` → `toId`. */
export async function setPrerequisite(toId: string, fromId: string, strength: "HARD" | "SOFT" | null): Promise<Result> {
  if (!(await requireAdmin())) return denied;
  if (strength === null) {
    await prisma.practiceSkillEdge.deleteMany({ where: { fromId, toId } });
    refresh();
    return { success: true };
  }
  const [from, to] = await Promise.all([placeOf(fromId), placeOf(toId)]);
  if (!from || !to || from.courseId !== to.courseId || fromId === toId) return { success: false, error: "Those skills can't be linked." };
  const earlier = from.order[0] < to.order[0] || (from.order[0] === to.order[0] && (from.order[1] < to.order[1] || (from.order[1] === to.order[1] && from.order[2] < to.order[2])));
  if (!earlier) return { success: false, error: "A prerequisite must come earlier in the course than the skill it unlocks." };
  await prisma.practiceSkillEdge.upsert({ where: { fromId_toId: { fromId, toId } }, create: { fromId, toId, strength }, update: { strength } });
  refresh();
  return { success: true };
}

export async function publishPracticeGraph(courseId: string): Promise<Result<{ version: number; skills: number; edges: number; warnings: string[] }>> {
  const session = await requireAdmin();
  if (!session) return denied;
  const result = await publishGraph(courseId, session.user.id);
  if (!result.ok) return { success: false, error: [result.error, ...(result.issues ?? [])].join("\n") };
  refresh();
  return { success: true, version: result.version, skills: result.skills, edges: result.edges, warnings: result.warnings };
}

// lk-practice's two default ladders, in order: a stored graph doesn't keep the order of its stage names.
const LADDER = ["recognise", "recall", "produce", "apply", "example", "complete", "write", "transfer"];
function ladderOrder(stages: string[]): string[] {
  return [...stages].sort((a, b) => (LADDER.indexOf(a) === -1 ? 99 : LADDER.indexOf(a)) - (LADDER.indexOf(b) === -1 ? 99 : LADDER.indexOf(b)));
}

// --- Practice tasks (docs/practice.md, "Tasks") ----------------------------------------------------------------------

/** A skill's tasks, newest first, rejected ones included (with why), for the admin to read. */
export async function getSkillTasks(courseId: string, skillKey: string) {
  if (!(await requireAdmin())) throw new Error("Only admins can see practice tasks.");
  const tasks = await prisma.practiceTask.findMany({
    where: { courseId, skillKey, status: { not: "RETIRED" } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, stage: true, form: true, difficulty: true, expectedSeconds: true, content: true, status: true, rejectReason: true, model: true, item: true, createdAt: true },
  });
  return tasks.map(({ content, item, ...task }) => ({
    ...task,
    content: content as unknown as TaskContent,
    proof: (item as { proof?: { kind: string; model?: string; wrongSolutionsFailed?: number } } | null)?.proof ?? null,
  }));
}
export type SkillTask = Awaited<ReturnType<typeof getSkillTasks>>[number];

/** Writes and proves one task for a skill's stage: one model call and its proof, inside one request. */
export async function writeSkillTask(courseId: string, skillKey: string, stage: string, form?: TaskForm): Promise<Result<{ form: string; model: string; note: string }>> {
  const session = await requireAdmin();
  if (!session) return denied;
  // An Amplify request is reported to stop at about 30 s: the writing and the proof end by 27 s.
  const result = await generateTask({ courseId, skillKey, stage, form, userId: session.user.id, deadline: Date.now() + 27_000 });
  refresh();
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, form: result.form, model: result.model, note: result.note };
}

/** Takes a task out of the pool (it stays in the table, marked RETIRED). */
export async function retireTask(taskId: string): Promise<Result> {
  if (!(await requireAdmin())) return denied;
  await prisma.practiceTask.update({ where: { id: taskId }, data: { status: "RETIRED" } });
  refresh();
  return { success: true };
}
