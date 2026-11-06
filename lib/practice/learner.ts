import { randomUUID } from "node:crypto";
import type { Evidence, PracticeItem, PracticeState, ReviewLogEntry } from "@intellectif/lk-practice";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { practice } from "@/lib/practice/config";
import type { PublishedGraph } from "@/lib/practice/graph";
import { gradeCode, type GradeTest } from "@/lib/practice/grader";
import { normaliseAnswer, sameOutput, type TaskContent } from "@/lib/practice/tasks";

// A learner's daily practice (docs/practice.md, "A session"): lk-practice plans the set from the learner's state, the
// skills of the lessons they've completed and the proven task pool; each answer is graded here (questions against the
// key, code on the grader) and recorded as evidence; the state and its log are saved together.

export type SessionItem = { targetId: string; taskId: string; skillKey: string; stage: string; kind: string };

// A short daily set: about 8 tasks and 15 minutes, at most 3 new skills; "a few more" adds up to 4.
const DAILY_TARGETS = 8;
const EXTRA_TARGETS = 4;
const DAILY_SECONDS = 15 * 60;
const MAX_NEW_SKILLS = 3;

/** The learner's own date (YYYY-MM-DD) in their time zone; UTC when the zone is unknown. */
export function localDay(timeZone: string | undefined, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

async function latestGraph(courseId: string) {
  const version = await prisma.skillGraphVersion.findFirst({ where: { courseId }, orderBy: { version: "desc" }, select: { version: true, graph: true } });
  return version && { version: version.version, published: version.graph as unknown as PublishedGraph };
}

/**
 * The learner's state on the latest published graph: created on first use, and rebuilt from the log (lk-practice's
 * replay) when a new version has been published since.
 */
export async function loadLearner(userId: string, courseId: string) {
  const latest = await latestGraph(courseId);
  if (!latest) return null;
  const { graph } = latest.published;
  let learner = await prisma.practiceLearner.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (!learner) {
    // An upsert: the header's badge and the practice page may both arrive first.
    learner = await prisma.practiceLearner.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, graphVersion: latest.version, state: practice.initState(userId, graph) as unknown as Prisma.InputJsonObject },
      update: {},
    });
  } else if (learner.graphVersion !== latest.version) {
    const entries = await prisma.practiceLogEntry.findMany({ where: { learnerId: learner.id }, orderBy: { seq: "asc" }, select: { entry: true } });
    const replayed = practice.replay(entries.map((row) => row.entry as unknown as ReviewLogEntry), graph, userId);
    if (!replayed.ok) console.error(JSON.stringify({ event: "practice.replay_failed", learnerId: learner.id, issues: replayed.issues.slice(0, 5) }));
    learner = await prisma.practiceLearner.update({
      where: { id: learner.id },
      data: { graphVersion: latest.version, state: (replayed.ok ? replayed.state : practice.initState(userId, graph)) as unknown as Prisma.InputJsonObject },
    });
  }
  return { learner, state: learner.state as unknown as PracticeState, ...latest };
}

/** Skills the learner may start: those of the lessons they've completed. */
/** Words of a label, for matching a tutor's request to a skill: lowercase, no accents, no short words. */
function words(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((word) => word.length > 2),
  );
}

/**
 * Skills the learner may start: those of the lessons they've completed, and those the tutor offered to practise (a
 * request names a skill in words and the lesson it came from; it's matched to that lesson's skill with the most
 * words in common, in either language).
 */
