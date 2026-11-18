import { prisma } from "@/lib/prisma";
import { courseVisibleTo, viewerById } from "@/lib/course-access";

// Who may use the lab, as OpenID Connect groups the hub reads at sign-in (the `groups` UserInfo claim,
// lib/auth.ts). The hub admits "lab" and makes "lab-admin" an admin (infra/lab/hub/jupyterhub_config.py),
// so access follows enrollment here instead of an email list on the server.
//
//   lab              enrolled in at least one published course, or a platform admin
//   lab-admin        a platform admin
//   course:<slug>    one per published course the user is enrolled in (for course-specific labs later)
//
// An enrolment in a private course only counts while the user is on its access list (lib/course-access.ts).
export async function labGroups(userId: string): Promise<string[]> {
  const viewer = await viewerById(userId);
  if (!viewer) return [];
  const enrollments = await prisma.enrollment.findMany({
    where: { userId, course: { status: "PUBLISHED", ...courseVisibleTo(viewer) } },
    select: { course: { select: { slug: true } } },
  });
  const courses = enrollments.map((enrollment) => `course:${enrollment.course.slug}`);
  const admin = viewer.role === "ADMIN";
  return [...(admin || courses.length > 0 ? ["lab"] : []), ...(admin ? ["lab-admin"] : []), ...courses];
}
