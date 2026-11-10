import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { publishedCard } from "@/lib/compass/guide";
import { CompassCardPage } from "@/components/compass/card-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  const found = await publishedCard(decodeURIComponent(key));
  return found ? { title: `${found.card.titleEn} · Python Compass`, description: found.card.summaryEn } : {};
}

/** One published card of the Python guide; a concept without one is a 404. */
export default async function PythonCardPage({ params }: Props) {
  const { key } = await params;
  const found = await publishedCard(decodeURIComponent(key));
  if (!found) notFound();
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return <CompassCardPage conceptKey={found.key} card={found.card} links={found.links} related={found.related} usage={found.usage} signedIn={Boolean(session)} />;
}
