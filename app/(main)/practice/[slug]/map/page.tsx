import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { courseVisibleTo } from "@/lib/course-access";
import { currentViewer } from "@/lib/viewer";
import { getPracticeMap } from "@/actions/practice-learner";
import { PracticeMap } from "@/components/practice/practice-map";

export const runtime = "nodejs";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const course = await prisma.course.findFirst({ where: { slug, ...courseVisibleTo(await currentViewer()) }, select: { title: true } });
  return course ? { title: `Mapa · ${course.title}` } : {};
}

/** The progress map (docs/practice.md): every skill of the course, by module and lesson, with where the learner stands. */
export default async function PracticeMapPage({ params }: Props) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=${encodeURIComponent(`/practice/${slug}/map`)}`);
  const result = await getPracticeMap(slug);
  if (!result.success) {
    if (result.error === "Course not found.") notFound();
    redirect(`/courses/${slug}`);
  }
  return <PracticeMap courseSlug={result.course.slug} courseTitle={result.course.title} map={result.ready ? result : null} />;
}
