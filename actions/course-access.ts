"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CourseStatus, CourseVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accessEmail } from "@/lib/course-access";
import { PRACTICE_LANGUAGES, practiceLanguage, type PracticeLanguage } from "@/lib/practice/language";
import { currentViewer } from "@/lib/viewer";

// Admin → Courses (docs/private-courses.md): who can see each course. A course is public, or private with a list of
// the emails that may open it. The rule itself is lib/course-access.ts; this only edits what it reads.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

/** Emails one "add" may carry: pasted lists are welcome, a whole mailing list is not what this is for. */
const MAX_EMAILS = 200;

async function requireAdmin() {
  const viewer = await currentViewer();
  return viewer?.role === "ADMIN" ? viewer : null;
}

export type CourseAccessEntry = {
  id: string;
  email: string;
  /** none: nobody has signed in with it yet. unverified: an account whose email its provider didn't verify, so it doesn't open the course. */
  account: "ready" | "unverified" | "none";
  name: string | null;
  enrolled: boolean;
};

export type AdminCourse = {
  id: string;
  slug: string;
  title: string;
  status: CourseStatus;
  visibility: CourseVisibility;
  /** The widgets beside the course's practice (docs/practice.md, "Widgets"). */
  practiceScratchbook: boolean;
  practiceVoice: boolean;
  /** The language of its code practice: the scratchbook's, and new code tasks' (docs/practice.md, "Languages"). */
  practiceLanguage: PracticeLanguage;
  /** Whether its lessons' "## Solutions" sections are folded behind "Show solutions" (docs/lesson-solutions.md). */
  foldSolutions: boolean;
  moduleCount: number;
  lessonCount: number;
  enrolledCount: number;
  /** Enrolled people a private course is closed to: not on its list, not an admin. */
  enrolledOutside: number;
  access: CourseAccessEntry[];
};

/** Every course, drafts too, with who may see it. */
export async function listCoursesForAdmin(): Promise<AdminCourse[]> {
  if (!(await requireAdmin())) return [];
  const courses = await prisma.course.findMany({
    orderBy: { title: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      visibility: true,
      practiceScratchbook: true,
      practiceVoice: true,
      practiceLanguage: true,
      foldSolutions: true,
      access: { orderBy: { createdAt: "asc" }, select: { id: true, email: true } },
      modules: { select: { _count: { select: { lessons: true } } } },
      _count: { select: { enrollments: true } },
    },
  });
  const emails = [...new Set(courses.flatMap((course) => course.access.map((entry) => entry.email)))];
  const users = emails.length
    ? await prisma.user.findMany({
        // Addresses are stored as their provider gave them, so compare without case.
        where: { OR: emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
        select: { email: true, name: true, emailVerified: true, enrollments: { select: { courseId: true } } },
      })
    : [];
  const byEmail = new Map(users.map((user) => [accessEmail(user.email), user]));

  return Promise.all(
    courses.map(async ({ access, modules, _count, ...course }) => ({
      ...course,
      practiceLanguage: practiceLanguage(course.practiceLanguage),
      moduleCount: modules.length,
      lessonCount: modules.reduce((sum, courseModule) => sum + courseModule._count.lessons, 0),
      enrolledCount: _count.enrollments,
      enrolledOutside: _count.enrollments
        ? await prisma.enrollment.count({
            where: {
              courseId: course.id,
              user: { role: { not: "ADMIN" }, NOT: access.map((entry) => ({ email: { equals: entry.email, mode: "insensitive" as const } })) },
            },
          })
        : 0,
      access: access.map((entry) => {
        const user = byEmail.get(entry.email);
        return {
          ...entry,
          account: user ? (user.emailVerified ? ("ready" as const) : ("unverified" as const)) : ("none" as const),
          name: user?.name ?? null,
          enrolled: Boolean(user?.enrollments.some((enrollment) => enrollment.courseId === course.id)),
        };
      }),
    })),
  );
}

/** The pages that show a course, or leave it out, read again after its access changes. */
function refresh(slug: string) {
  revalidatePath("/courses");
  revalidatePath(`/courses/${slug}`, "layout");
  revalidatePath("/admin/courses");
}

/** Opens a course to everyone, or closes it to its access list. The list is kept either way. */
export async function setCourseVisibility(courseId: string, visibility: CourseVisibility): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change who sees a course." };
  if (visibility !== "PUBLIC" && visibility !== "PRIVATE") return { success: false, error: "That isn't a visibility." };
  try {
    const course = await prisma.course.update({ where: { id: courseId }, data: { visibility }, select: { slug: true } });
    refresh(course.slug);
    return { success: true };
  } catch {
    return { success: false, error: "The course couldn't be updated. Try again." };
  }
}

