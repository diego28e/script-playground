"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { TaskContent } from "@/lib/practice/tasks";

// The practice task finder (Admin → Practice → Tasks, docs/practice.md "Finding and fixing a task"): every task of a
// course, searched by its words in either language and filtered by lesson, skill, stage, form and status, with how
// learners did on it, so a wrong or unclear task can be found in seconds and opened in the task editor. Also the one
// task an admin meets in their own practice ("Edit" on the task card).

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.role === "ADMIN" ? session : null;
}

const PAGE = 25;

const FiltersSchema = z.object({
  courseId: z.string().min(1),
  q: z.string().trim().max(200).default(""),
  lessonId: z.string().default(""),
  skillKey: z.string().default(""),
  stage: z.string().default(""),
  form: z.string().default(""),
  status: z.enum(["PROVEN", "REJECTED", "RETIRED", "ALL"]).default("PROVEN"),
  sort: z.enum(["newest", "missed", "answered"]).default("newest"),
  page: z.number().int().min(0).max(1000).default(0),
});
export type TaskFilters = z.input<typeof FiltersSchema>;

type Stats = { answers: number; passed: number };

function toTask(row: {
  id: string;
  courseId: string;
  skillKey: string;
  stage: string;
  form: string;
  difficulty: number;
  expectedSeconds: number;
  content: Prisma.JsonValue;
  status: "PROVEN" | "REJECTED" | "RETIRED";
  rejectReason: string | null;
  model: string;
  item: Prisma.JsonValue;
  createdAt: Date;
  editedFromId: string | null;
}) {
  const { content, item, ...task } = row;
  return {
    ...task,
    content: content as unknown as TaskContent,
    proof: (item as { proof?: { kind: string; model?: string; wrongSolutionsFailed?: number } } | null)?.proof ?? null,
  };
}

const TASK_SELECT = {
  id: true,
  courseId: true,
  skillKey: true,
  stage: true,
  form: true,
  difficulty: true,
  expectedSeconds: true,
  content: true,
  status: true,
  rejectReason: true,
  model: true,
  item: true,
  createdAt: true,
  editedFromId: true,
} as const;

/** The courses and, per course, its lessons and skills in order: the finder's filters. */
export async function getTaskFinderOptions() {
  if (!(await requireAdmin())) throw new Error("Only admins can see practice tasks.");
  // Skills found from learners' answers (a diagnosis, or the tutor) are filed under the lesson they were found for.
  const found = await prisma.practiceFoundSkill.findMany({ orderBy: { createdAt: "asc" }, select: { courseId: true, lessonId: true, key: true, labelEn: true, origin: true } });
  const courses = await prisma.course.findMany({
    orderBy: { title: "asc" },
    where: { practiceTasks: { some: {} } },
    select: {
      id: true,
      title: true,
      modules: {
        orderBy: { position: "asc" },
        select: {
          lessons: {
            orderBy: { position: "asc" },
            select: { id: true, code: true, title: true, practiceSkills: { orderBy: { position: "asc" }, select: { key: true, labelEn: true } } },
          },
        },
      },
    },
  });
  return courses.map((course) => ({
    id: course.id,
    title: course.title,
    lessons: course.modules.flatMap((courseModule) =>
      courseModule.lessons
        .map((lesson) => ({
          id: lesson.id,
          code: lesson.code,
          title: lesson.title.replaceAll("`", ""),
          skills: [
            ...lesson.practiceSkills.map((skill) => ({ key: skill.key, label: skill.labelEn })),
            ...found
              .filter((skill) => skill.courseId === course.id && skill.lessonId === lesson.id)
              .map((skill) => ({ key: skill.key, label: `${skill.labelEn} (${skill.origin === "TUTOR" ? "from the tutor" : "found in practice"})` })),
          ],
        }))
        .filter((lesson) => lesson.skills.length > 0),
    ),
  }));
}
export type TaskFinderOptions = Awaited<ReturnType<typeof getTaskFinderOptions>>;

/**
 * One page of a course's tasks for the filters. The words are searched in the task's whole content (prompt, options,
 * answers, explanations, code), in both languages, case- and accent-insensitive where Postgres can.
 */
