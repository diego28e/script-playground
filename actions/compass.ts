"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTHORING_CHAIN } from "@/lib/ai/gemini";
import { COURSE_INVENTORY, syncConcepts } from "@/lib/compass/concepts";
import { CardSchema, checkDraft, draftCard, fromColumns, proveCard, toColumns, type CardDraft, type CardProof } from "@/lib/compass/cards";
import { docCandidates, docLink, type DocLink } from "@/lib/compass/docs";
import { demandByConcept, missingSearches } from "@/lib/compass/signals";

// Admin → Python (docs/compass.md, "Cards"): the concepts in the course's order of use, and each one's card: drafted by
// a model or by hand, proven on the grader, reviewed and published. A card is versioned: editing a proven or published
// card makes a new draft; publishing a version retires the one before.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.role === "ADMIN" ? session : null;
}
const denied = { success: false as const, error: "Only admins can edit the Python Compass." };
const refresh = () => revalidatePath("/admin/python", "layout");

/** The concepts, the course's most used first, each with where its card stands. */
export async function listCompassConcepts() {
  if (!(await requireAdmin())) throw new Error("Only admins can see the Python Compass.");
  const concepts = await prisma.compassConcept.findMany({
    where: { language: "python" },
    orderBy: [{ usageRank: { sort: "asc", nulls: "last" } }, { key: "asc" }],
    select: {
      key: true,
      group: true,
      labelEn: true,
      labelEs: true,
      usageRank: true,
      lessonCount: true,
      firstLesson: true,
      demand: true,
      cards: { orderBy: { version: "desc" }, select: { version: true, status: true } },
    },
  });
  // What learners need (docs/compass.md, "Ranking"): their signals over the last 90 days.
  const [demand, missing] = await Promise.all([demandByConcept(90), missingSearches(90)]);
  return {
    missing,
    commit: COURSE_INVENTORY.commit,
    lessons: COURSE_INVENTORY.taughtNotebooks,
    models: AUTHORING_CHAIN.filter((entry) => entry.provider === "anthropic" || entry.provider === "deepseek").map(({ model, label }) => ({ id: model, label })),
    concepts: concepts.map(({ cards, ...concept }) => ({
      ...concept,
      need: demand.get(concept.key) ?? { views: 0, searches: 0, errors: 0, score: 0 },
      latest: cards[0] ?? null,
      published: cards.find((card) => card.status === "PUBLISHED")?.version ?? null,
    })),
  };
}
export type CompassList = Awaited<ReturnType<typeof listCompassConcepts>>;

/** One concept with its card versions, the docs it may link to, and every concept (for "related"). */
export async function getCompassConcept(key: string) {
  if (!(await requireAdmin())) throw new Error("Only admins can see the Python Compass.");
  const concept = await prisma.compassConcept.findUnique({
    where: { language_key: { language: "python", key } },
    include: { cards: { orderBy: { version: "desc" } } },
  });
  if (!concept) return null;
  const all = await prisma.compassConcept.findMany({ where: { language: "python" }, orderBy: [{ usageRank: { sort: "asc", nulls: "last" } }, { key: "asc" }], select: { key: true, labelEn: true } });
  const usage = COURSE_INVENTORY.concepts.find((entry) => entry.key === key) as { lessons: string[]; example: { lesson: string; line: string } | null } | undefined;
  // The links the editor offers: the concept's candidates, plus any its cards already use.
  const links = new Map<string, DocLink>(docCandidates(concept).map((link) => [link.key, link]));
  for (const card of concept.cards) for (const link of card.docs as DocLink[]) if (!links.has(link.key)) links.set(link.key, docLink(link.key) ?? link);
  return {
    concept: { key: concept.key, group: concept.group, labelEn: concept.labelEn, labelEs: concept.labelEs, usageRank: concept.usageRank, lessonCount: concept.lessonCount, firstLesson: concept.firstLesson },
    usage: usage ? { lessons: usage.lessons, example: usage.example } : null,
    cards: concept.cards.map((card) => ({
      id: card.id,
      version: card.version,
      status: card.status,
      author: card.author,
      publishedAt: card.publishedAt?.toISOString() ?? null,
      createdAt: card.createdAt.toISOString(),
      draft: fromColumns(card),
      proof: card.proof as CardProof | null,
    })),
    links: [...links.values()],
    concepts: all,
    models: AUTHORING_CHAIN.filter((entry) => entry.provider === "anthropic" || entry.provider === "deepseek").map(({ model, label }) => ({ id: model, label })),
  };
}
export type CompassConceptView = NonNullable<Awaited<ReturnType<typeof getCompassConcept>>>;

async function conceptRow(key: string) {
  return prisma.compassConcept.findUnique({ where: { language_key: { language: "python", key } }, include: { cards: { orderBy: { version: "desc" }, take: 1, select: { version: true } } } });
}

/** A new draft version, written by a model: from scratch, or rewriting a version following the admin's instruction. */
export async function draftCompassCard(key: string, options: { model?: string; instruction?: string; fromCardId?: string } = {}): Promise<Result<{ cardId: string; model: string; dropped: string[] }>> {
  const session = await requireAdmin();
  if (!session) return denied;
  const concept = await conceptRow(key);
  if (!concept) return { success: false, error: "That concept doesn't exist." };
  const all = await prisma.compassConcept.findMany({ where: { language: "python" }, select: { key: true, labelEn: true } });
  let previous: CardDraft | undefined;
  if (options.fromCardId) {
    const card = await prisma.compassCard.findFirst({ where: { id: options.fromCardId, conceptId: concept.id } });
    if (card) previous = fromColumns(card);
  }
  // An Amplify request stops at about 30 s.
  const result = await draftCard({ concept, allConcepts: all, model: options.model, instruction: options.instruction?.slice(0, 4000), previous, userId: session.user.id, deadline: Date.now() + 26_000 });
  if (!result.ok) return { success: false, error: result.error };
  const card = await prisma.compassCard.create({
    data: { conceptId: concept.id, version: (concept.cards[0]?.version ?? 0) + 1, status: "DRAFT", author: result.model, ...(toColumns(result.card) as Omit<Prisma.CompassCardCreateInput, "concept" | "version" | "author">) },
  });
  refresh();
  return { success: true, cardId: card.id, model: result.model, dropped: result.dropped };
}