/**
 * Publishes a draft, or takes a published course back to draft (docs/private-courses.md, "Publishing"). A draft is seen
 * by nobody but admins, whatever its visibility; published, it is in the catalog for everyone (public) or for its list
 * (private). Back to draft keeps everyone's enrolment and progress, for when it is published again.
 */
export async function setCourseStatus(courseId: string, status: CourseStatus): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can publish a course." };
  if (status !== "DRAFT" && status !== "PUBLISHED") return { success: false, error: "That isn't a course status." };
  try {
    const course = await prisma.course.update({ where: { id: courseId }, data: { status }, select: { slug: true } });
    refresh(course.slug);
    revalidatePath(`/practice/${course.slug}`);
    return { success: true };
  } catch {
    return { success: false, error: "The course couldn't be updated. Try again." };
  }
}

/** Turns one of the widgets beside a course's practice on or off (docs/practice.md, "Widgets"). */
export async function setCoursePracticeWidget(courseId: string, widget: "scratchbook" | "voice", on: boolean): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change a course's practice." };
  if (widget !== "scratchbook" && widget !== "voice") return { success: false, error: "That isn't a widget." };
  try {
    const course = await prisma.course.update({
      where: { id: courseId },
      data: widget === "scratchbook" ? { practiceScratchbook: Boolean(on) } : { practiceVoice: Boolean(on) },
      select: { slug: true },
    });
    revalidatePath(`/practice/${course.slug}`);
    revalidatePath("/admin/courses");
    return { success: true };
  } catch {
    return { success: false, error: "The course couldn't be updated. Try again." };
  }
}

/** Folds, or unfolds, the "## Solutions" section of the course's reading lessons on their pages. */
export async function setCourseFoldSolutions(courseId: string, on: boolean): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change a course's lesson pages." };
  try {
    const course = await prisma.course.update({ where: { id: courseId }, data: { foldSolutions: Boolean(on) }, select: { slug: true } });
    refresh(course.slug);
    return { success: true };
  } catch {
    return { success: false, error: "The course couldn't be updated. Try again." };
  }
}

/**
 * The language of a course's code practice (docs/practice.md, "Languages"): the scratchbook's, and the one new code
 * tasks are written in. Tasks already written keep theirs, so switching back and forth loses nothing.
 */
export async function setCoursePracticeLanguage(courseId: string, language: PracticeLanguage): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change a course's practice." };
  if (!(PRACTICE_LANGUAGES as readonly string[]).includes(language)) return { success: false, error: "That isn't a practice language." };
  try {
    const course = await prisma.course.update({ where: { id: courseId }, data: { practiceLanguage: language }, select: { slug: true } });
    revalidatePath(`/practice/${course.slug}`);
    revalidatePath("/admin/courses");
    revalidatePath("/admin/practice", "layout");
    return { success: true };
  } catch {
    return { success: false, error: "The course couldn't be updated. Try again." };
  }
}

/**
 * Adds people to a course's access list by email: one or many, separated by commas, spaces or new lines. Emails that
 * can't be read are returned, so a pasted list never fails as a whole.
 */
export async function addCourseAccess(courseId: string, text: string): Promise<Result<{ added: number; already: number; invalid: string[] }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Only admins can change who sees a course." };
  const words = [...new Set(text.split(/[\s,;]+/).map(accessEmail).filter(Boolean))];
  if (!words.length) return { success: false, error: "Write at least one email." };
  if (words.length > MAX_EMAILS) return { success: false, error: `That's ${words.length} emails. Add at most ${MAX_EMAILS} at a time.` };
  const valid = words.filter((word) => z.email().safeParse(word).success);
  const invalid = words.filter((word) => !valid.includes(word));
  try {
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { slug: true } });
    if (!course) return { success: false, error: "That course isn't there any more. Reload the page." };
    const { count } = valid.length
      ? await prisma.courseAccess.createMany({ data: valid.map((email) => ({ courseId, email, addedById: admin.id })), skipDuplicates: true })
      : { count: 0 };
    refresh(course.slug);
    return { success: true, added: count, already: valid.length - count, invalid };
  } catch {
    return { success: false, error: "The emails couldn't be saved. Try again." };
  }
}

/** Takes one email off a course's list. If the course is private, it closes for that person at once. */
export async function removeCourseAccess(accessId: string): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change who sees a course." };
  try {
    const removed = await prisma.courseAccess.delete({ where: { id: accessId }, select: { course: { select: { slug: true } } } });
    refresh(removed.course.slug);
    return { success: true };
  } catch {
    return { success: false, error: "That email couldn't be removed. Reload the page and try again." };
  }
}