export async function findPracticeTasks(input: TaskFilters) {
  if (!(await requireAdmin())) throw new Error("Only admins can see practice tasks.");
  const filters = FiltersSchema.parse(input);

  let skillKeys: string[] | undefined;
  if (filters.skillKey) skillKeys = [filters.skillKey];
  else if (filters.lessonId) {
    const [skills, found] = await Promise.all([
      prisma.practiceSkill.findMany({ where: { courseId: filters.courseId, lessonId: filters.lessonId }, select: { key: true } }),
      prisma.practiceFoundSkill.findMany({ where: { courseId: filters.courseId, lessonId: filters.lessonId }, select: { key: true } }),
    ]);
    skillKeys = [...skills, ...found].map((skill) => skill.key);
  }

  let matching: string[] | undefined;
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM practice_task WHERE "courseId" = ${filters.courseId} AND content::text ILIKE ${pattern} LIMIT 2000`;
    matching = rows.map((row) => row.id);
  }

  const where: Prisma.PracticeTaskWhereInput = {
    courseId: filters.courseId,
    ...(skillKeys ? { skillKey: { in: skillKeys } } : {}),
    ...(matching ? { id: { in: matching } } : {}),
    ...(filters.stage ? { stage: filters.stage } : {}),
    ...(filters.form ? { form: filters.form } : {}),
    ...(filters.status === "ALL" ? {} : { status: filters.status }),
  };

  // How learners did, per task: every match is counted so "most missed" sorts the whole result, not one page.
  const all = await prisma.practiceTask.findMany({ where, select: { id: true, createdAt: true } });
  const ids = all.map((task) => task.id);
  const [answered, passed] = ids.length
    ? await Promise.all([
        prisma.practiceAnswer.groupBy({ by: ["taskId"], where: { taskId: { in: ids } }, _count: { _all: true } }),
        prisma.practiceAnswer.groupBy({ by: ["taskId"], where: { taskId: { in: ids }, passed: true }, _count: { _all: true } }),
      ])
    : [[], []];
  const stats = new Map<string, Stats>();
  for (const row of answered) stats.set(row.taskId, { answers: row._count._all, passed: 0 });
  for (const row of passed) stats.get(row.taskId)!.passed = row._count._all;
  const statsOf = (id: string): Stats => stats.get(id) ?? { answers: 0, passed: 0 };

  const ordered = [...all].sort((a, b) => {
    if (filters.sort === "answered") return statsOf(b.id).answers - statsOf(a.id).answers || +b.createdAt - +a.createdAt;
    if (filters.sort === "missed") {
      // Most learners getting it wrong first; a task nobody answered goes last.
      const missed = (id: string) => (statsOf(id).answers ? (statsOf(id).answers - statsOf(id).passed) / statsOf(id).answers : -1);
      return missed(b.id) - missed(a.id) || statsOf(b.id).answers - statsOf(a.id).answers;
    }
    return +b.createdAt - +a.createdAt;
  });
  const pageIds = ordered.slice(filters.page * PAGE, (filters.page + 1) * PAGE).map((task) => task.id);
  const rows = await prisma.practiceTask.findMany({ where: { id: { in: pageIds } }, select: TASK_SELECT });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const keys = [...new Set(rows.map((row) => row.skillKey))];
  const [skills, foundSkills] = await Promise.all([
    prisma.practiceSkill.findMany({ where: { courseId: filters.courseId, key: { in: keys } }, select: { key: true, labelEn: true, lessonId: true } }),
    prisma.practiceFoundSkill.findMany({ where: { courseId: filters.courseId, key: { in: keys } }, select: { key: true, labelEn: true, lessonId: true } }),
  ]);
  const lessons = await prisma.lesson.findMany({ where: { id: { in: [...skills, ...foundSkills].map((skill) => skill.lessonId) } }, select: { id: true, code: true, title: true } });
  const lessonOf = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const skillOf = new Map(
    [...foundSkills, ...skills].map((skill) => {
      const lesson = lessonOf.get(skill.lessonId);
      return [skill.key, { labelEn: skill.labelEn, lesson: lesson ? { code: lesson.code, title: lesson.title } : null }];
    }),
  );

  return {
    total: all.length,
    page: filters.page,
    pageSize: PAGE,
    tasks: pageIds.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const skill = skillOf.get(row.skillKey);
      return [
        {
          ...toTask(row),
          skill: {
            key: row.skillKey,
            label: skill?.labelEn ?? row.skillKey,
            lesson: skill?.lesson ? { code: skill.lesson.code, title: skill.lesson.title.replaceAll("`", "") } : null,
          },
          stats: statsOf(id),
        },
      ];
    }),
  };
}
export type FoundTask = Awaited<ReturnType<typeof findPracticeTasks>>["tasks"][number];

/** One task in full (its key included), for the editor an admin opens from their own practice. */
export async function getPracticeTaskForEdit(taskId: string) {
  if (!(await requireAdmin())) return null;
  const row = await prisma.practiceTask.findUnique({ where: { id: taskId }, select: TASK_SELECT });
  return row ? toTask(row) : null;
}
