"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function getPublishedCourses(userId?: string) {
  try {
    const courses = await prisma.course.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { title: "asc" },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        language: true,
        modules: { select: { lessons: { select: { id: true, estimatedMinutes: true } } } },
      },
    });

    const enrolled = new Set<string>();
    const completed = new Set<string>();
    if (userId) {
      const [enrollments, progress] = await Promise.all([
        prisma.enrollment.findMany({ where: { userId }, select: { courseId: true } }),
        prisma.lessonProgress.findMany({ where: { userId, status: "COMPLETED" }, select: { lessonId: true } }),
      ]);
      enrollments.forEach((enrollment) => enrolled.add(enrollment.courseId));
      progress.forEach((row) => completed.add(row.lessonId));
    }

    return {
      success: true,
      data: courses.map(({ modules, ...course }) => {
        const lessons = modules.flatMap((courseModule) => courseModule.lessons);
        return {
          ...course,
          moduleCount: modules.length,
          lessonCount: lessons.length,
          totalMinutes: lessons.reduce((sum, lesson) => sum + (lesson.estimatedMinutes ?? 0), 0),
          enrolled: enrolled.has(course.id),
          completedCount: lessons.filter((lesson) => completed.has(lesson.id)).length,
        };
      }),
    };
  } catch (error) {
    console.error("Failed to fetch courses:", error);
    return { success: false, error: "Failed to fetch courses" };
  }
}

export async function getCourseBySlug(slug: string, userId?: string) {
  try {
    const course = await prisma.course.findFirst({
      where: { slug, status: "PUBLISHED" },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
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
            goals: true,
            estimatedTime: true,
            lessons: {
              orderBy: { position: "asc" },
              select: {
                id: true,
                slug: true,
                code: true,
                title: true,
                kind: true,
                estimatedTime: true,
                estimatedMinutes: true,
                prerequisites: true,
                objectives: true,
                sourcePath: true,
              },
            },
          },
        },
      },
    });
    if (!course) return { success: true, data: null };

    let enrolled = false;
    const progress: Record<string, "IN_PROGRESS" | "COMPLETED"> = {};
    if (userId) {
      const lessonIds = course.modules.flatMap((courseModule) => courseModule.lessons.map((lesson) => lesson.id));
      const [enrollment, rows] = await Promise.all([
        prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId: course.id } } }),
        prisma.lessonProgress.findMany({ where: { userId, lessonId: { in: lessonIds } }, select: { lessonId: true, status: true } }),
      ]);
      enrolled = Boolean(enrollment);
      rows.forEach((row) => (progress[row.lessonId] = row.status));
    }

    return { success: true, data: { ...course, enrolled, progress } };
  } catch (error) {
    console.error("Failed to fetch course:", error);
    return { success: false, error: "Failed to fetch course" };
  }
}

export async function enrollInCourse(courseId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Sign in to enroll" };

    const course = await prisma.course.findFirst({ where: { id: courseId, status: "PUBLISHED" }, select: { slug: true } });
    if (!course) return { success: false, error: "Course not found" };

    await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: session.user.id, courseId } },
      create: { userId: session.user.id, courseId },
      update: {},
    });
    revalidatePath("/courses");
    revalidatePath(`/courses/${course.slug}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to enroll:", error);
    return { success: false, error: "Failed to enroll" };
  }
}
