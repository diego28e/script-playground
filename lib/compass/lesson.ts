import { prisma } from "@/lib/prisma";
import { COURSE_INVENTORY } from "@/lib/compass/concepts";
import { EVERYWHERE } from "@/lib/compass/everywhere";

// "Python in this lesson" (docs/compass.md): the Python a lesson's notebook uses, from the course inventory (which read
// every notebook with the detector, setup cells apart), shown on the lesson page before the learner starts. What the
// lesson uses for the first time in the course comes first, since that is what may stop a learner; the rest only
// when it has a card. Constructs on nearly every line (assignment, print, strings…) are left out.

export type LessonPythonConcept = { key: string; label: { es: string; en: string }; published: boolean };
export type LessonPython = { fresh: LessonPythonConcept[]; also: LessonPythonConcept[] };

export async function pythonInLesson(sourcePath: string | null): Promise<LessonPython | null> {
  if (!sourcePath?.endsWith(".ipynb")) return null;
  const entry = COURSE_INVENTORY.lessons.find((lesson) => lesson.path === sourcePath && lesson.kind !== "solution");
  if (!entry?.concepts.length) return null;
  const rows = await prisma.compassConcept.findMany({
    where: { language: "python", key: { in: entry.concepts.filter((key) => !EVERYWHERE.has(key)) } },
    select: { key: true, labelEs: true, labelEn: true, lessonCount: true, firstLesson: true, cards: { where: { status: "PUBLISHED" }, select: { id: true }, take: 1 } },
  });
  const concepts = rows.map((row) => ({
    key: row.key,
    label: { es: row.labelEs, en: row.labelEn },
    published: row.cards.length > 0,
    fresh: row.firstLesson === entry.code,
    lessonCount: row.lessonCount,
  }));
  const strip = ({ key, label, published }: (typeof concepts)[number]): LessonPythonConcept => ({ key, label, published });
  // New here: what the course will lean on most, first. Also used: the most specific first (the rarer, the more likely
  // it's the one a learner forgot).
  const fresh = concepts.filter((concept) => concept.fresh).sort((a, b) => b.lessonCount - a.lessonCount);
  const also = concepts.filter((concept) => !concept.fresh && concept.published).sort((a, b) => a.lessonCount - b.lessonCount);
  if (!fresh.length && !also.length) return null;
  return { fresh: fresh.map(strip), also: also.map(strip) };
}
