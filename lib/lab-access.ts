import { prisma } from "@/lib/prisma";

// Who may use the lab, as OpenID Connect groups the hub reads at sign-in (the `groups` UserInfo claim,
// lib/auth.ts). The hub admits "lab" and makes "lab-admin" an admin (infra/lab/hub/jupyterhub_config.py),
// so access follows enrollment here instead of an email list on the server.
//
//   lab              enrolled in at least one published course, or a platform admin
//   lab-admin        a platform admin
//   course:<slug>    one per published course the user is enrolled in (for course-specific labs later)
export async function labGroups(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      enrollments: { where: { course: { status: "PUBLISHED" } }, select: { course: { select: { slug: true } } } },
    },
  });
  if (!user) return [];
  const courses = user.enrollments.map((enrollment) => `course:${enrollment.course.slug}`);
  const admin = user.role === "ADMIN";
  return [...(admin || courses.length > 0 ? ["lab"] : []), ...(admin ? ["lab-admin"] : []), ...courses];
}
