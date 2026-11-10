import { prisma } from "@/lib/prisma";
import inventory from "./course-inventory.json";

// Python Compass's concepts (docs/compass.md): one row per construct the detector knows (lib/compass/detector.py), with
// what the course asks of it, from the course inventory (scripts/compass-inventory.py). Re-run after the inventory is
// regenerated: it updates the labels and the course figures and never touches cards or learners' signals.

type InventoryConcept = {
  key: string;
  group: string;
  label: string;
  labelEs: string;
  lessonCount: number;
  firstLesson: string | null;
  rank: number;
};
type UnusedConcept = { key: string; group: string; label: string; labelEs: string };

export const COURSE_INVENTORY = inventory as unknown as {
  course: string;
  commit: string;
  taughtNotebooks: number;
  concepts: InventoryConcept[];
  unusedConcepts: UnusedConcept[];
  lessons: { path: string; code: string; kind: "lesson" | "project" | "solution"; module: string; concepts: string[] }[];
};

/** Upserts every concept from the inventory: the ones the course uses, ranked, and the ones it doesn't yet. */
export async function syncConcepts(): Promise<{ concepts: number; commit: string }> {
  const rows = [
    ...COURSE_INVENTORY.concepts.map((concept) => ({
      key: concept.key,
      group: concept.group,
      labelEn: concept.label,
      labelEs: concept.labelEs,
      // A concept only in setup cells or solutions isn't ranked by the course.
      usageRank: concept.lessonCount ? concept.rank : null,
      lessonCount: concept.lessonCount,
      firstLesson: concept.firstLesson,
    })),
    ...COURSE_INVENTORY.unusedConcepts.map((concept) => ({
      key: concept.key,
      group: concept.group,
      labelEn: concept.label,
      labelEs: concept.labelEs,
      usageRank: null,
      lessonCount: 0,
      firstLesson: null,
    })),
  ];
  // Two statements, whatever the number of concepts: an upsert each, in one transaction, took over Prisma's 5 s
  // transaction limit from Amplify to the database. Both are safe to run again, so no transaction is needed.
  // New concepts first (the ones already there are skipped), then every concept's labels and course figures.
  await prisma.compassConcept.createMany({ data: rows.map((row) => ({ language: "python", ...row })), skipDuplicates: true });
  await prisma.$executeRaw`
    UPDATE "compass_concept" AS c
    SET "group" = r."group", "labelEn" = r."labelEn", "labelEs" = r."labelEs", "usageRank" = r."usageRank",
        "lessonCount" = r."lessonCount", "firstLesson" = r."firstLesson", "updatedAt" = now()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      AS r("key" text, "group" text, "labelEn" text, "labelEs" text, "usageRank" int, "lessonCount" int, "firstLesson" text)
    WHERE c."language" = 'python' AND c."key" = r."key"`;
  return { concepts: rows.length, commit: COURSE_INVENTORY.commit };
}
