"use server";

import { revalidatePath } from "next/cache";
import type { LessonAudioStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { currentViewer } from "@/lib/viewer";
import { resolveMediaUrls } from "@/lib/media";
import { DEFAULT_NARRATION_MODEL, isNarrationModel, NARRATION_MODELS } from "@/lib/lesson-audio/script";
import { DEFAULT_VOICES, ELEVEN_MODEL, ELEVEN_PER_1000, estimatedSeconds, isNarrationVoice, mp3Frames, NARRATION_VOICES, voiceCost, voiceProvider, type NarrationVoice } from "@/lib/lesson-audio/voice";
import { queueRevoice, queueScripts, queueVoicing, removeAudio, retryAudio, saveScript, stopQueue } from "@/lib/lesson-audio/queue";
import { VOICE_PRICES } from "@/lib/voice/deepgram";

// Admin → Audio (docs/lesson-audio.md): queue scripts and voicing, review scripts, listen. The work itself is done by
// the practice worker (lib/lesson-audio/queue.ts); these only read and change the queue.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireAdmin() {
  const viewer = await currentViewer();
  return viewer?.role === "ADMIN" ? viewer : null;
}
const notAdmin = { success: false as const, error: "Only admins can manage lesson audio." };

/** The pages that play a course's audio, read again after it changes. */
async function refreshCourse(courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { slug: true } });
  if (course) revalidatePath(`/courses/${course.slug}`, "layout");
}