export async function focusSkills(userId: string, courseId: string, published: PublishedGraph): Promise<string[]> {
  const [done, requests] = await Promise.all([
    prisma.lessonProgress.findMany({ where: { userId, status: "COMPLETED", lesson: { module: { courseId } } }, select: { lessonId: true } }),
    prisma.practiceRequest.findMany({ where: { userId, lessonId: { not: null } }, select: { skill: true, lessonId: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const lessons = new Set(done.map((row) => row.lessonId));
  const focus = new Set(
    Object.entries(published.skills)
      .filter(([, meta]) => lessons.has(meta.lessonId))
      .map(([key]) => key),
  );
  for (const request of requests) {
    const asked = words(request.skill);
    let best: { key: string; score: number } | null = null;
    for (const [key, meta] of Object.entries(published.skills)) {
      if (meta.lessonId !== request.lessonId) continue;
      const own = words(`${key.replaceAll("-", " ")} ${meta.labelEs} ${meta.labelEn}`);
      const score = [...asked].filter((word) => own.has(word)).length;
      if (score > 0 && (!best || score > best.score)) best = { key, score };
    }
    if (best) focus.add(best.key);
  }
  return [...focus];
}

export type SkillProgress = {
  key: string;
  labelEs: string;
  labelEn: string;
  status: string;
  stage: string | null;
  due: number | null;
  recall: number | null;
};

/** Every skill's status for the progress map, grouped by module and lesson in course order. */
export async function progressMap(userId: string, courseId: string) {
  const loaded = await loadLearner(userId, courseId);
  if (!loaded) return null;
  const { state, published } = loaded;
  const at = Date.now();
  const summary = practice.status(state, published.graph, at);
  const focus = new Set(await focusSkills(userId, courseId, published));
  const byKey = new Map(summary.skills.map((skill) => [skill.skillId, skill]));
  const modules = await prisma.courseModule.findMany({
    where: { courseId },
    orderBy: { position: "asc" },
    select: { position: true, title: true, lessons: { orderBy: { position: "asc" }, select: { id: true, code: true, title: true } } },
  });
  const skillsByLesson = new Map<string, SkillProgress[]>();
  for (const [key, meta] of Object.entries(published.skills)) {
    const skill = byKey.get(key);
    // "ready" means lk-practice would start it: only for skills the learner has reached (their lesson, or the tutor).
    const status = !skill ? "locked" : skill.status === "ready" && !focus.has(key) ? "upcoming" : skill.status;
    const entry: SkillProgress = { key, labelEs: meta.labelEs, labelEn: meta.labelEn, status, stage: skill?.stage ?? null, due: skill?.due ?? null, recall: skill?.retrievability ?? null };
    skillsByLesson.set(meta.lessonId, [...(skillsByLesson.get(meta.lessonId) ?? []), entry]);
  }
  const counts: Record<string, number> = {};
  for (const list of skillsByLesson.values()) for (const skill of list) counts[skill.status] = (counts[skill.status] ?? 0) + 1;
  return {
    at,
    counts,
    modules: modules
      .map((courseModule) => ({
        position: courseModule.position,
        title: courseModule.title,
        lessons: courseModule.lessons.filter((lesson) => skillsByLesson.has(lesson.id)).map((lesson) => ({ code: lesson.code, title: lesson.title, skills: skillsByLesson.get(lesson.id)! })),
      }))
      .filter((courseModule) => courseModule.lessons.length),
  };
}

/** Consecutive days with the daily set finished, ending today (or yesterday, while today's isn't done yet). */
export async function practiceStreak(learnerId: string, today: string): Promise<{ days: number; doneToday: boolean }> {
  const sessions = await prisma.practiceSession.findMany({
    where: { learnerId, extra: false, completedAt: { not: null }, answers: { some: {} } },
    select: { day: true },
    orderBy: { day: "desc" },
    take: 400,
  });
  const days = new Set(sessions.map((session) => session.day));
  const step = (day: string) => {
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  };
  const doneToday = days.has(today);
  let cursor = doneToday ? today : step(today);
  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor = step(cursor);
  }
  return { days: count, doneToday };
}

/**
 * What the header's badge counts: the tasks left in today's set, or, before it's planned, the reviews due plus the
 * new skills waiting (at most the daily cap). Cheap: no planning, no task pool.
 */
export async function practiceDue(userId: string, timeZone: string) {
  const learners = await prisma.practiceLearner.findMany({ where: { userId }, select: { id: true, courseId: true, course: { select: { slug: true, title: true } } } });
  const enrolled = await prisma.enrollment.findMany({ where: { userId, course: { skillGraphs: { some: {} } } }, select: { courseId: true, course: { select: { slug: true, title: true } } } });
  const day = localDay(timeZone);
  const courses: { slug: string; title: string; due: number }[] = [];
  for (const { courseId, course } of enrolled) {
    const learner = learners.find((entry) => entry.courseId === courseId);
    const session = learner ? await prisma.practiceSession.findFirst({ where: { learnerId: learner.id, day, extra: false }, select: { items: true, _count: { select: { answers: true } } } }) : null;
    // An empty set is planned again on the next visit, so it counts like no set.
    if (session && (session.items as unknown as SessionItem[]).length) {
      courses.push({ ...course, due: Math.max(0, (session.items as unknown as SessionItem[]).length - session._count.answers) });
      continue;
    }
    const loaded = await loadLearner(userId, courseId);
    if (!loaded) continue;
    const summary = practice.status(loaded.state, loaded.published.graph, Date.now());
    const focus = new Set(await focusSkills(userId, courseId, loaded.published));
    // A new skill only counts once it has a task to practise it with.
    const withTasks = new Set(
      (await prisma.practiceTask.findMany({ where: { courseId, status: "PROVEN", skillKey: { in: [...focus] } }, select: { skillKey: true }, distinct: ["skillKey"] })).map((task) => task.skillKey),
    );
    const fresh = summary.skills.filter((skill) => skill.status === "ready" && focus.has(skill.skillId) && withTasks.has(skill.skillId)).length;
    courses.push({ ...course, due: summary.dueNow + Math.min(fresh, MAX_NEW_SKILLS) });
  }
  return { total: courses.reduce((sum, course) => sum + course.due, 0), courses };
}

const taskIdOf = (itemId: string) => itemId.replace(/^task:/, "");

/** Today's set (or "a few more"), planned once and kept for the day. */
export async function todaysSession(userId: string, courseId: string, day: string, extra = false) {
  const loaded = await loadLearner(userId, courseId);
  if (!loaded) return null;
  const { learner, state, published } = loaded;

  const existing = await prisma.practiceSession.findFirst({ where: { learnerId: learner.id, day, extra }, orderBy: { createdAt: "desc" } });
  // An extra set is planned anew each time the learner asks, once the previous one is finished. So is a daily set
  // that came out empty (no skill reached yet, or no task for it): a lesson completed later today should count today.
  const empty = existing && (existing.items as unknown as SessionItem[]).length === 0;
  if (existing && !empty && (!extra || !existing.completedAt)) return { session: existing, loaded };
  if (existing && empty && !extra) await prisma.practiceSession.deleteMany({ where: { id: existing.id } });

  const focus = await focusSkills(userId, courseId, published);
  const known = Object.keys(state.skills ?? {});
  const skills = [...new Set([...focus, ...known])];
  const tasks = skills.length
    ? await prisma.practiceTask.findMany({ where: { courseId, status: "PROVEN", skillKey: { in: skills } }, select: { item: true } })
    : [];
  const pool = tasks.map((task) => task.item as unknown as PracticeItem);
  const answeredToday = await prisma.practiceAnswer.findMany({ where: { session: { learnerId: learner.id, day } }, select: { taskId: true } });

  // "A few more": more practice on the skills already started, at their current stage, never new skills (the daily
  // cap holds). lk-practice counts one sitting as one review, so these answers move the skill's ability, not its
  // schedule.
  if (extra) {
    const excludedToday = new Set(answeredToday.map((row) => row.taskId));
    const started = practice.status(state, published.graph, Date.now()).skills.filter((skill) => skill.stage && skill.status !== "locked" && skill.status !== "suspended");
    const items: SessionItem[] = [];
    for (const skill of started.sort((a, b) => (a.retrievability ?? 1) - (b.retrievability ?? 1))) {
      if (items.length >= EXTRA_TARGETS) break;
      const options = tasks
        .map((task) => task.item as unknown as PracticeItem)
        .filter((item) => item.skills[0]?.skillId === skill.skillId && item.stage === skill.stage && !excludedToday.has(taskIdOf(item.id)));
      const pick = options[Math.floor(Math.random() * options.length)];
      if (pick) items.push({ targetId: `extra:${skill.skillId}:${day}`, taskId: taskIdOf(pick.id), skillKey: skill.skillId, stage: skill.stage!, kind: "extra" });
    }
    const session = await prisma.practiceSession.create({
      data: { learnerId: learner.id, day, extra, items: items as unknown as Prisma.InputJsonArray, completedAt: items.length ? null : new Date() },
    });
    return { session, loaded };
  }

  const plan = practice.plan(state, published.graph, {
    now: Date.now(),
    seed: `${learner.id}:${day}:${extra ? `extra:${Date.now()}` : "daily"}`,
    budget: { maxTargets: extra ? EXTRA_TARGETS : DAILY_TARGETS, maxSeconds: DAILY_SECONDS },
    limits: { maxNewSkills: MAX_NEW_SKILLS },
    focusSkills: focus,
    excludeItems: answeredToday.map((row) => `task:${row.taskId}`),
    pool,
  });
  const excluded = new Set(answeredToday.map((row) => row.taskId));
  const seen = new Set<string>();
  const items: SessionItem[] = [];
  for (const target of plan.targets) {
    // lk-practice picks a task within 0.5 of the target's difficulty. While a pool is thin there may be none that close:
    // then the closest proven task for the same skill and stage, not used today, stands in.
    const itemId =
      target.item?.itemId ??
      pool
        .filter((item) => item.skills[0]?.skillId === target.skillIds[0] && item.stage === target.stage && !excluded.has(taskIdOf(item.id)) && !seen.has(taskIdOf(item.id)))
        .sort((a, b) => Math.abs((a.difficulty ?? 0) - target.targetDifficulty) - Math.abs((b.difficulty ?? 0) - target.targetDifficulty))[0]?.id;
    if (!itemId) continue; // No proven task for this skill and stage yet: it waits for the pool.
    const taskId = taskIdOf(itemId);
    if (seen.has(taskId)) continue;
    seen.add(taskId);
    items.push({ targetId: target.id, taskId, skillKey: target.skillIds[0], stage: target.stage, kind: target.kind });
  }
  const session = await prisma.practiceSession.create({
    data: { learnerId: learner.id, day, extra, items: items as unknown as Prisma.InputJsonArray, completedAt: items.length ? null : new Date() },
  });
  return { session, loaded };
}

export type Answer = { index?: number; text?: string; code?: string };
export type Feedback = {
  passed: boolean;
  score: number;
  // What the learner sees back: the key for questions, the tests' results for code.
  correctIndex?: number;
  accepted?: string[];
  expectedOutput?: string;
  tests?: GradeTest[];
  error?: { type: string; message: string } | null;
  stdout?: string;
  status?: string;
};

/** Grades one answer. Throws when the grader can't be reached: nothing is recorded then. */
async function grade(content: TaskContent, answer: Answer): Promise<{ feedback: Feedback; maxScore: number; checks?: { passed: number; total: number } }> {
  switch (content.form) {
    case "choice": {
      const passed = answer.index === content.answerIndex;
      return { feedback: { passed, score: passed ? 1 : 0, correctIndex: content.answerIndex }, maxScore: 1 };
    }
    case "fill": {
      const passed = typeof answer.text === "string" && (content.answers ?? []).map(normaliseAnswer).includes(normaliseAnswer(answer.text));
      return { feedback: { passed, score: passed ? 1 : 0, accepted: content.answers }, maxScore: 1 };
    }
    case "predict": {
      const passed = typeof answer.text === "string" && sameOutput(answer.text, content.expectedOutput ?? "");
      return { feedback: { passed, score: passed ? 1 : 0, expectedOutput: content.expectedOutput }, maxScore: 1 };
    }
    case "code":
    case "debug": {
      const run = await gradeCode({ code: answer.code ?? "", tests: content.tests });
      if (run.status === "unavailable") throw new Error("The grader can't be reached right now. Your answer wasn't recorded; try again in a moment.");
      const total = Math.max(run.tests.length, 1);
      const passedTests = run.tests.filter((test) => test.passed).length;
      const passed = run.status === "passed";
      return {
        feedback: { passed, score: passed ? 1 : passedTests / total, tests: run.tests, error: run.error, stdout: run.stdout.slice(0, 4000), status: run.status },
        maxScore: 1,
        checks: { passed: passedTests, total },
      };
    }
  }
}

/**
 * A code task's test run that isn't recorded yet: the learner can edit and run again. Returns null when the task isn't
 * this learner's open task.
 */
export async function tryCode(userId: string, sessionId: string, taskId: string, code: string): Promise<Feedback | null> {
  const session = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: { items: true, learner: { select: { userId: true } }, answers: { where: { taskId }, select: { id: true } } },
  });
  if (!session || session.learner.userId !== userId || session.answers.length) return null;
  if (!(session.items as unknown as SessionItem[]).some((item) => item.taskId === taskId)) return null;
  const task = await prisma.practiceTask.findUnique({ where: { id: taskId }, select: { content: true } });
  const content = task?.content as unknown as TaskContent | undefined;
  if (!content || (content.form !== "code" && content.form !== "debug")) return null;
  return (await grade(content, { code })).feedback;
}

/** Grades and records one answer of a session; answering the same task twice returns the first answer's feedback. */
export async function answerTask(userId: string, sessionId: string, taskId: string, answer: Answer, durationMs: number, attempts = 1) {
  const session = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, items: true, learner: { select: { id: true, userId: true, courseId: true } }, answers: { select: { taskId: true, passed: true, score: true, result: true } } },
  });
  if (!session || session.learner.userId !== userId) return { ok: false as const, error: "This practice session isn't yours." };
  const items = session.items as unknown as SessionItem[];
  const entry = items.find((item) => item.taskId === taskId);
  if (!entry) return { ok: false as const, error: "That task isn't in this session." };
  const previous = session.answers.find((row) => row.taskId === taskId);
  if (previous) return { ok: true as const, feedback: previous.result as unknown as Feedback };

  const task = await prisma.practiceTask.findUnique({ where: { id: taskId }, select: { content: true, item: true } });
  if (!task?.item) return { ok: false as const, error: "That task is no longer available." };
  const content = task.content as unknown as TaskContent;
  const item = task.item as unknown as PracticeItem;
  const graded = await grade(content, answer);

  const loaded = await loadLearner(userId, session.learner.courseId);
  if (!loaded) return { ok: false as const, error: "Practice isn't set up for this course yet." };
  const answerId = randomUUID();
  const evidence: Evidence = {
    id: answerId,
    itemId: item.id,
    at: Date.now(),
    // An extra-set task wasn't planned by lk-practice: it has no target to name.
    ...(entry.kind === "extra" ? {} : { targetId: entry.targetId }),
    context: "practice",
    durationMs: Math.max(0, Math.round(durationMs)),
    attempts: Math.max(1, Math.round(attempts)),
    source: { kind: "auto", score: graded.feedback.score, maxScore: graded.maxScore, passed: graded.feedback.passed, ...(graded.checks ? { checks: graded.checks } : {}) },
  };
  const recorded = practice.record(loaded.state, { graph: loaded.published.graph, evidence, item });
  let state: PracticeState = loaded.state;
  let appended: readonly ReviewLogEntry[] = [];
  if (recorded.kind === "applied") {
    state = recorded.state;
    appended = recorded.appended;
  } else if (recorded.kind === "replay-required") {
    appended = recorded.appended;
  } else if (recorded.kind === "rejected") {
    console.error(JSON.stringify({ event: "practice.record_rejected", learnerId: loaded.learner.id, issues: recorded.issues.slice(0, 5) }));
  }

  const answeredAll = session.answers.length + 1 >= items.length;
  await prisma.$transaction([
    prisma.practiceAnswer.create({
      data: {
        id: answerId,
        sessionId,
        taskId,
        answer: answer as unknown as Prisma.InputJsonObject,
        passed: graded.feedback.passed,
        score: graded.feedback.score,
        durationMs: evidence.durationMs ?? 0,
        result: graded.feedback as unknown as Prisma.InputJsonObject,
      },
    }),
    ...(appended.length
      ? [prisma.practiceLogEntry.createMany({ data: appended.map((log) => ({ learnerId: loaded.learner.id, seq: log.seq, at: new Date(log.at), entry: log as unknown as Prisma.InputJsonObject })) })]
      : []),
    prisma.practiceLearner.update({ where: { id: loaded.learner.id }, data: { state: state as unknown as Prisma.InputJsonObject } }),
    ...(answeredAll ? [prisma.practiceSession.update({ where: { id: sessionId }, data: { completedAt: new Date() } })] : []),
  ]);

  // Evidence that arrived out of order: the log now holds it; rebuild the state from the log.
  if (recorded.kind === "replay-required") {
    const entries = await prisma.practiceLogEntry.findMany({ where: { learnerId: loaded.learner.id }, orderBy: { seq: "asc" }, select: { entry: true } });
    const replayed = practice.replay(entries.map((row) => row.entry as unknown as ReviewLogEntry), loaded.published.graph, userId);
    if (replayed.ok) await prisma.practiceLearner.update({ where: { id: loaded.learner.id }, data: { state: replayed.state as unknown as Prisma.InputJsonObject } });
  }
  return { ok: true as const, feedback: graded.feedback };
}
