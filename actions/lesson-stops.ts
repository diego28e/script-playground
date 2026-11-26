"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentViewer } from "@/lib/viewer";
import { REQUEST_BUDGET_MS } from "@/lib/request-budget";
import { generateStops, STOP_MODELS } from "@/lib/lesson-stops/generate";
import type { PlayerStop } from "@/lib/lesson-stops/shared";

// Admin → Stops (docs/lesson-stops.md): which courses pause their recordings at hands-on steps, writing each
// recording's stops with a model, and reviewing them by hand.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireAdmin() {
  const viewer = await currentViewer();
  return viewer?.role === "ADMIN" ? viewer : null;
}
const denied = { success: false as const, error: "Only admins can change lesson stops." };

/** One recording a lesson has: its audio, or one of its videos. */
export type StopRecording = { media: string; label: string; seconds: number | null; stops: PlayerStop[]; author: string | null; ready: boolean; why?: string };
export type StopLesson = { id: string; code: string | null; title: string; recordings: StopRecording[] };
export type StopsOverview = {
  courses: { id: string; title: string; on: boolean }[];
  courseId: string | null;
  modules: { id: string; title: string; lessons: StopLesson[] }[];
  models: { id: string; label: string }[];
};

const toPlayer = (stop: { id: string; at: number; titleEs: string; titleEn: string; stepEs: string; stepEn: string; commands: string[] }): PlayerStop => ({
  id: stop.id,
  at: stop.at,
  titleEs: stop.titleEs,
  titleEn: stop.titleEn,
  stepEs: stop.stepEs,
  stepEn: stop.stepEn,
  commands: stop.commands,
});

/** Every course, and for the chosen one, its lessons' recordings with their stops. */
export async function getStopsOverview(courseId?: string): Promise<StopsOverview | null> {
  if (!(await requireAdmin())) return null;
  const courses = await prisma.course.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true, lessonStops: true } });
  const chosen = courses.find((course) => course.id === courseId) ?? courses[0];
  if (!chosen) return { courses: [], courseId: null, modules: [], models: [...STOP_MODELS] };
  const modules = await prisma.courseModule.findMany({
    where: { courseId: chosen.id },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      lessons: {
        where: { OR: [{ audio: { audioPath: { not: null } } }, { videos: { some: {} } }] },
        orderBy: { position: "asc" },
        select: {
          id: true,
          code: true,
          title: true,
          audio: { select: { audioPath: true, audioSeconds: true } },
          videos: { orderBy: { position: "asc" }, select: { id: true, titleEn: true, durationSeconds: true, video: true } },
          stops: { orderBy: { at: "asc" } },
        },
      },
    },
  });
  return {
    courses: courses.map((course) => ({ id: course.id, title: course.title, on: course.lessonStops })),
    courseId: chosen.id,
    models: [...STOP_MODELS],
    modules: modules
      .filter((courseModule) => courseModule.lessons.length)
      .map((courseModule) => ({
        id: courseModule.id,
        title: courseModule.title,
        lessons: courseModule.lessons.map((lesson) => {
          const of = (media: string) => lesson.stops.filter((stop) => stop.media === media);
          const recordings: StopRecording[] = [];
          if (lesson.audio?.audioPath) {
            const stops = of("audio");
            recordings.push({ media: "audio", label: "Audio lesson", seconds: lesson.audio.audioSeconds, stops: stops.map(toPlayer), author: stops[0]?.author ?? null, ready: true });
          }
          lesson.videos.forEach((video, index) => {
            const media = `video:${video.id}`;
            const stops = of(media);
            // A plain video is stored as its media (with its caption tracks); an interactive one as an item group,
            // played by lk-react's own player, which already stops at its questions.
            const stored = video.video as { type?: string; tracks?: { kind?: string }[] } | null;
            const interactive = stored?.type === "item-group";
            const captions = (stored?.tracks ?? []).some((track) => track.kind === "captions" || track.kind === "subtitles");
            const why = interactive ? "Interactive video: it stops at its own questions. Stops are for plain videos." : captions ? undefined : "No captions yet: make them in Admin → Videos first.";
            recordings.push({
              media,
              label: video.titleEn ? `Video: ${video.titleEn}` : `Video ${index + 1}`,
              seconds: video.durationSeconds,
              stops: stops.map(toPlayer),
              author: stops[0]?.author ?? null,
              ready: !why,
              ...(why ? { why } : {}),
            });
          });
          return { id: lesson.id, code: lesson.code, title: lesson.title, recordings };
        }),
      })),
  };
}

/** Turns a course's stops on or off for learners. */
export async function setCourseStops(courseId: string, on: boolean): Promise<Result> {
  if (!(await requireAdmin())) return denied;
  await prisma.course.update({ where: { id: courseId }, data: { lessonStops: Boolean(on) } });
  revalidatePath("/admin/stops");
  return { success: true };
}

/** Writes one recording's stops with a model, replacing what it had. */
export async function generateLessonStops(lessonId: string, media: string, model: string): Promise<Result<{ written: number; dropped: number; model: string }>> {
  const admin = await requireAdmin();
  if (!admin) return denied;
  const chosen = STOP_MODELS.find((entry) => entry.id === model)?.id ?? STOP_MODELS[0].id;
  try {
    const result = await generateStops({ lessonId, media, model: chosen, userId: admin.id, deadline: Date.now() + REQUEST_BUDGET_MS });
    revalidatePath("/admin/stops");
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The stops couldn't be written. Try again." };
  }
}

const StopInput = z.object({
  at: z.number().min(0).max(24 * 3600),
  titleEs: z.string().trim().min(1).max(120),
  titleEn: z.string().trim().min(1).max(120),
  stepEs: z.string().trim().min(1).max(600),
  stepEn: z.string().trim().min(1).max(600),
  commands: z.array(z.string().trim().min(1).max(300)).max(8),
});
export type StopInput = z.infer<typeof StopInput>;

/** Saves an edited stop, or adds one (no id) to a recording. */
export async function saveLessonStop(input: { id?: string; lessonId: string; media: string; stop: StopInput }): Promise<Result<{ stop: PlayerStop }>> {
  if (!(await requireAdmin())) return denied;
  const parsed = StopInput.safeParse(input.stop);
  if (!parsed.success) return { success: false, error: `The stop isn't complete: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
  const data = { ...parsed.data, author: "admin" };
  const stop = input.id
    ? await prisma.lessonStop.update({ where: { id: input.id }, data })
    : await prisma.lessonStop.create({ data: { ...data, lessonId: input.lessonId, media: input.media } });
  revalidatePath("/admin/stops");
  return { success: true, stop: toPlayer(stop) };
}

export async function deleteLessonStop(id: string): Promise<Result> {
  if (!(await requireAdmin())) return denied;
  await prisma.lessonStop.deleteMany({ where: { id } });
  revalidatePath("/admin/stops");
  return { success: true };
}