// The ElevenLabs voices' names and descriptions, read from ElevenLabs once per server process (their ids are in
// lib/lesson-audio/voice.ts). A voice that can't be read keeps its placeholder name.
let elevenNames: Promise<Map<string, { name: string; note: string }>> | null = null;
function readElevenNames() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Promise.resolve(new Map<string, { name: string; note: string }>());
  elevenNames ??= Promise.all(
    NARRATION_VOICES.filter((voice) => voice.provider === "elevenlabs").map(async (voice) => {
      try {
        const response = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voice.id)}`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return null;
        const data = (await response.json()) as { name?: string; labels?: Record<string, string>; description?: string | null };
        const labels = data.labels ?? {};
        const note = [labels.gender, labels.accent, labels.age, labels.descriptive ?? labels.description, labels.use_case].filter(Boolean).join(", ");
        return [voice.id, { name: (data.name ?? voice.label).split(/\s[-–—]\s/)[0].trim(), note: (note || (data.description ?? "").slice(0, 80)).replaceAll("_", " ") }] as const;
      } catch {
        return null;
      }
    }),
  ).then((entries) => {
    const found = new Map(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));
    // None read (a key problem, a blip): try again on the next visit.
    if (!found.size) elevenNames = null;
    return found;
  });
  return elevenNames;
}

/** What the page offers to choose from. */
export async function getAudioOptions() {
  if (!(await requireAdmin())) return null;
  const [courses, names] = await Promise.all([
    prisma.course.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true, language: true, visibility: true } }),
    readElevenNames(),
  ]);
  const voices: NarrationVoice[] = NARRATION_VOICES.map((voice) => {
    const named = names.get(voice.id);
    return named ? { ...voice, label: named.name, note: named.note || voice.note } : voice;
  });
  return {
    courses,
    models: NARRATION_MODELS.map(({ model, label, price }) => ({ id: model, label, price })),
    voices,
    defaults: { model: DEFAULT_NARRATION_MODEL, voices: DEFAULT_VOICES },
    // US$ per 1,000 characters voiced, by provider.
    prices: { deepgram: VOICE_PRICES.speakPer1000Chars / 1_000_000, elevenlabs: ELEVEN_PER_1000 },
    elevenModel: ELEVEN_MODEL,
    elevenConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
  };
}

export type AudioLessonRow = {
  lessonId: string;
  code: string | null;
  title: string;
  kind: string;
  /** About how many characters of lesson text there are: an idea of how long the audio will be. */
  sourceChars: number | null;
  audio: {
    id: string;
    status: LessonAudioStatus;
    progress: string | null;
    error: string | null;
    model: string;
    voice: string;
    autoVoice: boolean;
    scriptWords: number | null;
    scriptChars: number | null;
    scriptModel: string | null;
    scriptedAt: string | null;
    hasAudio: boolean;
    audioSeconds: number | null;
    audioVoice: string | null;
    voicedAt: string | null;
    updatedAt: string;
  } | null;
};

/** A course's lessons with their audio, for the page, which polls it while anything is queued or in progress. */
export async function getAudioOverview(courseId: string) {
  if (!(await requireAdmin())) return null;
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      language: true,
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
              kind: true,
              audio: {
                select: {
                  id: true,
                  status: true,
                  progress: true,
                  error: true,
                  model: true,
                  voice: true,
                  autoVoice: true,
                  scriptWords: true,
                  scriptModel: true,
                  scriptedAt: true,
                  audioPath: true,
                  audioSeconds: true,
                  audioVoice: true,
                  voicedAt: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!course) return null;
  const lessonIds = course.modules.flatMap((courseModule) => courseModule.lessons.map((lesson) => lesson.id));
  // Lengths without loading every text: the body's size, and the script's.
  const [bodies, scripts] = await Promise.all([
    prisma.$queryRaw<{ id: string; chars: number | null }[]>`SELECT id, length(body) AS chars FROM lesson WHERE id = ANY(${lessonIds})`,
    prisma.$queryRaw<{ lessonId: string; chars: number | null }[]>`SELECT "lessonId", length(script) AS chars FROM lesson_audio WHERE "lessonId" = ANY(${lessonIds})`,
  ]);
  const bodyChars = new Map(bodies.map((row) => [row.id, row.chars === null ? null : Number(row.chars)]));
  const scriptChars = new Map(scripts.map((row) => [row.lessonId, row.chars === null ? null : Number(row.chars)]));

  const modules = course.modules.map((courseModule) => ({
    id: courseModule.id,
    position: courseModule.position,
    title: courseModule.title,
    lessons: courseModule.lessons.map(
      (lesson): AudioLessonRow => ({
        lessonId: lesson.id,
        code: lesson.code,
        title: lesson.title.replaceAll("`", ""),
        kind: lesson.kind,
        sourceChars: bodyChars.get(lesson.id) ?? null,
        audio: lesson.audio && {
          id: lesson.audio.id,
          status: lesson.audio.status,
          progress: lesson.audio.progress,
          error: lesson.audio.error,
          model: lesson.audio.model,
          voice: lesson.audio.voice,
          autoVoice: lesson.audio.autoVoice,
          scriptWords: lesson.audio.scriptWords,
          scriptChars: scriptChars.get(lesson.id) ?? null,
          scriptModel: lesson.audio.scriptModel,
          scriptedAt: lesson.audio.scriptedAt?.toISOString() ?? null,
          hasAudio: Boolean(lesson.audio.audioPath),
          audioSeconds: lesson.audio.audioSeconds,
          audioVoice: lesson.audio.audioVoice,
          voicedAt: lesson.audio.voicedAt?.toISOString() ?? null,
          updatedAt: lesson.audio.updatedAt.toISOString(),
        },
      }),
    ),
  }));
  const rows = modules.flatMap((courseModule) => courseModule.lessons);
  const count = (statuses: LessonAudioStatus[]) => rows.filter((row) => row.audio && statuses.includes(row.audio.status)).length;
  const working = rows.filter((row) => row.audio && (row.audio.status === "WRITING" || row.audio.status === "VOICING"));
  const queued = count(["SCRIPT_QUEUED", "VOICE_QUEUED"]);
  // Something has waited a while and nothing is being worked on, or the work in progress hasn't moved: the worker may be down.
  const lastMove = Math.max(0, ...rows.map((row) => (row.audio ? Date.parse(row.audio.updatedAt) : 0)));
  const workerQuiet = (queued > 0 || working.length > 0) && Date.now() - lastMove > 3 * 60_000;
  const inReview = rows.filter((row) => row.audio?.status === "REVIEW");
  return {
    course: { id: course.id, title: course.title, language: course.language },
    modules,
    counts: {
      lessons: rows.length,
      queued,
      working: working.length,
      review: count(["REVIEW"]),
      done: rows.filter((row) => row.audio?.hasAudio).length,
      failed: count(["FAILED"]),
      withoutScript: rows.filter((row) => !row.audio || (!row.audio.scriptWords && row.audio.status !== "SCRIPT_QUEUED" && row.audio.status !== "WRITING")).length,
    },
    totals: {
      seconds: rows.reduce((sum, row) => sum + (row.audio?.audioSeconds ?? 0), 0),
      // What voicing every script waiting for review would cost.
      reviewCost: inReview.reduce((sum, row) => sum + voiceCost(row.audio?.scriptChars ?? 0, row.audio!.voice), 0),
      reviewSeconds: inReview.reduce((sum, row) => sum + estimatedSeconds(row.audio?.scriptChars ?? 0, row.audio!.voice), 0),
      // Every voiced lesson's script length and voice, for what recording them again would cost.
      voiced: rows
        .filter((row) => row.audio?.hasAudio && !["SCRIPT_QUEUED", "WRITING", "VOICE_QUEUED", "VOICING"].includes(row.audio.status))
        .map((row) => ({ chars: row.audio!.scriptChars ?? 0, voice: row.audio!.audioVoice })),
    },
    workerQuiet,
  };
}
export type AudioOverview = NonNullable<Awaited<ReturnType<typeof getAudioOverview>>>;