/**
 * Saves the admin's edit: a draft is updated in place (and has to be proven again); a proven or published version
 * stays as it is, and the edit becomes a new draft version.
 */
export async function saveCompassCard(key: string, cardId: string | null, input: CardDraft): Promise<Result<{ cardId: string; problems: string[] }>> {
  const session = await requireAdmin();
  if (!session) return denied;
  const parsed = CardSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: `The card isn't complete: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
  const concept = await conceptRow(key);
  if (!concept) return { success: false, error: "That concept doesn't exist." };
  const keys = new Set((await prisma.compassConcept.findMany({ where: { language: "python" }, select: { key: true } })).map((entry) => entry.key));
  const problems = checkDraft(parsed.data, keys);
  if (problems.length) return { success: false, error: problems.join(" ") };
  const columns = toColumns(parsed.data) as Omit<Prisma.CompassCardCreateInput, "concept" | "version" | "author">;
  const current = cardId ? await prisma.compassCard.findFirst({ where: { id: cardId, conceptId: concept.id } }) : null;
  if (current?.status === "DRAFT") {
    await prisma.compassCard.update({ where: { id: current.id }, data: { ...columns, proof: Prisma.DbNull, author: current.author === "admin" ? "admin" : `${current.author} + admin` } });
    refresh();
    return { success: true, cardId: current.id, problems: [] };
  }
  const card = await prisma.compassCard.create({ data: { conceptId: concept.id, version: (concept.cards[0]?.version ?? 0) + 1, status: "DRAFT", author: "admin", ...columns } });
  refresh();
  return { success: true, cardId: card.id, problems: [] };
}

/** Runs a version's examples and mistakes on the grader; when every one behaves as the card says, it's PROVEN. */
export async function proveCompassCard(cardId: string): Promise<Result<{ proof: CardProof }>> {
  if (!(await requireAdmin())) return denied;
  const card = await prisma.compassCard.findUnique({ where: { id: cardId } });
  if (!card) return { success: false, error: "That card is gone. Reload the page." };
  const proof = await proveCard(fromColumns(card));
  if (proof.unavailable) return { success: false, error: `The grader can't be reached: ${proof.unavailable}` };
  await prisma.compassCard.update({
    where: { id: cardId },
    data: { proof: proof as unknown as Prisma.InputJsonValue, ...(card.status === "DRAFT" || card.status === "PROVEN" ? { status: proof.ok ? "PROVEN" : "DRAFT" } : {}) },
  });
  refresh();
  return { success: true, proof };
}

/**
 * The code is the truth: an example (or a mistake that prints) whose output differed takes what it really printed,
 * then the version is proven again. Code that raised where it shouldn't, or didn't raise where it should, stays for
 * the admin to fix.
 */
export async function adoptRealOutputs(cardId: string): Promise<Result<{ proof: CardProof; draft: CardDraft }>> {
  if (!(await requireAdmin())) return denied;
  const card = await prisma.compassCard.findUnique({ where: { id: cardId } });
  if (!card || card.status !== "DRAFT") return { success: false, error: "Only a draft's outputs can be replaced." };
  const proof = card.proof as CardProof | null;
  if (!proof) return { success: false, error: "Prove the card first." };
  const draft = fromColumns(card);
  for (const item of proof.items) {
    if (item.ok || item.error) continue;
    if (item.kind === "example") draft.examples[item.index] = { ...draft.examples[item.index], output: item.actual.replace(/\n+$/, "") };
    else if (!draft.mistakes[item.index].raises) draft.mistakes[item.index] = { ...draft.mistakes[item.index], output: item.actual.replace(/\n+$/, "") };
  }
  await prisma.compassCard.update({ where: { id: cardId }, data: toColumns(draft) as Prisma.CompassCardUpdateInput });
  const proved = await proveCompassCard(cardId);
  // The editor keeps its own copy of the card: it takes this one, or it would count the old outputs as unsaved changes.
  return proved.success ? { ...proved, draft } : proved;
}

/** Publishes a proven version for learners; the version published before is retired. */
export async function publishCompassCard(cardId: string): Promise<Result> {
  const session = await requireAdmin();
  if (!session) return denied;
  const card = await prisma.compassCard.findUnique({ where: { id: cardId } });
  if (!card) return { success: false, error: "That card is gone. Reload the page." };
  if (card.status !== "PROVEN") return { success: false, error: "Prove the card first: every example has to run as it says." };
  await prisma.$transaction([
    prisma.compassCard.updateMany({ where: { conceptId: card.conceptId, status: "PUBLISHED" }, data: { status: "RETIRED" } }),
    prisma.compassCard.update({ where: { id: cardId }, data: { status: "PUBLISHED", publishedAt: new Date(), reviewedById: session.user.id } }),
  ]);
  refresh();
  return { success: true };
}

/** Loads the concepts from the course inventory bundled with this version of the platform (docs/compass.md). */
export async function syncCompassConcepts(): Promise<Result<{ concepts: number; commit: string }>> {
  if (!(await requireAdmin())) return denied;
  const result = await syncConcepts();
  refresh();
  return { success: true, ...result };
}
