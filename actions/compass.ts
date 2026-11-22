"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTHORING_MODELS } from "@/lib/ai/gemini";
import { syncConcepts } from "@/lib/compass/concepts";
import { compassKit } from "@/lib/compass/kit";
import { COMPASS, isCompassLanguage, type CompassLanguage } from "@/lib/compass/languages";
import { CardSchema, checkDraft, draftCard, fromColumns, proveCard, repairCard, toColumns, type CardDraft, type CardProof } from "@/lib/compass/cards";
import type { DocLink } from "@/lib/compass/docs";
import { demandByConcept, missingSearches } from "@/lib/compass/signals";
import { REQUEST_BUDGET_MS } from "@/lib/request-budget";

// Admin → Python (docs/compass.md, "Cards"): the concepts in the course's order of use, and each one's card: drafted by
// a model or by hand, proven on the grader, reviewed and published. A card is versioned: editing a proven or published
// card makes a new draft; publishing a version retires the one before. Admin → JavaScript is the same for the JavaScript
// Compass (docs/compass.md, "JavaScript"): every function takes the language, Python unless said.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.role === "ADMIN" ? session : null;
}
const denied = { success: false as const, error: "Only admins can edit the Compass." };
/** A language from the page, checked: these are server actions, so anything may come in. */
const languageOf = (value: unknown): CompassLanguage => (isCompassLanguage(value) ? value : "python");
const refresh = (language: CompassLanguage) => revalidatePath(COMPASS[language].admin, "layout");