/** One script in full, for review, with its lesson and how much voicing it would cost. */
export async function getAudioScript(audioId: string) {
  if (!(await requireAdmin())) return null;
  const audio = await prisma.lessonAudio.findUnique({
    where: { id: audioId },
    select: { id: true, status: true, script: true, scriptModel: true, scriptWords: true, voice: true, delivery: true, audioVoice: true, audioDirected: true, lesson: { select: { code: true, title: true } } },
  });
  if (!audio) return null;
  return { ...audio, lesson: { code: audio.lesson.code, title: audio.lesson.title.replaceAll("`", "") } };
}

/** The voiced audio, signed for the admin page's player. */
export async function getAudioForAdmin(audioId: string): Promise<Result<{ url: string; seconds: number | null }>> {
  if (!(await requireAdmin())) return notAdmin;
  const audio = await prisma.lessonAudio.findUnique({ where: { id: audioId }, select: { audioPath: true, audioSeconds: true } });
  if (!audio?.audioPath) return { success: false, error: "This lesson has no audio yet." };
  return { success: true, url: resolveMediaUrls(audio.audioPath), seconds: audio.audioSeconds };
}

const checkChoice = (model: string, voice: string) =>
  !isNarrationModel(model) ? "Choose one of the listed models." : !isNarrationVoice(voice) ? "Choose one of the listed voices." : null;

/** One lesson's script, written first and kept for review. */
export async function requestLessonScript(courseId: string, lessonId: string, model: string, voice: string, delivery = true): Promise<Result<{ queued: number }>> {
  const admin = await requireAdmin();
  if (!admin) return notAdmin;
  const problem = checkChoice(model, voice);
  if (problem) return { success: false, error: problem };
  const result = await queueScripts({ courseId, lessonIds: [lessonId], model, voice, autoVoice: false, delivery, userId: admin.id });
  return result.ok ? { success: true, queued: result.queued } : { success: false, error: result.error };
}

/** Every lesson of the course without a script; voiced right after, without review, when `autoVoice`. */
export async function requestCourseScripts(courseId: string, model: string, voice: string, autoVoice: boolean, delivery = true): Promise<Result<{ queued: number }>> {
  const admin = await requireAdmin();
  if (!admin) return notAdmin;
  const problem = checkChoice(model, voice);
  if (problem) return { success: false, error: problem };
  const result = await queueScripts({ courseId, model, voice, autoVoice, delivery, userId: admin.id });
  return result.ok ? { success: true, queued: result.queued } : { success: false, error: result.error };
}

/** Approves one script for voicing, with the admin's edits. */
export async function approveLessonScript(courseId: string, audioId: string, script: string, voice: string, delivery = true): Promise<Result<{ queued: number }>> {
  const admin = await requireAdmin();
  if (!admin) return notAdmin;
  if (!isNarrationVoice(voice)) return { success: false, error: "Choose one of the listed voices." };
  const result = await queueVoicing({ courseId, audioId, script, voice, delivery, userId: admin.id });
  return result.ok ? { success: true, queued: result.queued } : { success: false, error: result.error };
}

/** Approves every script of the course waiting for review. */
export async function approveCourseScripts(courseId: string, voice: string, delivery = true): Promise<Result<{ queued: number }>> {
  const admin = await requireAdmin();
  if (!admin) return notAdmin;
  if (!isNarrationVoice(voice)) return { success: false, error: "Choose one of the listed voices." };
  const result = await queueVoicing({ courseId, voice, delivery, userId: admin.id });
  return result.ok ? { success: true, queued: result.queued } : { success: false, error: result.error };
}

