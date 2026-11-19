import { randomUUID } from "node:crypto";
import type { LessonAudio } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAi } from "@/lib/ai/gemini";
import { pacificDay } from "@/lib/ai/quota";
import { VOICE_PRICES } from "@/lib/voice/deepgram";
import { writeNarration } from "@/lib/lesson-audio/script";
import { uploadLessonAudio, voiceScript } from "@/lib/lesson-audio/voice";

// The lesson-audio queue (docs/lesson-audio.md). Each lesson has at most one LessonAudio row, which moves through
//   SCRIPT_QUEUED → WRITING → REVIEW → (approved) VOICE_QUEUED → VOICING → DONE
// skipping REVIEW when the run said to voice without review (autoVoice), and ending in FAILED when a step fails on
// every attempt. The admin page queues work (actions/lesson-audio.ts); the practice worker on the lab server does it
// (runAudioTick), a lesson asked for on its own before a whole-course run, with no request time limit.

/** Lessons worked on at once. Each voicing sends a few pieces to Deepgram at once (lib/lesson-audio/voice.ts). */
const SLOTS = 2;
/** Attempts per step before the lesson counts as failed, and the pause before each retry. */
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = [60_000, 300_000];
/** Narration voicing in the AI ledger: kept apart from the tutor's speech, which counts against a learner's day. */
const LEDGER_MODEL = "deepgram-aura-2-narration";

const log = (event: string, entry: Record<string, unknown>) => logAi("info", { event, ...entry });

const QUEUED = ["SCRIPT_QUEUED", "VOICE_QUEUED"] as const;
const WORKING = ["WRITING", "VOICING"] as const;

export type QueueResult = { ok: true; queued: number } | { ok: false; error: string };

/**
 * Asks for scripts. One lesson (`lessonIds` of one): it goes first and waits for review whatever `autoVoice` says, so a
 * test can be read before anything is voiced. A whole course (no `lessonIds`): every lesson without a script yet.
 */
export async function queueScripts(input: { courseId: string; lessonIds?: string[]; model: string; voice: string; autoVoice: boolean; userId: string }): Promise<QueueResult> {
  const single = input.lessonIds?.length === 1;
  const lessons = await prisma.lesson.findMany({
    where: { module: { courseId: input.courseId }, ...(input.lessonIds ? { id: { in: input.lessonIds } } : {}) },
    orderBy: [{ module: { position: "asc" } }, { position: "asc" }],
    select: { id: true, audio: { select: { status: true, script: true } } },
  });
  const now = Date.now();
  const busy = (status?: string) => Boolean(status && [...QUEUED, ...WORKING].includes(status as never));
  const chosen = lessons.filter((lesson) => (single ? !busy(lesson.audio?.status) : !lesson.audio || (!lesson.audio.script && !busy(lesson.audio.status))));
  if (!chosen.length) return { ok: false, error: single ? "That lesson's audio is already queued or in progress." : "Every lesson already has a script, or one on its way." };
  for (const [index, lesson] of chosen.entries()) {
    const data = {
      status: "SCRIPT_QUEUED" as const,
      model: input.model,
      voice: input.voice,
      autoVoice: single ? false : input.autoVoice,
      priority: single ? 1 : 0,
      // A millisecond apart, so a course's lessons are written in course order.
      queuedAt: new Date(now + index),
      attempts: 0,
      notBefore: null,
      progress: null,
      error: null,
      requestedById: input.userId,
    };
    await prisma.lessonAudio.upsert({ where: { lessonId: lesson.id }, create: { lessonId: lesson.id, ...data }, update: data });
  }
  log("lesson-audio.queued", { courseId: input.courseId, step: "script", lessons: chosen.length, autoVoice: !single && input.autoVoice, userId: input.userId });
  return { ok: true, queued: chosen.length };
}

/**
 * Approves scripts for voicing: one (with the admin's edits, if any), or every script of a course waiting for review.
 * `voice` replaces the voice the script was asked with, when given.
 */
export async function queueVoicing(input: { courseId: string; audioId?: string; script?: string; voice?: string; userId: string }): Promise<QueueResult> {
  const rows = await prisma.lessonAudio.findMany({
    where: input.audioId ? { id: input.audioId, lesson: { module: { courseId: input.courseId } } } : { status: "REVIEW", lesson: { module: { courseId: input.courseId } } },
    orderBy: [{ lesson: { module: { position: "asc" } } }, { lesson: { position: "asc" } }],
    select: { id: true, status: true, script: true },
  });
  const ready = rows.filter((row) => row.script && !(QUEUED as readonly string[]).includes(row.status) && !(WORKING as readonly string[]).includes(row.status));
  if (!ready.length) return { ok: false, error: input.audioId ? "That script is already queued or in progress." : "No script is waiting for review." };
  const now = Date.now();
  for (const [index, row] of ready.entries()) {
    const script = input.audioId && input.script !== undefined ? input.script.trim() : undefined;
    if (script !== undefined && !script) return { ok: false, error: "The script is empty." };
    await prisma.lessonAudio.update({
      where: { id: row.id },
      data: {
        status: "VOICE_QUEUED",
        priority: input.audioId ? 1 : 0,
        queuedAt: new Date(now + index),
        attempts: 0,
        notBefore: null,
        progress: null,
        error: null,
        approvedAt: new Date(),
        approvedById: input.userId,
        ...(script !== undefined ? { script, scriptWords: script.split(/\s+/).filter(Boolean).length } : {}),
        ...(input.voice ? { voice: input.voice } : {}),
      },
    });
  }
  log("lesson-audio.queued", { courseId: input.courseId, step: "voice", lessons: ready.length, userId: input.userId });
  return { ok: true, queued: ready.length };
}

