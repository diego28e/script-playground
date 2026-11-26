"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentViewer } from "@/lib/viewer";
import { forgetPreference, PREFERENCE_CHARS, preferencesOf, rememberPreference, type Preferences, type PreferenceScope } from "@/lib/preferences";
import { PROFILE_SCOPE_ALL } from "@/lib/voice/profile";

// How I learn (docs/whiteboard-teaching.md §2): the learner's own preferences, in their two scopes, which they can add
// and remove; and what the teachers observed (the learner profile's notes), which they can forget.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

export type Observation = { scope: string; title: string; notes: string; updatedAt: string };
export type HowILearn = { preferences: Preferences; observations: Observation[] };

export async function getHowILearn(): Promise<HowILearn | null> {
  const viewer = await currentViewer();
  if (!viewer) return null;
  const [preferences, rows] = await Promise.all([
    preferencesOf(viewer.id),
    prisma.learnerProfile.findMany({ where: { userId: viewer.id }, orderBy: { updatedAt: "desc" }, select: { scope: true, notes: true, updatedAt: true } }),
  ]);
  const courses = await prisma.course.findMany({ where: { id: { in: rows.map((row) => row.scope).filter((scope) => scope !== PROFILE_SCOPE_ALL) } }, select: { id: true, title: true } });
  const observations = rows
    .filter((row) => row.notes.trim())
    .map((row) => ({
      scope: row.scope,
      title: row.scope === PROFILE_SCOPE_ALL ? "" : (courses.find((course) => course.id === row.scope)?.title ?? ""),
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString(),
    }))
    // How they learn first, then each course's.
    .sort((a, b) => Number(b.scope === PROFILE_SCOPE_ALL) - Number(a.scope === PROFILE_SCOPE_ALL));
  return { preferences, observations };
}

const Add = z.object({ text: z.string().trim().min(3).max(PREFERENCE_CHARS), scope: z.enum(["all", "board"]) });

/** Adds one of the learner's own, filed under the scope it belongs to (a line about the board is the board's). */
export async function addPreference(input: { text: string; scope: PreferenceScope }): Promise<Result<{ id: string; scope: PreferenceScope }>> {
  const viewer = await currentViewer();
  if (!viewer) return { success: false, error: "Sign in first." };
  const parsed = Add.safeParse(input);
  if (!parsed.success) return { success: false, error: `Write between 3 and ${PREFERENCE_CHARS} characters.` };
  const kept = await rememberPreference({ userId: viewer.id, text: parsed.data.text, scope: parsed.data.scope, source: "learner" });
  if (!kept) return { success: false, error: "That preference couldn't be saved." };
  revalidatePath("/how-i-learn");
  return { success: true, ...kept };
}

export async function removePreference(id: string): Promise<Result> {
  const viewer = await currentViewer();
  if (!viewer) return { success: false, error: "Sign in first." };
  await forgetPreference(viewer.id, { id });
  revalidatePath("/how-i-learn");
  return { success: true };
}

/** Forgets what the teachers observed: how they learn ("all"), or what they know in one course. */
export async function forgetObservations(scope: string): Promise<Result> {
  const viewer = await currentViewer();
  if (!viewer) return { success: false, error: "Sign in first." };
  await prisma.learnerProfile.deleteMany({ where: { userId: viewer.id, scope } });
  revalidatePath("/how-i-learn");
  return { success: true };
}
