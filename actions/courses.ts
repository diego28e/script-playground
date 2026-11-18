"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { courseVisibleTo } from "@/lib/course-access";
import { currentViewer } from "@/lib/viewer";

// Who is asking is read from the session here, never taken as an argument: these are server actions, so an argument
// could come from anyone. A private course is only ever returned to the people it is for (lib/course-access.ts).

/** The catalog: the published courses the person may see, with their own progress when signed in. */
export async function getPublishedCourses() {
  try {
    const viewer = await currentViewer();
    const userId = viewer?.id;
    const courses = await prisma.course.findMany({
      where: { status: "PUBLISHED", ...courseVisibleTo(viewer) },
      orderBy: { title: "asc" },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        language: true,
        visibility: true,
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

/** A course's page. `data: null` means there's no such course for this person: unpublished, private, or not there. */
export async function getCourseBySlug(slug: string) {
  try {
    const viewer = await currentViewer();
    const userId = viewer?.id;
    const course = await prisma.course.findFirst({
      where: { slug, status: "PUBLISHED", ...courseVisibleTo(viewer) },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        language: true,
        visibility: true,
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
    const viewer = await currentViewer();
    if (!viewer) return { success: false, error: "Sign in to enroll" };

    const course = await prisma.course.findFirst({ where: { id: courseId, status: "PUBLISHED", ...courseVisibleTo(viewer) }, select: { slug: true } });
    if (!course) return { success: false, error: "Course not found" };

    await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: viewer.id, courseId } },
      create: { userId: viewer.id, courseId },
      update: {},
    });
    revalidatePath("/courses");
    // "layout" also refreshes the course's lesson pages under it.
    revalidatePath(`/courses/${course.slug}`, "layout");
    return { success: true };
  } catch (error) {
    console.error("Failed to enroll:", error);
    return { success: false, error: "Failed to enroll" };
  }
}