/** Records again every voiced lesson of the course read by another voice (or all of them), with `voice`. */
export async function revoiceCourse(courseId: string, voice: string, delivery: boolean, all: boolean): Promise<Result<{ queued: number }>> {
  const admin = await requireAdmin();
  if (!admin) return notAdmin;
  if (!isNarrationVoice(voice)) return { success: false, error: "Choose one of the listed voices." };
  const result = await queueRevoice({ courseId, voice, delivery, all, userId: admin.id });
  return result.ok ? { success: true, queued: result.queued } : { success: false, error: result.error };
}

export async function saveLessonScript(audioId: string, script: string): Promise<Result> {
  if (!(await requireAdmin())) return notAdmin;
  const result = await saveScript(audioId, script);
  return result.ok ? { success: true } : { success: false, error: result.error };
}

export async function stopCourseAudio(courseId: string): Promise<Result<{ stopped: number }>> {
  if (!(await requireAdmin())) return notAdmin;
  return { success: true, stopped: await stopQueue(courseId) };
}

export async function retryLessonAudio(audioId: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return notAdmin;
  const result = await retryAudio(audioId, admin.id);
  return result.ok ? { success: true } : { success: false, error: result.error };
}

export async function removeLessonAudio(courseId: string, audioId: string): Promise<Result> {
  if (!(await requireAdmin())) return notAdmin;
  const result = await removeAudio(audioId);
  if (result.ok) await refreshCourse(courseId);
  return result.ok ? { success: true } : { success: false, error: result.error };
}

const SAMPLES: Record<string, string> = {
  en: "Here's the idea in one sentence. A NAT gateway is one more hop, with a route table of its own, standing in one place. So when something breaks, ask two questions: where does it stand, and what does its own route say?",
  es: "Aquí va la idea en una frase. Un NAT gateway es un salto más, con su propia route table, en un solo lugar. Así que cuando algo falla, hazte dos preguntas: ¿dónde está, y qué dice su propia ruta?",
};
// The same lines with a teacher's delivery, as the delivery step writes it (lib/lesson-audio/delivery.ts), so the
// sample sounds like a lesson will.
const DIRECTED_SAMPLES: Record<string, string> = {
  en: "[warmly] Here's the idea in one sentence. [slower, deliberate] A NAT gateway is ONE more hop, with a route table of its own, standing in one place. [short pause] So when something breaks... ask two questions: where does it stand, and what does its OWN route say?",
  es: "[warmly] Aquí va la idea en una frase. [slower, deliberate] Un NAT gateway es UN salto más, con su propia route table, en un solo lugar. [short pause] Así que cuando algo falla... hazte dos preguntas: ¿dónde está, y qué dice su PROPIA ruta?",
};

/** A few seconds of a voice, to choose it by ear (about US$0.006 on Deepgram, US$0.02 on ElevenLabs). An MP3 as a data URL. */
export async function previewVoice(voice: string, language = "en"): Promise<Result<{ src: string }>> {
  if (!(await requireAdmin())) return notAdmin;
  const entry = NARRATION_VOICES.find((item) => item.id === voice);
  if (!entry) return { success: false, error: "Choose one of the listed voices." };
  const lang = entry.language === "any" ? (language === "es" ? "es" : "en") : entry.language;
  if (voiceProvider(voice) === "elevenlabs") {
    const elevenKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenKey) return { success: false, error: "ELEVENLABS_API_KEY is not set on the platform." };
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_96`, {
        method: "POST",
        headers: { "xi-api-key": elevenKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: DIRECTED_SAMPLES[lang], model_id: ELEVEN_MODEL, language_code: lang }),
        signal: AbortSignal.timeout(24_000),
      });
      if (!response.ok) return { success: false, error: `ElevenLabs answered ${response.status}: ${(await response.text().catch(() => "")).slice(0, 160)}` };
      const { frames } = mp3Frames(new Uint8Array(await response.arrayBuffer()));
      return { success: true, src: `data:audio/mpeg;base64,${Buffer.from(frames).toString("base64")}` };
    } catch {
      return { success: false, error: "ElevenLabs didn't answer in time. Try again." };
    }
  }
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { success: false, error: "DEEPGRAM_API_KEY is not set." };
  try {
    const response = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3&bit_rate=48000`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: SAMPLES[lang] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { success: false, error: `Deepgram answered ${response.status}.` };
    const { frames } = mp3Frames(new Uint8Array(await response.arrayBuffer()));
    return { success: true, src: `data:audio/mpeg;base64,${Buffer.from(frames).toString("base64")}` };
  } catch {
    return { success: false, error: "Deepgram didn't answer in time. Try again." };
  }
}
