"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { publishedConcepts } from "@/lib/compass/guide";
import { recordSignal } from "@/lib/compass/signals";

// The learners' Python guide (docs/compass.md, "The guide"): what it records as it's used, and the labels the
// scratchbook links constructs with. Searching itself happens in the browser over the published cards (instant).

async function userId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.id ?? null;
}

const SearchSchema = z.object({ query: z.string().trim().min(2).max(200), results: z.number().int().min(0).max(1000), top: z.string().max(100).nullable() });

/** A search the learner settled on (they paused or pressed Enter): what they typed, and whether anything matched. */
export async function logGuideSearch(input: z.input<typeof SearchSchema>): Promise<void> {
  const parsed = SearchSchema.safeParse(input);
  if (!parsed.success) return;
  await recordSignal({ kind: "SEARCH", userId: await userId(), text: parsed.data.query, empty: parsed.data.results === 0, conceptKey: parsed.data.top, surface: "guide" });
}

/** A card a learner opened. */
export async function logCardView(key: string, from: string | null = null): Promise<void> {
  if (!/^[a-z0-9:_.-]{1,80}$/i.test(key)) return;
  // Where the learner came from: a lesson's "Python in this lesson", the scratchbook, or the guide itself.
  const surface = from === "lesson" ? "lesson" : from === "scratchbook" ? "scratchbook" : "guide";
  await recordSignal({ kind: "CARD_VIEW", userId: await userId(), conceptKey: key, surface });
}

/** Every concept with a published card, by key: the scratchbook turns the constructs it finds into links to them. */
export async function getPublishedConcepts(): Promise<Record<string, { es: string; en: string }>> {
  return publishedConcepts();
}
