import type { PracticeState } from "@intellectif/lk-practice";
import { prisma } from "@/lib/prisma";
import { boardSecret, boardUrl } from "@/lib/board/token";
import { stateName, type SkillStateName } from "@/lib/board/context";

// What the lesson page offers on the whiteboard (docs/whiteboard.md): a board per skill of the lesson, with the
// learner's state in each, or one for the whole lesson while its skills aren't approved yet.

/** The newest board the teacher finished on a skill (or the lesson): when, which session, and what it found. */
export type BoardDone = {
  sessionId: string;
  at: string;
  minutes: number;
  taught: string[];
  learnerDid: string[];
  struggles: string[];
  readyToPractise: boolean;
  /** The board's checklist at the end (docs/whiteboard-teaching.md §3); empty for boards from before it. */
  objectives: { text: string; met: boolean; untickedByLearner: boolean }[];
  /**
   * What the board sent to the learner's practice (lib/board/events.ts), beside the board's own skill: in the board's
   * words while it waits for the next practice visit, then as the skill it became; "none" when nothing fitted.
   */
  practice: BoardPractice[];
};
export type BoardPractice = { text: string; status: "waiting" | "added" | "none"; labelEs: string | null; labelEn: string | null };
export type BoardSkill = { key: string; labelEs: string; labelEn: string; state: SkillStateName; open: boolean; sessions: number; done: BoardDone | null };
export type BoardOffer = { skills: BoardSkill[]; lessonOpen: boolean; lessonSessions: number; lessonDone: BoardDone | null };

const lines = (value: unknown) => (Array.isArray(value) ? value.filter((line): line is string => typeof line === "string").slice(0, 8) : []);

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
  const [skills, learner, sessions, ended] = await Promise.all([
    lessonSkills(lessonId),
    prisma.practiceLearner.findFirst({ where: { userId, courseId }, select: { state: true } }),
    prisma.boardSession.groupBy({ by: ["skillKey", "status"], where: { userId, lessonId }, _count: { _all: true } }),
    // Finished boards: ended by the teacher with its summary (a board closed with "New board" has none until Didactra
    // sends it). Newest first; the first of each skill is the one shown.
    prisma.boardSession.findMany({
      where: { userId, lessonId, status: "ENDED" },
      orderBy: { endedAt: "desc" },
      take: 100,
      select: { id: true, skillKey: true, endedAt: true, minutes: true, summary: true },
    }),
  ]);
  const shownRows = [null, ...skills.map((skill) => skill.key)]
    .map((key) => ended.find((entry) => entry.skillKey === key && entry.summary && typeof entry.summary === "object"))
    .filter((row): row is (typeof ended)[number] => Boolean(row));
  const practiceBy = await boardPractice(userId, courseId, shownRows.map((row) => ({ id: row.id, skillKey: row.skillKey })));
  const done = (key: string | null): BoardDone | null => {
    const row = shownRows.find((entry) => entry.skillKey === key);
    if (!row) return null;
    const summary = row.summary as Record<string, unknown>;
    return {
      sessionId: row.id,
      at: (row.endedAt ?? new Date()).toISOString(),
      minutes: row.minutes,
      taught: lines(summary.taught),
      learnerDid: lines(summary.learnerDid),
      struggles: lines(summary.struggles),
      readyToPractise: summary.readyToPractise === true,
      objectives: (Array.isArray(summary.objectives) ? summary.objectives : [])
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string")
        .slice(0, 6)
        .map((item) => ({ text: item.text as string, met: item.met === true, untickedByLearner: item.untickedByLearner === true })),
      practice: practiceBy.get(row.id) ?? [],
    };
  };
  const state = (learner?.state ?? null) as PracticeState | null;
  const count = (key: string | null, status?: "OPEN") => sessions.filter((row) => row.skillKey === key && (!status || row.status === status)).reduce((sum, row) => sum + row._count._all, 0);
  return {
    skills: skills.map((skill) => ({ ...skill, state: stateName(state, skill.key), open: count(skill.key, "OPEN") > 0, sessions: count(skill.key), done: done(skill.key) })),
    lessonOpen: count(null, "OPEN") > 0,
    lessonSessions: count(null),
    lessonDone: done(null),
  };
}

/** What each board sent to practice, by session, with the skill each became once resolved. */
async function boardPractice(userId: string, courseId: string, rows: { id: string; skillKey: string | null }[]): Promise<Map<string, BoardPractice[]>> {
  const byId = new Map<string, BoardPractice[]>();
  if (!rows.length) return byId;
  const requests = await prisma.practiceRequest.findMany({
    where: { userId, sessionId: { in: rows.map((row) => row.id) } },
    orderBy: { createdAt: "asc" },
    select: { sessionId: true, skill: true, resolution: true, resolvedKey: true, resolvedAt: true },
  });
  const keys = [...new Set(requests.map((request) => request.resolvedKey).filter((key): key is string => Boolean(key)))];
  const [course, found] = keys.length
    ? await Promise.all([
        prisma.practiceSkill.findMany({ where: { courseId, key: { in: keys } }, select: { key: true, labelEs: true, labelEn: true } }),
        prisma.practiceFoundSkill.findMany({ where: { courseId, key: { in: keys } }, select: { key: true, labelEs: true, labelEn: true } }),
      ])
    : [[], []];
  const labels = new Map([...course, ...found].map((skill) => [skill.key, skill]));
  for (const row of rows) {
    const items = requests
      // The board's own skill, sent when it was ready, is the panel's "ready to practise" line already.
      .filter((request) => request.sessionId === row.id && !(request.skill === row.skillKey && request.resolution === "course"))
      .map((request): BoardPractice => {
        const label = request.resolvedKey ? labels.get(request.resolvedKey) : undefined;
        const status = !request.resolvedAt ? "waiting" : request.resolution === "none" || !request.resolvedKey ? "none" : "added";
        return { text: request.skill, status, labelEs: label?.labelEs ?? null, labelEn: label?.labelEn ?? null };
      });
    byId.set(row.id, items);
  }
  return byId;
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
