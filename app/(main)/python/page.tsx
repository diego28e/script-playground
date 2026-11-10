import type { Metadata } from "next";
import { publishedIndex } from "@/lib/compass/guide";
import { GuideHome } from "@/components/compass/guide-home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Python Compass · Academia del Código",
  description: "The Python you'll use in the course, explained plainly, with examples you can run and links to the official docs.",
};

/** The learners' Python guide (docs/compass.md, "The guide"): every published card, searchable. */
export default async function PythonGuidePage() {
  return <GuideHome entries={await publishedIndex()} />;
}
