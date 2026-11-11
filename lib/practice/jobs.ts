import { Prisma, type PracticeJob, type PracticeJobItem, type PracticeJobKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAi } from "@/lib/ai/gemini";
import { draftLesson } from "@/lib/practice/draft";
import type { PublishedGraph } from "@/lib/practice/graph";
import { generateTask } from "@/lib/practice/tasks";

// Practice jobs (docs/practice.md, "Jobs"): bulk work the admin starts and the practice worker on the lab server
// (services/practice-worker) carries out, with no request time limit, so it keeps going with the admin page closed.
//   - createPracticeJob lists the items (every published stage with no proven task, or every lesson not drafted);
//   - the worker's runWorkerTick picks the oldest active job and keeps `concurrency` items in progress, each with a
//     generous budget, retrying an item that failed for a passing reason (a model or the grader didn't answer)
//     with a pause, until every item is done, the admin stops it, or something every item would hit halts it;
//   - jobView is what the admin page polls.

/** How long one item may work in the worker: there's no request limit there, only good sense. */
export const ITEM_BUDGET_MS = 150_000;
/** Attempts per item before it counts as failed, and the pause before each retry. */
export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = [30_000, 120_000];
/** The page warns when an active job's worker has been quiet this long (it beats every few seconds while working). */
export const WORKER_QUIET_MS = 60_000;
/** Items the problem list keeps. */
const PROBLEMS = 200;

const ACTIVE = ["QUEUED", "RUNNING", "STOPPING"] as const;

const LADDER = ["recognise", "recall", "produce", "apply", "example", "complete", "write", "transfer"];
const ladderOrder = (stages: string[]) => [...stages].sort((a, b) => (LADDER.indexOf(a) === -1 ? 99 : LADDER.indexOf(a)) - (LADDER.indexOf(b) === -1 ? 99 : LADDER.indexOf(b)));

const log = (event: string, entry: Record<string, unknown>) => logAi("info", { event, ...entry });

/** The course's published stages that have no proven task yet, in course order. */
async function missingStages(courseId: string): Promise<{ skillKey: string; stage: string }[]> {
  const latest = await prisma.skillGraphVersion.findFirst({ where: { courseId }, orderBy: { version: "desc" }, select: { graph: true } });
  if (!latest) return [];
  const graph = (latest.graph as unknown as PublishedGraph).graph;
  const counts = await prisma.practiceTask.groupBy({ by: ["skillKey", "stage"], where: { courseId, status: "PROVEN" }, _count: { _all: true } });
  const proven = new Set(counts.map((row) => `${row.skillKey}\u0000${row.stage}`));
  return graph.skills.flatMap((skill) => ladderOrder(Object.keys(skill.forms ?? {})).filter((stage) => !proven.has(`${skill.id}\u0000${stage}`)).map((stage) => ({ skillKey: skill.id, stage })));
}

/** Starts a job for a course: refuses when one is already active there, or when there's nothing to do. */
export async function createPracticeJob(input: { courseId: string; kind: PracticeJobKind; userId: string; model?: string }): Promise<{ ok: true; job: PracticeJob; items: number } | { ok: false; error: string }> {
  const active = await prisma.practiceJob.findFirst({ where: { courseId: input.courseId, status: { in: [...ACTIVE] } }, select: { id: true } });
  if (active) return { ok: false, error: "A job is already running for this course. Stop it first, or wait for it to finish." };

  let items: Omit<Prisma.PracticeJobItemCreateManyInput, "jobId">[];
  if (input.kind === "WRITE_TASKS") {
    items = (await missingStages(input.courseId)).map(({ skillKey, stage }, position) => ({ position, skillKey, stage, label: `${skillKey} · ${stage}` }));
  } else {
    const lessons = await prisma.lesson.findMany({
      where: { module: { courseId: input.courseId }, practiceDraft: null },
      orderBy: [{ module: { position: "asc" } }, { position: "asc" }],
      select: { id: true, code: true, title: true },
    });
    items = lessons.map((lesson, position) => ({ position, lessonId: lesson.id, label: lesson.code ?? lesson.title.replaceAll("`", "") }));
  }
  if (!items.length) return { ok: false, error: input.kind === "WRITE_TASKS" ? "Every published stage already has a proven task." : "Every lesson is drafted." };

  const job = await prisma.practiceJob.create({
    data: { courseId: input.courseId, kind: input.kind, model: input.model, concurrency: input.kind === "WRITE_TASKS" ? 2 : 1, createdById: input.userId },
  });
  // In chunks: a course can have thousands of stages.
  for (let at = 0; at < items.length; at += 1000) {
    await prisma.practiceJobItem.createMany({ data: items.slice(at, at + 1000).map((item) => ({ ...item, jobId: job.id })) });
  }
  log("practice.job.created", { jobId: job.id, courseId: input.courseId, kind: input.kind, items: items.length, userId: input.userId });
  return { ok: true, job, items: items.length };
}