/** Saves an edited script without approving it. */
export async function saveScript(audioId: string, script: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = script.trim();
  if (!text) return { ok: false, error: "The script is empty." };
  const saved = await prisma.lessonAudio.updateMany({
    where: { id: audioId, status: { in: ["REVIEW", "DONE", "FAILED"] } },
    data: { script: text, scriptWords: text.split(/\s+/).filter(Boolean).length },
  });
  return saved.count ? { ok: true } : { ok: false, error: "The script is being worked on right now; wait until it's done." };
}

/**
 * Stops a course's queue: what hasn't started goes back to where it was (a written script to review; a lesson that had
 * nothing is taken off). Lessons in progress finish.
 */
export async function stopQueue(courseId: string): Promise<number> {
  const where = { status: { in: [...QUEUED] }, lesson: { module: { courseId } } };
  const [dropped, back] = await prisma.$transaction([
    prisma.lessonAudio.deleteMany({ where: { ...where, script: null, audioPath: null } }),
    prisma.lessonAudio.updateMany({ where: { ...where, script: { not: null } }, data: { status: "REVIEW", progress: null, notBefore: null } }),
  ]);
  // Queued for a script with audio already there (a rewrite): it keeps its audio, with nothing to review.
  const kept = await prisma.lessonAudio.updateMany({ where: { ...where, script: null }, data: { status: "DONE", progress: null, notBefore: null } });
  log("lesson-audio.stopped", { courseId, dropped: dropped.count, back: back.count + kept.count });
  return dropped.count + back.count + kept.count;
}

/** A failed lesson, queued again at the step that failed. */
export async function retryAudio(audioId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.lessonAudio.findUnique({ where: { id: audioId }, select: { status: true, script: true } });
  if (!row || row.status !== "FAILED") return { ok: false, error: "Only a failed lesson can be retried." };
  await prisma.lessonAudio.update({
    where: { id: audioId },
    data: { status: row.script ? "VOICE_QUEUED" : "SCRIPT_QUEUED", priority: 1, queuedAt: new Date(), attempts: 0, notBefore: null, error: null, progress: null, requestedById: userId },
  });
  return { ok: true };
}

/** Takes the audio off the lesson: learners stop hearing it. The script stays, to voice again later. */
export async function removeAudio(audioId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const removed = await prisma.lessonAudio.updateMany({
    where: { id: audioId, status: { notIn: [...WORKING] } },
    data: { audioPath: null, audioSeconds: null, audioScript: null, audioChars: null, audioVoice: null, voicedAt: null },
  });
  if (!removed.count) return { ok: false, error: "It's being worked on right now; wait until it's done." };
  await prisma.lessonAudio.updateMany({ where: { id: audioId, status: "DONE" }, data: { status: "REVIEW" } });
  return { ok: true };
}

// --- The worker's side --------------------------------------------------------------------------------------------

/** Takes the next lesson that may be worked on, and marks it in progress. */
async function claimNext(): Promise<LessonAudio | null> {
  const rows = await prisma.$queryRaw<LessonAudio[]>`
    UPDATE lesson_audio
    SET status = CASE WHEN status = 'SCRIPT_QUEUED' THEN 'WRITING'::"LessonAudioStatus" ELSE 'VOICING'::"LessonAudioStatus" END,
        "startedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM lesson_audio
      WHERE status IN ('SCRIPT_QUEUED', 'VOICE_QUEUED') AND ("notBefore" IS NULL OR "notBefore" <= now())
      ORDER BY priority DESC, "queuedAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return rows[0] ?? null;
}

/** "Writing part 2 of 5", on the row, for the admin page. Only while the step is still this worker's. */
const progress = (row: LessonAudio, step: "WRITING" | "VOICING") => async (note: string) => {
  await prisma.lessonAudio.updateMany({ where: { id: row.id, status: step }, data: { progress: note } });
};

/** A step that didn't finish: back in the queue after a pause, or failed after the last attempt. */
async function failStep(row: LessonAudio, step: "WRITING" | "VOICING", reason: string) {
  const queued = step === "WRITING" ? "SCRIPT_QUEUED" : "VOICE_QUEUED";
  if (row.attempts < MAX_ATTEMPTS) {
    const wait = RETRY_AFTER_MS[Math.min(row.attempts - 1, RETRY_AFTER_MS.length - 1)];
    await prisma.lessonAudio.updateMany({
      where: { id: row.id, status: step },
      data: { status: queued, notBefore: new Date(Date.now() + wait), progress: `Attempt ${row.attempts} didn't finish: ${reason}`.slice(0, 500) },
    });
  } else {
    await prisma.lessonAudio.updateMany({
      where: { id: row.id, status: step },
      data: { status: "FAILED", progress: null, error: `${step === "WRITING" ? "Writing the script" : "Voicing"} failed ${row.attempts} times: ${reason}`.slice(0, 1000) },
    });
  }
  log("lesson-audio.step", { audioId: row.id, step, attempt: row.attempts, outcome: "failed", reason: reason.slice(0, 300) });
}

