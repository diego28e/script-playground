import { prisma } from "@/lib/prisma";
import { compassKit, type CourseInventory } from "@/lib/compass/kit";
import type { CompassLanguage } from "@/lib/compass/languages";

// Python Compass's concepts (docs/compass.md): one row per construct the detector knows (lib/compass/detector.py), with
// what the course asks of it, from the course inventory (scripts/compass-inventory.py). Re-run after the inventory is
// regenerated: it updates the labels and the course figures and never touches cards or learners' signals.

/** The Python course's inventory (the JavaScript one is compassKit("javascript").inventory). */
export const COURSE_INVENTORY: CourseInventory = compassKit("python").inventory;

/**
 * Upserts every concept of a language from its course inventory: the ones the course uses, ranked, and the ones it
 * doesn't yet. Python by default, as it always was.
 */
export async function syncConcepts(language: CompassLanguage = "python"): Promise<{ concepts: number; commit: string }> {
  const inventory = compassKit(language).inventory;
  const rows = [
    ...inventory.concepts.map((concept) => ({
      key: concept.key,
      group: concept.group,
      labelEn: concept.label,
      labelEs: concept.labelEs,
      // A concept only in setup cells or solutions isn't ranked by the course.
      usageRank: concept.lessonCount ? concept.rank : null,
      lessonCount: concept.lessonCount,
      firstLesson: concept.firstLesson,
    })),
    ...inventory.unusedConcepts.map((concept) => ({
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
  await prisma.compassConcept.createMany({ data: rows.map((row) => ({ language, ...row })), skipDuplicates: true });
  await prisma.$executeRaw`
    UPDATE "compass_concept" AS c
    SET "group" = r."group", "labelEn" = r."labelEn", "labelEs" = r."labelEs", "usageRank" = r."usageRank",
        "lessonCount" = r."lessonCount", "firstLesson" = r."firstLesson", "updatedAt" = now()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      AS r("key" text, "group" text, "labelEn" text, "labelEs" text, "usageRank" int, "lessonCount" int, "firstLesson" text)
    WHERE c."language" = ${language} AND c."key" = r."key"`;
  return { concepts: rows.length, commit: inventory.commit };
}
