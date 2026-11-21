import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { courseVisibleTo } from "@/lib/course-access";
import { currentViewer } from "@/lib/viewer";
import { PracticeToday } from "@/components/practice/practice-today";
import { AUTHORING_CHAIN } from "@/lib/ai/gemini";

export const runtime = "nodejs";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  // The tab's title too: a private course's name is only for the people it is for.
  const course = await prisma.course.findFirst({ where: { slug, ...courseVisibleTo(await currentViewer()) }, select: { title: true } });
  return course ? { title: `Práctica · ${course.title}` } : {};
}

/** Today's practice for one course (docs/practice.md): the set loads in the browser, which knows the learner's time zone. */
export default async function PracticePage({ params }: Props) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=${encodeURIComponent(`/practice/${slug}`)}`);
  const course = await prisma.course.findFirst({ where: { slug, ...courseVisibleTo(session.user) }, select: { slug: true, title: true, practiceScratchbook: true, practiceVoice: true } });
  if (!course) notFound();
  // An admin can fix a task from here (components/admin/practice-task-edit-button.tsx).
  const editModels = session.user.role === "ADMIN" ? AUTHORING_CHAIN.map(({ model, label }) => ({ id: model, label })) : undefined;
  // The coach talks through the lab's learning service: without its address and secret there is nothing to open.
  const coach = course.practiceVoice && Boolean(process.env.LESSON_TUTOR_URL && process.env.LESSON_TUTOR_SECRET);
  return <PracticeToday courseSlug={course.slug} courseTitle={course.title} editModels={editModels} widgets={{ scratchbook: course.practiceScratchbook, coach }} />;
}
