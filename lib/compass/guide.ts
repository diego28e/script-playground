import { prisma } from "@/lib/prisma";
import { fromColumns, type CardDraft } from "@/lib/compass/cards";
import { docLink, type DocLink } from "@/lib/compass/docs";

// The learners' Python guide (docs/compass.md, "The guide"): the published cards. Only a published version is ever shown.

const GROUP_ORDER = ["basics", "strings", "numbers", "logic", "collections", "builtins", "control-flow", "functions", "typing", "classes", "errors", "resources", "iteration", "async", "modules", "standard-library", "packages", "notebooks"];

/** Every published card, for the guide's index and its search: the words to search and what a result shows. */
export async function publishedIndex() {
  const cards = await prisma.compassCard.findMany({
    where: { status: "PUBLISHED", concept: { language: "python" } },
    select: { content: true, related: true, concept: { select: { key: true, group: true, labelEn: true, labelEs: true, usageRank: true, lessonCount: true, firstLesson: true } } },
  });
  return cards
    .map(({ content, concept }) => {
      const text = content as Record<string, string>;
      return {
        key: concept.key,
        group: concept.group,
        groupOrder: GROUP_ORDER.indexOf(concept.group) === -1 ? 99 : GROUP_ORDER.indexOf(concept.group),
        usageRank: concept.usageRank,
        lessonCount: concept.lessonCount,
        firstLesson: concept.firstLesson,
        label: { es: concept.labelEs, en: concept.labelEn },
        title: { es: text.titleEs, en: text.titleEn },
        summary: { es: text.summaryEs, en: text.summaryEn },
        // Searched too, though not shown in the results: the explanation finds a card by what it talks about.
        body: `${text.explanationEs} ${text.explanationEn} ${text.whenEs} ${text.whenEn}`.slice(0, 4000),
      };
    })
    .sort((a, b) => (a.usageRank ?? 1e6) - (b.usageRank ?? 1e6));
}
export type GuideEntry = Awaited<ReturnType<typeof publishedIndex>>[number];

/** One concept's published card, with its links resolved and its related concepts' labels (published ones linkable). */
export async function publishedCard(key: string): Promise<{
  key: string;
  group: string;
  label: { es: string; en: string };
  usage: { lessonCount: number; firstLesson: string | null };
  card: CardDraft;
  links: Record<string, DocLink>;
  related: { key: string; label: { es: string; en: string }; published: boolean }[];
  version: number;
} | null> {
  const concept = await prisma.compassConcept.findUnique({
    where: { language_key: { language: "python", key } },
    include: { cards: { where: { status: "PUBLISHED" }, take: 1 } },
  });
  const row = concept?.cards[0];
  if (!concept || !row) return null;
  const card = fromColumns(row);
  const links: Record<string, DocLink> = {};
  for (const link of row.docs as DocLink[]) links[link.key] = docLink(link.key) ?? link;
  const relatedRows = card.related.length
    ? await prisma.compassConcept.findMany({ where: { language: "python", key: { in: card.related } }, select: { key: true, labelEn: true, labelEs: true, cards: { where: { status: "PUBLISHED" }, select: { id: true }, take: 1 } } })
    : [];
  return {
    key: concept.key,
    group: concept.group,
    label: { es: concept.labelEs, en: concept.labelEn },
    usage: { lessonCount: concept.lessonCount, firstLesson: concept.firstLesson },
    card,
    links,
    related: card.related.flatMap((relatedKey) => {
      const found = relatedRows.find((entry) => entry.key === relatedKey);
      return found ? [{ key: found.key, label: { es: found.labelEs, en: found.labelEn }, published: found.cards.length > 0 }] : [];
    }),
    version: row.version,
  };
}

/** The keys and labels of every concept with a published card: what the scratchbook can link a construct to. */
export async function publishedConcepts(): Promise<Record<string, { es: string; en: string }>> {
  const rows = await prisma.compassConcept.findMany({ where: { language: "python", cards: { some: { status: "PUBLISHED" } } }, select: { key: true, labelEn: true, labelEs: true } });
  return Object.fromEntries(rows.map((row) => [row.key, { es: row.labelEs, en: row.labelEn }]));
}
