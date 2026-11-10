import type { CompassSignalKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EVERYWHERE } from "@/lib/compass/everywhere";

// Python Compass's signals (docs/compass.md, "Ranking"): what learners search, read and trip over, so the cards can be
// ranked by need and the searches that find nothing say which card to write next. Recorded quietly: a signal that
// can't be written never gets in the learner's way.

export async function recordSignal(signal: {
  kind: CompassSignalKind;
  userId?: string | null;
  conceptKey?: string | null;
  text?: string | null;
  empty?: boolean;
  surface: "guide" | "scratchbook" | "practice" | "lesson";
  courseId?: string | null;
}): Promise<void> {
  try {
    await prisma.compassSignal.create({
      data: {
        kind: signal.kind,
        userId: signal.userId ?? null,
        conceptKey: signal.conceptKey ?? null,
        text: signal.text ? signal.text.replace(/\s+/g, " ").trim().slice(0, 200) : null,
        empty: signal.empty ?? false,
        surface: signal.surface,
        courseId: signal.courseId ?? null,
      },
    });
  } catch (error) {
    console.warn("Couldn't record a Compass signal:", error);
  }
}


/**
 * The construct an error is most likely about: among the concepts on the failing line, the most specific one (the one
 * the course uses least, and not one of the constructs on nearly every line).
 */
export async function conceptOfError(concepts: Record<string, number[]>, line: number | null): Promise<string | null> {
  if (!line) return null;
  const onLine = Object.entries(concepts)
    .filter(([key, lines]) => lines.includes(line) && !EVERYWHERE.has(key))
    .map(([key]) => key);
  if (onLine.length <= 1) return onLine[0] ?? null;
  const rows = await prisma.compassConcept.findMany({ where: { language: "python", key: { in: onLine } }, select: { key: true, lessonCount: true } });
  return rows.sort((a, b) => a.lessonCount - b.lessonCount)[0]?.key ?? onLine[0];
}

// How much each kind of signal says a learner needs a concept: tripping over it most, looking for it next, reading it least.
const WEIGHT: Partial<Record<CompassSignalKind, number>> = { RUN_ERROR: 3, PRACTICE_MISS: 3, SEARCH: 2, ASK: 2, EXPLAIN_LINE: 2, CARD_VIEW: 1 };

/** Per concept, over the last `days`: how often learners read it, searched for it and tripped over it, and a demand score. */
export async function demandByConcept(days = 90): Promise<Map<string, { views: number; searches: number; errors: number; score: number }>> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.compassSignal.groupBy({ by: ["conceptKey", "kind"], where: { createdAt: { gte: since }, conceptKey: { not: null }, language: "python" }, _count: { _all: true } });
  const demand = new Map<string, { views: number; searches: number; errors: number; score: number }>();
  for (const row of rows) {
    const entry = demand.get(row.conceptKey!) ?? { views: 0, searches: 0, errors: 0, score: 0 };
    const count = row._count._all;
    if (row.kind === "CARD_VIEW") entry.views += count;
    else if (row.kind === "SEARCH") entry.searches += count;
    else if (row.kind === "RUN_ERROR" || row.kind === "PRACTICE_MISS") entry.errors += count;
    entry.score += count * (WEIGHT[row.kind] ?? 1);
    demand.set(row.conceptKey!, entry);
  }
  return demand;
}

/** What learners searched for and didn't find, most asked first: the cards to write next. */
export async function missingSearches(days = 90, limit = 12): Promise<{ text: string; count: number }[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.compassSignal.groupBy({ by: ["text"], where: { kind: "SEARCH", empty: true, createdAt: { gte: since }, text: { not: null } }, _count: { _all: true }, orderBy: { _count: { text: "desc" } }, take: limit });
  return rows.map((row) => ({ text: row.text!, count: row._count._all }));
}
