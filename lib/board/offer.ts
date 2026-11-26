import type { PracticeState } from "@intellectif/lk-practice";
import { prisma } from "@/lib/prisma";
import { boardSecret, boardUrl } from "@/lib/board/token";
import { stateName, type SkillStateName } from "@/lib/board/context";

// What the lesson page offers on the whiteboard (docs/whiteboard.md): a board per skill of the lesson, with the
// learner's state in each, or one for the whole lesson while its skills aren't approved yet.

export type BoardSkill = { key: string; labelEs: string; labelEn: string; state: SkillStateName; open: boolean; sessions: number };
export type BoardOffer = { skills: BoardSkill[]; lessonOpen: boolean; lessonSessions: number };

/** Whether this viewer may use the whiteboard: set up here, and admins only for now (docs/whiteboard-plan.md §7). */
export function boardAllowed(viewer: { role?: string | null } | null): boolean {
  return Boolean(viewer && viewer.role === "ADMIN" && boardSecret() && boardUrl());
}

/** The lesson's skills as the whiteboard teaches them, when its practice draft is approved; else none. */
export async function lessonSkills(lessonId: string) {
  const approved = await prisma.practiceLessonDraft.findFirst({ where: { lessonId, status: "APPROVED" }, select: { id: true } });
  if (!approved) return [];
  return prisma.practiceSkill.findMany({ where: { lessonId }, orderBy: { position: "asc" }, select: { key: true, labelEs: true, labelEn: true } });
}

export async function boardOffer(userId: string, courseId: string, lessonId: string): Promise<BoardOffer> {
  const [skills, learner, sessions] = await Promise.all([
    lessonSkills(lessonId),
    prisma.practiceLearner.findFirst({ where: { userId, courseId }, select: { state: true } }),
    prisma.boardSession.groupBy({ by: ["skillKey", "status"], where: { userId, lessonId }, _count: { _all: true } }),
  ]);
  const state = (learner?.state ?? null) as PracticeState | null;
  const count = (key: string | null, status?: "OPEN") => sessions.filter((row) => row.skillKey === key && (!status || row.status === status)).reduce((sum, row) => sum + row._count._all, 0);
  return {
    skills: skills.map((skill) => ({ ...skill, state: stateName(state, skill.key), open: count(skill.key, "OPEN") > 0, sessions: count(skill.key) })),
    lessonOpen: count(null, "OPEN") > 0,
    lessonSessions: count(null),
  };
}

/**
 * The session a board page shows: the newest open one for this skill (or the lesson), created when there is none. Its
 * language follows the page's, so a learner who switched language is taught in the new one.
 */
export async function sessionFor(userId: string, courseId: string, lessonId: string, skillKey: string | null, language: "es" | "en") {
  const open = await prisma.boardSession.findFirst({ where: { userId, lessonId, skillKey, status: "OPEN" }, orderBy: { createdAt: "desc" }, select: { id: true, language: true } });
  if (open && open.language !== language) await prisma.boardSession.update({ where: { id: open.id }, data: { language } });
  return open ? { id: open.id } : prisma.boardSession.create({ data: { userId, courseId, lessonId, skillKey, language }, select: { id: true } });
}
