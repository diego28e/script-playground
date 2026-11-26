import { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentViewer } from "@/lib/viewer";
import { lessonPath } from "@/lib/lab";
import { getLessonWorkspace } from "@/actions/lessons";
import { boardAllowed, boardOffer, sessionFor } from "@/lib/board/offer";
import { boardSecret, boardUrl, issueLaunch } from "@/lib/board/token";
import { BoardFrame } from "@/components/courses/board-frame";

export const runtime = "nodejs";

// A lesson on the whiteboard (docs/whiteboard.md): Didactra, the teacher that talks and draws, framed full screen under
// a bar that says which skill this is. A board per skill: `?skill=` opens that skill's open session (or a new one),
// `?session=` a given one of the learner's, and neither opens the next skill still to learn.

type Props = { params: Promise<{ slug: string; module: string; lesson: string }>; searchParams: Promise<{ skill?: string; session?: string }> };

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { slug, module: moduleSlug, lesson: lessonSlug } = await params;
  const result = await getLessonWorkspace(slug, moduleSlug, lessonSlug);
  return { title: result.success && result.data ? `Whiteboard · ${result.data.lesson.title.replaceAll("`", "")}` : "Whiteboard" };
}

export default async function BoardPage({ params, searchParams }: Props) {
  const { slug, module: moduleSlug, lesson: lessonSlug } = await params;
  const { skill: skillParam, session: sessionParam } = await searchParams;
  const viewer = await currentViewer();
  const secret = boardSecret();
  const base = boardUrl();
  if (!viewer || !boardAllowed(viewer) || !secret || !base) notFound();

  const result = await getLessonWorkspace(slug, moduleSlug, lessonSlug);
  if (!result.success || !result.data) notFound();
  const { course, lesson } = result.data;
  const here = lessonPath(course.slug, moduleSlug, lessonSlug);
  const language = (await cookies()).get("adc_lang")?.value === "en" ? "en" : "es";
  const offer = await boardOffer(viewer.id, course.id, lesson.id);

  let sid: string;
  let skillKey: string | null;
  if (sessionParam) {
    const owned = await prisma.boardSession.findFirst({ where: { id: sessionParam, userId: viewer.id, lessonId: lesson.id }, select: { id: true, skillKey: true } });
    if (!owned) notFound();
    sid = owned.id;
    skillKey = owned.skillKey;
  } else {
    if (!skillParam && offer.skills.length) {
      // The next skill to learn: the first not yet secure, or the first.
      const next = offer.skills.find((entry) => entry.state !== "secure") ?? offer.skills[0];
      redirect(`${here}/board?skill=${encodeURIComponent(next.key)}`);
    }
    skillKey = skillParam && offer.skills.some((entry) => entry.key === skillParam) ? skillParam : null;
    if (skillParam && !skillKey) notFound();
    sid = (await sessionFor(viewer.id, course.id, lesson.id, skillKey, language)).id;
  }

  const user = await prisma.user.findUnique({ where: { id: viewer.id }, select: { name: true } });
  const launch = issueLaunch(secret, {
    sid,
    userId: viewer.id,
    name: (user?.name ?? "").trim().split(/\s+/)[0] ?? "",
    language,
    role: viewer.role === "ADMIN" ? "ADMIN" : "USER",
    view: "board",
  });

  return (
    <BoardFrame
      src={`${base}/launch?t=${encodeURIComponent(launch)}`}
      lessonHref={here}
      lessonId={lesson.id}
      lessonTitle={lesson.title.replaceAll("`", "")}
      skillKey={skillKey}
      skills={offer.skills.map((entry) => ({ key: entry.key, labelEs: entry.labelEs, labelEn: entry.labelEn, state: entry.state }))}
    />
  );
}
