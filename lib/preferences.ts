import { prisma } from "@/lib/prisma";

// The learner's own instructions for how to teach them (docs/whiteboard-teaching.md §2): kept word for word, never
// rewritten by a model, in two scopes. "all" is read by every teacher (the voice teachers, the practice coach, the
// whiteboard); "board" only by the whiteboard's teacher. They outrank the learner profile's notes, which are what the
// teachers observed; no preference overrides a teacher's fixed principles.

export type PreferenceScope = "all" | "board";
export type PreferenceSource = "board" | "learner" | "voice";
export type Preference = { id: string; text: string };
export type Preferences = Record<PreferenceScope, Preference[]>;

export const PREFERENCE_CHARS = 300;
/** At most this many a scope: the newest are kept when a new one would pass it. */
export const PREFERENCES_PER_SCOPE = 30;

// A line about the board itself belongs to the board, whatever scope it came with: a voice teacher has no board, and
// an instruction about drawing would only confuse it. English and Spanish, with the forms a learner would use.
const BOARD_WORDS =
  /\b(white\s?board|board|pizarra|pizarr[oó]n|draw(s|ing|n)?|drew|dibuj\w*|diagram(s|a|as)?|sketch(es)?|boceto\w*|trace(s)?|traza\w*|arrow(s)?|flecha\w*|canvas|lienzo|space(s)?|espacio(s)?)\b/i;

/** The scope a line is kept under: `board` when it is about the board, else the one it came with. */
export function fileScope(text: string, hinted: PreferenceScope): PreferenceScope {
  return BOARD_WORDS.test(text) ? "board" : hinted;
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, PREFERENCE_CHARS);
const same = (a: string, b: string) => tidy(a).toLowerCase() === tidy(b).toLowerCase();

/** The learner's preferences, oldest first, by scope. */
export async function preferencesOf(userId: string): Promise<Preferences> {
  const rows = await prisma.learnerPreference.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, scope: true, text: true } });
  return {
    all: rows.filter((row) => row.scope === "all").map(({ id, text }) => ({ id, text })),
    board: rows.filter((row) => row.scope === "board").map(({ id, text }) => ({ id, text })),
  };
}

/**
 * Saves one, under the scope it belongs to (`fileScope`). The same line said again is the one already kept. Past the
 * limit, the oldest of that scope goes.
 */
export async function rememberPreference(input: { userId: string; text: string; scope: PreferenceScope; source: PreferenceSource; sessionId?: string }): Promise<{ id: string; scope: PreferenceScope } | null> {
  const text = tidy(input.text);
  if (!text) return null;
  const scope = fileScope(text, input.scope);
  const existing = await prisma.learnerPreference.findMany({ where: { userId: input.userId, scope }, orderBy: { createdAt: "asc" }, select: { id: true, text: true } });
  const found = existing.find((row) => same(row.text, text));
  if (found) return { id: found.id, scope };
  const over = existing.length + 1 - PREFERENCES_PER_SCOPE;
  if (over > 0) await prisma.learnerPreference.deleteMany({ where: { id: { in: existing.slice(0, over).map((row) => row.id) } } });
  const created = await prisma.learnerPreference.create({ data: { userId: input.userId, scope, text, source: input.source, sessionId: input.sessionId ?? null }, select: { id: true } });
  return { id: created.id, scope };
}

/** Removes one of the learner's, by id, or else by its text (case aside). Returns the id removed, or null. */
export async function forgetPreference(userId: string, by: { id?: string; text?: string }): Promise<string | null> {
  if (by.id) {
    const { count } = await prisma.learnerPreference.deleteMany({ where: { id: by.id, userId } });
    if (count) return by.id;
  }
  if (by.text) {
    const rows = await prisma.learnerPreference.findMany({ where: { userId }, select: { id: true, text: true } });
    const found = rows.find((row) => same(row.text, by.text!));
    if (found) {
      await prisma.learnerPreference.delete({ where: { id: found.id } });
      return found.id;
    }
  }
  return null;
}

/** The lines every teacher follows, as a teacher's prompt reads them; null when there are none. */
export async function teacherPreferences(userId: string): Promise<string[] | null> {
  const rows = await prisma.learnerPreference.findMany({ where: { userId, scope: "all" }, orderBy: { createdAt: "asc" }, select: { text: true } });
  return rows.length ? rows.map((row) => row.text) : null;
}
