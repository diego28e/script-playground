"use server";

import { prisma } from "@/lib/prisma";
import { courseVisibleTo } from "@/lib/course-access";
import { currentViewer } from "@/lib/viewer";
import { issuePass } from "@/lib/lesson-tutor/pass";

// The lesson tutor's way in (docs/lesson-tutor.md): a signed-in learner who may see the lesson gets a pass for it and
// the address of the lab's learning service, which answers the questions itself (streaming, beyond Amplify's limits).

export type LessonTutorPass =
  | { ok: true; url: string; pass: string; expiresAt: number }
  | { ok: false; reason: "signed-out" | "not-found" | "unavailable"; message: string };

export async function getLessonTutorPass(lessonId: string): Promise<LessonTutorPass> {
  const viewer = await currentViewer();
  if (!viewer) return { ok: false, reason: "signed-out", message: "Sign in to ask the teacher." };
  const url = process.env.LESSON_TUTOR_URL?.replace(/\/+$/, "");
  const secret = process.env.LESSON_TUTOR_SECRET;
  if (!url || !secret) return { ok: false, reason: "unavailable", message: "The lesson tutor isn't set up." };
  const visible = await prisma.lesson.count({ where: { id: lessonId, module: { course: { status: "PUBLISHED", ...courseVisibleTo(viewer) } } } });
  if (!visible) return { ok: false, reason: "not-found", message: "This lesson isn't available." };
  return { ok: true, url, ...issuePass(secret, viewer.id, lessonId) };
}

