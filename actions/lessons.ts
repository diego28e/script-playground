"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export type LessonStatus = "IN_PROGRESS" | "COMPLETED";

/**
 * Everything the lesson workspace shows: the course outline (every module and lesson, with the learner's
 * progress), the open lesson in full, and its neighbours in course order.
 * `data: null` means no such published course, module or lesson.
 */
export async function getLessonWorkspace(courseSlug: string, moduleSlug: string, lessonSlug: string, userId?: string) {
  try {
    const course = await prisma.course.findFirst({
      where: { slug: courseSlug, status: "PUBLISHED" },
      select: {
        id: true,
        slug: true,
        title: true,
        language: true,
        sourceRepoUrl: true,
        sourceRef: true,
        modules: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            slug: true,
            position: true,
            title: true,
            part: true,
            lessons: {
              orderBy: { position: "asc" },
              select: { id: true, slug: true, code: true, title: true, kind: true, estimatedTime: true, sourcePath: true },
            },
          },
        },
      },
    });
    const courseModule = course?.modules.find((item) => item.slug === moduleSlug);
    const outlineLesson = courseModule?.lessons.find((item) => item.slug === lessonSlug);
    if (!course || !courseModule || !outlineLesson) return { success: true as const, data: null };

    const lesson = await prisma.lesson.findUniqueOrThrow({
      where: { id: outlineLesson.id },
      select: {
        id: true,
        slug: true,
        code: true,
        title: true,
        kind: true,
        estimatedTime: true,
        prerequisites: true,
        objectives: true,
        sourcePath: true,
        body: true,
        video: true,
      },
    });

    // Course order, across modules, for previous / next.
    const sequence = course.modules.flatMap((item) => item.lessons.map((entry) => ({ moduleSlug: item.slug, ...entry })));
    const index = sequence.findIndex((entry) => entry.id === lesson.id);
    const previous = index > 0 ? sequence[index - 1] : null;
    const next = index < sequence.length - 1 ? sequence[index + 1] : null;

    let enrolled = false;
    const progress: Record<string, LessonStatus> = {};
    let videoState: VideoState | null = null;
    if (userId) {
      const [enrollment, rows] = await Promise.all([
        prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId: course.id } } }),
        prisma.lessonProgress.findMany({
          where: { userId, lesson: { module: { courseId: course.id } } },
          select: { lessonId: true, status: true, videoState: true },
        }),
      ]);
      enrolled = Boolean(enrollment);
      for (const row of rows) {
        progress[row.lessonId] = row.status;
        if (row.lessonId === lesson.id && lesson.video) {
          const parsed = VideoStateSchema.safeParse(row.videoState);
          videoState = parsed.success ? parsed.data : null;
        }
      }
    }

    return {
      success: true as const,
      data: {
        course,
        module: { slug: courseModule.slug, position: courseModule.position, title: courseModule.title },
        lesson,
        position: { index: index + 1, total: sequence.length },
        previous: previous && { moduleSlug: previous.moduleSlug, slug: previous.slug, code: previous.code, title: previous.title },
        next: next && { moduleSlug: next.moduleSlug, slug: next.slug, code: next.code, title: next.title },
        enrolled,
        progress,
        videoState,
      },
    };
  } catch (error) {
    console.error("Failed to fetch lesson:", error);
    return { success: false as const, error: "Failed to fetch lesson" };
  }
}

/** The signed-in learner, if enrolled in the course that holds the lesson. Progress is only kept for them. */
async function enrolledLearner(lessonId: string) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return { error: "Sign in to track your progress" } as const;
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { module: { select: { slug: true, course: { select: { id: true, slug: true } } } }, slug: true },
  });
  if (!lesson) return { error: "Lesson not found" } as const;
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: session.user.id, courseId: lesson.module.course.id } },
  });
  if (!enrollment) return { error: "Enroll in the course to track your progress" } as const;
  return { userId: session.user.id, courseSlug: lesson.module.course.slug } as const;
}

/** Opening a lesson starts it (once) and always updates when it was last viewed. A completed lesson stays completed. */
export async function recordLessonOpened(lessonId: string) {
  try {
    const learner = await enrolledLearner(lessonId);
    if ("error" in learner) return { success: false, error: learner.error };
    const status = await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: learner.userId, lessonId } },
      create: { userId: learner.userId, lessonId },
      update: { lastViewedAt: new Date() },
      select: { status: true },
    });
    return { success: true, status: status.status as LessonStatus };
  } catch (error) {
    console.error("Failed to record lesson opened:", error);
    return { success: false, error: "Failed to save your progress" };
  }
}

/** Marks a lesson complete, or back to in progress. */
export async function setLessonCompleted(lessonId: string, completed: boolean) {
  try {
    const learner = await enrolledLearner(lessonId);
    if ("error" in learner) return { success: false, error: learner.error };
    const data = completed
      ? { status: "COMPLETED" as const, completedAt: new Date(), lastViewedAt: new Date() }
      : { status: "IN_PROGRESS" as const, completedAt: null, lastViewedAt: new Date() };
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: learner.userId, lessonId } },
      create: { userId: learner.userId, lessonId, ...data },
      update: data,
    });
    revalidatePath("/courses");
    revalidatePath(`/courses/${learner.courseSlug}`, "layout");
    return { success: true };
  } catch (error) {
    console.error("Failed to set lesson completion:", error);
    return { success: false, error: "Failed to save your progress" };
  }
}

/**
 * A learner's place in a lesson video, kept on their LessonProgress row: where to resume (lk-core MediaProgress),
 * each quiz answer by slot id, which were handed in, and the practice score each earned.
 */
const VideoStateSchema = z.object({
  progress: z.object({ progressVersion: z.literal("1.0"), at: z.number().min(0), furthest: z.number().min(0) }).optional(),
  responses: z.record(z.string(), z.unknown()).default({}),
  submitted: z.array(z.string()).max(200).default([]),
  scores: z.record(z.string(), z.object({ score: z.number(), maxScore: z.number(), passed: z.boolean() })).default({}),
  finishedAt: z.string().optional(),
});
export type VideoState = z.infer<typeof VideoStateSchema>;

// Answers are small; a state this large is not one the player wrote.
const VIDEO_STATE_MAX_BYTES = 64 * 1024;

/** Saves the learner's whole video state (the player sends all of it, so the latest save is always complete). */
export async function saveVideoState(lessonId: string, state: VideoState) {
  try {
    const parsed = VideoStateSchema.safeParse(state);
    if (!parsed.success || JSON.stringify(parsed.data).length > VIDEO_STATE_MAX_BYTES) {
      return { success: false, error: "Invalid video state" };
    }
    const learner = await enrolledLearner(lessonId);
    if ("error" in learner) return { success: false, error: learner.error };
    // Parsed from JSON-safe input, so it is JSON; zod's `unknown` answers just can't say so to Prisma's types.
    const videoState = parsed.data as Prisma.InputJsonObject;
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: learner.userId, lessonId } },
      create: { userId: learner.userId, lessonId, videoState },
      update: { videoState, lastViewedAt: new Date() },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save video state:", error);
    return { success: false, error: "Failed to save your progress" };
  }
}