/** The concepts, the course's most used first, each with where its card stands. */
export async function listCompassConcepts(languageInput: CompassLanguage = "python") {
  const language = languageOf(languageInput);
  if (!(await requireAdmin())) throw new Error(`Only admins can see the ${COMPASS[language].name} Compass.`);
  const COURSE_INVENTORY = compassKit(language).inventory;
  const concepts = await prisma.compassConcept.findMany({
    where: { language },
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
  const [demand, missing] = await Promise.all([demandByConcept(90, language), missingSearches(90, 12, language)]);
  return {
    language,
    missing,
    commit: COURSE_INVENTORY.commit,
    lessons: COURSE_INVENTORY.taughtNotebooks,
    models: AUTHORING_MODELS.filter((entry) => entry.provider !== undefined && entry.provider !== "gemini").map(({ model, label }) => ({ id: model, label })),
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
export async function getCompassConcept(key: string, languageInput: CompassLanguage = "python") {
  const language = languageOf(languageInput);
  if (!(await requireAdmin())) throw new Error(`Only admins can see the ${COMPASS[language].name} Compass.`);
  const { inventory: COURSE_INVENTORY, docCandidates, docLink } = compassKit(language);
  const concept = await prisma.compassConcept.findUnique({
    where: { language_key: { language, key } },
    include: { cards: { orderBy: { version: "desc" } } },
  });
  if (!concept) return null;
  const all = await prisma.compassConcept.findMany({ where: { language }, orderBy: [{ usageRank: { sort: "asc", nulls: "last" } }, { key: "asc" }], select: { key: true, labelEn: true } });
  const usage = COURSE_INVENTORY.concepts.find((entry) => entry.key === key);
  // The links the editor offers: the concept's candidates, plus any its cards already use.
  const links = new Map<string, DocLink>(docCandidates(concept).map((link) => [link.key, link]));
  for (const card of concept.cards) for (const link of card.docs as DocLink[]) if (!links.has(link.key)) links.set(link.key, docLink(link.key) ?? link);
  return {
    language,
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
    models: AUTHORING_MODELS.filter((entry) => entry.provider !== undefined && entry.provider !== "gemini").map(({ model, label }) => ({ id: model, label })),
  };
}
export type CompassConceptView = NonNullable<Awaited<ReturnType<typeof getCompassConcept>>>;

async function conceptRow(key: string, language: CompassLanguage) {
  return prisma.compassConcept.findUnique({ where: { language_key: { language, key } }, include: { cards: { orderBy: { version: "desc" }, take: 1, select: { version: true } } } });
}

/** A new draft version, written by a model: from scratch, or rewriting a version following the admin's instruction. */
export async function draftCompassCard(
  key: string,
  options: { model?: string; instruction?: string; fromCardId?: string } = {},
  languageInput: CompassLanguage = "python",
): Promise<Result<{ cardId: string; model: string; dropped: string[] }>> {
  const language = languageOf(languageInput);
  const session = await requireAdmin();
  if (!session) return denied;
  const concept = await conceptRow(key, language);
  if (!concept) return { success: false, error: "That concept doesn't exist." };
  const all = await prisma.compassConcept.findMany({ where: { language }, select: { key: true, labelEn: true } });
  let previous: CardDraft | undefined;
  if (options.fromCardId) {
    const card = await prisma.compassCard.findFirst({ where: { id: options.fromCardId, conceptId: concept.id } });
    if (card) previous = fromColumns(card);
  }
  // Amplify stops a request at 28 s (lib/request-budget.ts).
  const result = await draftCard({ concept, allConcepts: all, model: options.model, instruction: options.instruction?.slice(0, 4000), previous, userId: session.user.id, deadline: Date.now() + REQUEST_BUDGET_MS, language });
  if (!result.ok) return { success: false, error: result.error };
  const card = await prisma.compassCard.create({
    data: { conceptId: concept.id, version: (concept.cards[0]?.version ?? 0) + 1, status: "DRAFT", author: result.model, ...(toColumns(result.card, language) as Omit<Prisma.CompassCardCreateInput, "concept" | "version" | "author">) },
  });
  refresh(language);
  return { success: true, cardId: card.id, model: result.model, dropped: result.dropped };
}

/**
 * Saves the admin's edit: a draft is updated in place (and has to be proven again); a proven or published version
 * stays as it is, and the edit becomes a new draft version.
 */
export async function saveCompassCard(key: string, cardId: string | null, input: CardDraft, languageInput: CompassLanguage = "python"): Promise<Result<{ cardId: string; problems: string[] }>> {
  const language = languageOf(languageInput);
  const session = await requireAdmin();
  if (!session) return denied;
  const parsed = CardSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: `The card isn't complete: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
  const concept = await conceptRow(key, language);
  if (!concept) return { success: false, error: "That concept doesn't exist." };
  const keys = new Set((await prisma.compassConcept.findMany({ where: { language }, select: { key: true } })).map((entry) => entry.key));
  const problems = checkDraft(parsed.data, keys, language);
  if (problems.length) return { success: false, error: problems.join(" ") };
  const columns = toColumns(parsed.data, language) as Omit<Prisma.CompassCardCreateInput, "concept" | "version" | "author">;
  const current = cardId ? await prisma.compassCard.findFirst({ where: { id: cardId, conceptId: concept.id } }) : null;
  if (current?.status === "DRAFT") {
    await prisma.compassCard.update({ where: { id: current.id }, data: { ...columns, proof: Prisma.DbNull, author: current.author === "admin" ? "admin" : `${current.author} + admin` } });
    refresh(language);
    return { success: true, cardId: current.id, problems: [] };
  }
  const card = await prisma.compassCard.create({ data: { conceptId: concept.id, version: (concept.cards[0]?.version ?? 0) + 1, status: "DRAFT", author: "admin", ...columns } });
  refresh(language);
  return { success: true, cardId: card.id, problems: [] };
}

/** Runs a version's examples and mistakes on the grader; when every one behaves as the card says, it's PROVEN. */
export async function proveCompassCard(cardId: string): Promise<Result<{ proof: CardProof }>> {
  if (!(await requireAdmin())) return denied;
  const card = await prisma.compassCard.findUnique({ where: { id: cardId }, include: { concept: { select: { language: true } } } });
  if (!card) return { success: false, error: "That card is gone. Reload the page." };
  // Proven on its own language's runtime: Python's grader, or the TypeScript sandbox.
  const language = languageOf(card.concept.language);
  const proof = await proveCard(fromColumns(card), language);
  if (proof.unavailable) return { success: false, error: `The grader can't be reached: ${proof.unavailable}` };
  await prisma.compassCard.update({
    where: { id: cardId },
    data: { proof: proof as unknown as Prisma.InputJsonValue, ...(card.status === "DRAFT" || card.status === "PROVEN" ? { status: proof.ok ? "PROVEN" : "DRAFT" } : {}) },
  });
  refresh(language);
  return { success: true, proof };
}

/**
 * The code is the truth: an example (or a mistake that prints) whose output differed takes what it really printed,
 * then the version is proven again. Code that raised where it shouldn't, or didn't raise where it should, stays for
 * the admin to fix.
 */
export async function adoptRealOutputs(cardId: string): Promise<Result<{ proof: CardProof; draft: CardDraft }>> {
  if (!(await requireAdmin())) return denied;
  const card = await prisma.compassCard.findUnique({ where: { id: cardId }, include: { concept: { select: { language: true } } } });
  if (!card || card.status !== "DRAFT") return { success: false, error: "Only a draft's outputs can be replaced." };
  const proof = card.proof as CardProof | null;
  if (!proof) return { success: false, error: "Prove the card first." };
  const draft = fromColumns(card);
  for (const item of proof.items) {
    if (item.ok || item.error) continue;
    if (item.kind === "example") draft.examples[item.index] = { ...draft.examples[item.index], output: item.actual.replace(/\n+$/, "") };
    else if (!draft.mistakes[item.index].raises) draft.mistakes[item.index] = { ...draft.mistakes[item.index], output: item.actual.replace(/\n+$/, "") };
  }
  await prisma.compassCard.update({ where: { id: cardId }, data: toColumns(draft, languageOf(card.concept.language)) as Prisma.CompassCardUpdateInput });
  const proved = await proveCompassCard(cardId);
  // The editor keeps its own copy of the card: it takes this one, or it would count the old outputs as unsaved changes.
  return proved.success ? { ...proved, draft } : proved;
}

/**
 * Fix with AI (docs/compass.md): a model repairs what the last proof found wrong in a version, from the code, what the
 * card claims and what the runtime did. The repair is a new draft version (the one it came from stays as it is), and it
 * is proven straight away, so the admin sees at once whether it worked.
 */
export async function fixCompassCard(cardId: string, model?: string): Promise<Result<{ cardId: string; model: string; changed: string[]; proof: CardProof | null }>> {
  const session = await requireAdmin();
  if (!session) return denied;
  const card = await prisma.compassCard.findUnique({ where: { id: cardId }, include: { concept: { include: { cards: { orderBy: { version: "desc" }, take: 1, select: { version: true } } } } } });
  if (!card) return { success: false, error: "That card is gone. Reload the page." };
  const proof = card.proof as CardProof | null;
  if (!proof || proof.ok) return { success: false, error: "Prove the card first: the fix works from what the proof found." };
  const language = languageOf(card.concept.language);
  const all = await prisma.compassConcept.findMany({ where: { language }, select: { key: true } });
  // Leave time for the proof after the model: Amplify stops a request at 28 s (lib/request-budget.ts).
  const result = await repairCard({ card: fromColumns(card), proof, allConcepts: all, conceptKey: card.concept.key, model, userId: session.user.id, deadline: Date.now() + REQUEST_BUDGET_MS - 6_000, language });
  if (!result.ok) return { success: false, error: result.error };
  const created = await prisma.compassCard.create({
    data: {
      conceptId: card.conceptId,
      version: (card.concept.cards[0]?.version ?? card.version) + 1,
      status: "DRAFT",
      author: `${result.model} (fix of v${card.version})`,
      ...(toColumns(result.card, language) as Omit<Prisma.CompassCardCreateInput, "concept" | "version" | "author">),
    },
  });
  const proved = await proveCompassCard(created.id);
  refresh(language);
  return { success: true, cardId: created.id, model: result.model, changed: result.changed, proof: proved.success ? proved.proof : null };
}

/** Publishes a proven version for learners; the version published before is retired. */
export async function publishCompassCard(cardId: string): Promise<Result> {
  const session = await requireAdmin();
  if (!session) return denied;
  const card = await prisma.compassCard.findUnique({ where: { id: cardId }, include: { concept: { select: { language: true } } } });
  if (!card) return { success: false, error: "That card is gone. Reload the page." };
  if (card.status !== "PROVEN") return { success: false, error: "Prove the card first: every example has to run as it says." };
  await prisma.$transaction([
    prisma.compassCard.updateMany({ where: { conceptId: card.conceptId, status: "PUBLISHED" }, data: { status: "RETIRED" } }),
    prisma.compassCard.update({ where: { id: cardId }, data: { status: "PUBLISHED", publishedAt: new Date(), reviewedById: session.user.id } }),
  ]);
  refresh(languageOf(card.concept.language));
  return { success: true };
}

/** Loads the concepts from the course inventory bundled with this version of the platform (docs/compass.md). */
export async function syncCompassConcepts(languageInput: CompassLanguage = "python"): Promise<Result<{ concepts: number; commit: string }>> {
  const language = languageOf(languageInput);
  if (!(await requireAdmin())) return denied;
  const result = await syncConcepts(language);
  refresh(language);
  return { success: true, ...result };
}