/** Stop: a queued job stops at once; a running one finishes the items in progress first (the worker sees STOPPING). */
export async function stopPracticeJob(jobId: string): Promise<boolean> {
  const queued = await prisma.practiceJob.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "STOPPED", finishedAt: new Date() } });
  if (queued.count) return true;
  const running = await prisma.practiceJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: "STOPPING" } });
  return running.count > 0;
}

/** What the admin page shows of a course's latest job. */
export async function jobView(courseId: string) {
  const job = await prisma.practiceJob.findFirst({ where: { courseId }, orderBy: { createdAt: "desc" } });
  if (!job) return null;
  const [byStatus, running, problems] = await Promise.all([
    prisma.practiceJobItem.groupBy({ by: ["status"], where: { jobId: job.id }, _count: { _all: true } }),
    prisma.practiceJobItem.findMany({ where: { jobId: job.id, status: "RUNNING" }, orderBy: { position: "asc" }, select: { label: true, attempts: true, startedAt: true } }),
    prisma.practiceJobItem.findMany({
      where: { jobId: job.id, OR: [{ status: { in: ["REJECTED", "FAILED"] } }, { status: "PENDING", attempts: { gt: 0 } }] },
      orderBy: { finishedAt: "desc" },
      take: PROBLEMS,
      select: { label: true, status: true, attempts: true, result: true },
    }),
  ]);
  const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
  const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
  const finished = count("OK") + count("REJECTED") + count("FAILED");
  const active = (ACTIVE as readonly string[]).includes(job.status);
  // Since the job started, how long each finished item has taken on average, for "about … left".
  const elapsed = job.startedAt ? (Date.now() - job.startedAt.getTime()) / 1000 : 0;
  const left = active && finished > 0 && elapsed > 0 ? Math.round((elapsed / finished) * (total - finished)) : null;
  const quiet = active && (job.heartbeatAt ? Date.now() - job.heartbeatAt.getTime() > WORKER_QUIET_MS : Date.now() - job.createdAt.getTime() > 30_000);
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    active,
    error: job.error,
    total,
    counts: { ok: count("OK"), rejected: count("REJECTED"), failed: count("FAILED"), pending: count("PENDING"), running: count("RUNNING") },
    running: running.map((item) => ({ label: item.label, attempt: item.attempts, since: item.startedAt?.toISOString() ?? null })),
    problems: problems.map((item) => ({ label: item.label, status: item.status, attempts: item.attempts, why: item.result ?? "" })),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    secondsLeft: left,
    // The worker hasn't been heard from: it isn't running, or it's stuck (the page says so).
    workerQuiet: quiet,
  };
}
export type PracticeJobView = NonNullable<Awaited<ReturnType<typeof jobView>>>;

// --- The worker's side --------------------------------------------------------------------------------------------

