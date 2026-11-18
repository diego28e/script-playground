import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Who may see a course (docs/private-courses.md). A course is PUBLIC (everyone) or PRIVATE: only the people whose
// email is on its access list, and admins, who manage its videos and practice anyway. For anyone else a private course
// doesn't exist: it is missing from the catalog, its pages answer "not found", and it can't be enrolled in or practised.
//
// Every query that reads a course for a person adds `courseVisibleTo(viewer)` to its `where`, next to whatever else it
// asks for (the status, the slug), so the rule is written once, here. Enrolment alone never opens a private course:
// taking someone off the list closes it for them at once, and their progress is kept for if they are added again.
//
// This file is also bundled into the lab's services (the tutor reads it), so it must not import anything from Next.js;
// the signed-in viewer of a request comes from lib/viewer.ts.

/** The person looking, as the rule needs them: the session's user, or a user row. */
export type Viewer = { id: string; email: string; emailVerified?: boolean | null; role?: string | null };

/** An email as the access list stores and compares it. */
export const accessEmail = (email: string) => email.trim().toLowerCase();

/**
 * The `where` of the courses a viewer may see, to spread into a course query. An email only counts when the sign-in
 * provider verified it (Google always does), so nobody can claim a seat with an address that isn't theirs.
 */
export function courseVisibleTo(viewer: Viewer | null | undefined): Prisma.CourseWhereInput {
  if (viewer?.role === "ADMIN") return {};
  const listed: Prisma.CourseWhereInput[] = viewer?.emailVerified ? [{ access: { some: { email: accessEmail(viewer.email) } } }] : [];
  return { OR: [{ visibility: "PUBLIC" }, ...listed] };
}

/** The viewer for a user id, where there is no request to read a session from (the lab's sign-in, the tutor). */
export async function viewerById(userId: string): Promise<Viewer | null> {
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerified: true, role: true } });
}
