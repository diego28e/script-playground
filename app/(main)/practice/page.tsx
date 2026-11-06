import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PracticeCourses } from "@/components/practice/practice-courses";

export const runtime = "nodejs";

/** The header's Practice link: straight to the course when there's one with practice, a short list otherwise. */
export default async function PracticeIndexPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=${encodeURIComponent("/practice")}`);
  const enrolled = await prisma.enrollment.findMany({
    where: { userId: session.user.id, course: { skillGraphs: { some: {} } } },
    select: { course: { select: { slug: true, title: true } } },
    orderBy: { enrolledAt: "desc" },
  });
  if (enrolled.length === 1) redirect(`/practice/${enrolled[0].course.slug}`);
  return <PracticeCourses courses={enrolled.map(({ course }) => course)} />;
}