async function writeStep(row: LessonAudio) {
  const result = await writeNarration({ lessonId: row.lessonId, userId: row.requestedById, model: row.model, onProgress: progress(row, "WRITING") });
  if (!result.ok) return failStep(row, "WRITING", result.error);
  await prisma.lessonAudio.updateMany({
    where: { id: row.id, status: "WRITING" },
    data: {
      script: result.script,
      scriptModel: result.model,
      scriptWords: result.words,
      scriptedAt: new Date(),
      status: row.autoVoice ? "VOICE_QUEUED" : "REVIEW",
      attempts: 0,
      progress: null,
      error: null,
      // Voiced without review: it stays in its place in the run.
      ...(row.autoVoice ? { approvedAt: new Date(), approvedById: row.requestedById } : {}),
    },
  });
  log("lesson-audio.step", { audioId: row.id, step: "WRITING", outcome: "ok", parts: result.parts, words: result.words, model: result.model });
}

async function voiceStep(row: LessonAudio) {
  if (!row.script) return failStep(row, "VOICING", "There's no script to voice.");
  const onProgress = progress(row, "VOICING");
  const { mp3, seconds, characters } = await voiceScript(row.script, row.voice, (done, total) => onProgress(`Voicing piece ${done} of ${total}`));
  await onProgress("Storing the audio");
  const revision = row.revision + 1;
  const path = await uploadLessonAudio(row.id, revision, mp3);
  await prisma.lessonAudio.updateMany({
    where: { id: row.id, status: "VOICING" },
    data: {
      status: "DONE",
      audioPath: path,
      audioSeconds: seconds,
      audioScript: row.script,
      audioChars: characters,
      audioVoice: row.voice,
      voicedAt: new Date(),
      revision,
      attempts: 0,
      progress: null,
      error: null,
    },
  });
  await prisma.aiRequest.create({
    data: {
      pool: "AUTHORING",
      feature: "narrate",
      model: LEDGER_MODEL,
      userId: row.requestedById,
      status: "OK",
      day: pacificDay(),
      inputTokens: characters,
      listCostMicros: Math.round((characters / 1000) * VOICE_PRICES.speakPer1000Chars),
      traceId: randomUUID(),
    },
  });
  log("lesson-audio.step", { audioId: row.id, step: "VOICING", outcome: "ok", seconds: Math.round(seconds), characters, bytes: mp3.length });
}

/** One pass of the worker's audio side: fills free slots with queued lessons; each runs in the background. */
export async function runAudioTick(inFlight: Map<string, Promise<void>>, stopping: boolean) {
  if (stopping) return;
  for (let slot = inFlight.size; slot < SLOTS; slot++) {
    const row = await claimNext();
    if (!row) break;
    const step = row.status === "WRITING" ? "WRITING" : "VOICING";
    const work = (step === "WRITING" ? writeStep(row) : voiceStep(row))
      .catch((error) => failStep(row, step, error instanceof Error ? error.message : String(error)))
      .catch((error) => log("lesson-audio.error", { audioId: row.id, error: String(error) }))
      .finally(() => inFlight.delete(row.id));
    inFlight.set(row.id, work);
  }
}

/** On the worker's start: lessons left in progress by a worker that stopped go back in the queue, attempt given back. */
export async function recoverAudioOrphans() {
  const [writing, voicing] = await prisma.$transaction([
    prisma.lessonAudio.updateMany({ where: { status: "WRITING" }, data: { status: "SCRIPT_QUEUED", attempts: { decrement: 1 }, progress: null } }),
    prisma.lessonAudio.updateMany({ where: { status: "VOICING" }, data: { status: "VOICE_QUEUED", attempts: { decrement: 1 }, progress: null } }),
  ]);
  if (writing.count + voicing.count) log("lesson-audio.recovered", { writing: writing.count, voicing: voicing.count });
}
