"use server";

import { prisma } from "@/lib/prisma";
import { currentViewer } from "@/lib/viewer";
import { boardAllowed, lessonSkills } from "@/lib/board/offer";

// The whiteboard's sessions (docs/whiteboard.md): opening a board resumes the skill's newest open session; "New board"
// closes that one and starts another. The board page then signs the launch for whichever session it shows.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

/** Starts a new board for a skill (or the lesson): the open one is closed as it is, kept with its history. */
export async function startNewBoard(input: { lessonId: string; skillKey: string | null; language: "es" | "en" }): Promise<Result<{ sessionId: string }>> {
  const viewer = await currentViewer();
  if (!boardAllowed(viewer) || !viewer) return { success: false, error: "The whiteboard isn't available to you yet." };
  const lesson = await prisma.lesson.findUnique({ where: { id: input.lessonId }, select: { id: true, module: { select: { courseId: true } } } });
  if (!lesson) return { success: false, error: "That lesson doesn't exist." };
  if (input.skillKey && !(await lessonSkills(lesson.id)).some((skill) => skill.key === input.skillKey)) return { success: false, error: "That skill isn't taught in this lesson." };
  const language = input.language === "es" ? "es" : "en";
  await prisma.boardSession.updateMany({
    where: { userId: viewer.id, lessonId: lesson.id, skillKey: input.skillKey, status: "OPEN" },
    data: { status: "ENDED", endedAt: new Date() },
  });
  const created = await prisma.boardSession.create({ data: { userId: viewer.id, courseId: lesson.module.courseId, lessonId: lesson.id, skillKey: input.skillKey, language }, select: { id: true } });
  return { success: true, sessionId: created.id };
}