/** Takes the next item that may run (one at a time, so two workers never take the same one). */
async function claimNext(jobId: string): Promise<PracticeJobItem | null> {
  const rows = await prisma.$queryRaw<PracticeJobItem[]>`
    UPDATE practice_job_item SET status = 'RUNNING', "startedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM practice_job_item
      WHERE "jobId" = ${jobId} AND status = 'PENDING' AND ("notBefore" IS NULL OR "notBefore" <= now())
      ORDER BY position LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return rows[0] ?? null;
}

/** An outcome every later item would hit too: the job halts instead of failing item after item. */
const HALTS = /allowance|isn't published|not published/i;

type Outcome = { status: "OK" | "REJECTED"; result: string; model?: string } | { status: "RETRY"; result: string } | { status: "HALT"; result: string };

/** Does one item. Never throws: a throw is a passing failure, retried. */
async function doItem(job: PracticeJob, item: PracticeJobItem): Promise<Outcome> {
  try {
    if (job.kind === "WRITE_TASKS") {
      const result = await generateTask({ courseId: job.courseId, skillKey: item.skillKey!, stage: item.stage!, userId: job.createdById, deadline: Date.now() + ITEM_BUDGET_MS });
      if (result.ok) return { status: "OK", result: result.note || "written and proven", model: result.model };
      if (HALTS.test(result.error)) return { status: "HALT", result: result.error };
      // Stored as rejected: the task didn't pass its proof, a real outcome. Anything else (no model answered, the
      // grader didn't, a repeat of a task the pool has) is worth another try.
      if (result.taskId) return { status: "REJECTED", result: result.error, model: result.model };
      return { status: "RETRY", result: result.error };
    }
    const result = await draftLesson(item.lessonId!, job.createdById, job.model ?? undefined, ITEM_BUDGET_MS);
    if (result.ok) return { status: "OK", result: `${result.skills} skills, ${result.edges} prerequisites`, model: result.model };
    if (HALTS.test(result.error)) return { status: "HALT", result: result.error };
    return { status: "RETRY", result: result.error };
  } catch (error) {
    return { status: "RETRY", result: error instanceof Error ? error.message : String(error) };
  }
}

/** Records an item's outcome: done, or back in the queue for a retry after a pause, or failed after the last attempt. */
async function finishItem(job: PracticeJob, item: PracticeJobItem, outcome: Outcome) {
  const now = new Date();
  if (outcome.status === "OK" || outcome.status === "REJECTED") {
    await prisma.practiceJobItem.update({ where: { id: item.id }, data: { status: outcome.status, result: outcome.result.slice(0, 1000), model: outcome.model, finishedAt: now } });
  } else if (outcome.status === "RETRY" && item.attempts < MAX_ATTEMPTS) {
    const wait = RETRY_AFTER_MS[Math.min(item.attempts - 1, RETRY_AFTER_MS.length - 1)];
    await prisma.practiceJobItem.update({ where: { id: item.id }, data: { status: "PENDING", notBefore: new Date(now.getTime() + wait), result: `Attempt ${item.attempts} didn't finish: ${outcome.result}`.slice(0, 1000) } });
  } else {
    await prisma.practiceJobItem.update({ where: { id: item.id }, data: { status: "FAILED", result: `After ${item.attempts} attempts: ${outcome.result}`.slice(0, 1000), finishedAt: now } });
  }
  if (outcome.status === "HALT") {
    await prisma.practiceJob.updateMany({ where: { id: job.id, status: { in: ["RUNNING", "STOPPING"] } }, data: { status: "HALTED", error: outcome.result.slice(0, 1000), finishedAt: now } });
  }
  log("practice.job.item", { jobId: job.id, item: item.label, attempt: item.attempts, outcome: outcome.status, result: outcome.result.slice(0, 300) });
}

/** The worker's state between ticks: the items in progress, by job. */
export type WorkerState = { inFlight: Map<string, Promise<void>>; stopping: boolean };

/**
 * One pass of the worker: picks the oldest active job, beats its heart, fills free slots with items, and closes the
 * job when it's done or stopped. Items run in the background (state.inFlight); the next tick sees their results.
 */
export async function runWorkerTick(state: WorkerState) {
  const job = await prisma.practiceJob.findFirst({ where: { status: { in: [...ACTIVE] } }, orderBy: { createdAt: "asc" } });
  if (!job) return;
  const now = new Date();
  if (job.status === "QUEUED") {
    await prisma.practiceJob.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: job.startedAt ?? now, heartbeatAt: now } });
    log("practice.job.started", { jobId: job.id, kind: job.kind });
  } else {
    await prisma.practiceJob.update({ where: { id: job.id }, data: { heartbeatAt: now } });
  }

  const mine = [...state.inFlight.keys()].filter((key) => key.startsWith(`${job.id}:`)).length;
  if (job.status !== "STOPPING" && !state.stopping) {
    for (let slot = mine; slot < job.concurrency; slot++) {
      const item = await claimNext(job.id);
      if (!item) break;
      const key = `${job.id}:${item.id}`;
      const work = doItem(job, item)
        .then((outcome) => finishItem(job, item, outcome))
        .catch((error) => log("practice.job.error", { jobId: job.id, item: item.label, error: String(error) }))
        .finally(() => state.inFlight.delete(key));
      state.inFlight.set(key, work);
    }
  }

  // Close the job when nothing is left to do here.
  const stillMine = [...state.inFlight.keys()].some((key) => key.startsWith(`${job.id}:`));
  if (stillMine) return;
  if (job.status === "STOPPING") {
    await prisma.practiceJob.update({ where: { id: job.id }, data: { status: "STOPPED", finishedAt: new Date() } });
    log("practice.job.finished", { jobId: job.id, status: "STOPPED" });
    return;
  }
  const open = await prisma.practiceJobItem.count({ where: { jobId: job.id, status: { in: ["PENDING", "RUNNING"] } } });
  if (open === 0) {
    await prisma.practiceJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "DONE", finishedAt: new Date() } });
    log("practice.job.finished", { jobId: job.id, status: "DONE" });
  }
}

/**
 * On the worker's start: items left RUNNING by a worker that stopped mid-item go back in the queue (there is one
 * worker, so anything RUNNING now is orphaned). Their attempt is given back.
 */
export async function recoverOrphans() {
  const recovered = await prisma.practiceJobItem.updateMany({ where: { status: "RUNNING" }, data: { status: "PENDING", attempts: { decrement: 1 } } });
  if (recovered.count) log("practice.job.recovered", { items: recovered.count });
}
