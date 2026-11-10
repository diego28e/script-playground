"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { logCardView } from "@/actions/compass-guide";
import { ConceptCard } from "@/components/compass/concept-card";
import { ExampleRunner } from "@/components/compass/example-runner";
import { useLanguage } from "@/components/providers/language-provider";
import type { CardDraft } from "@/lib/compass/cards";
import type { DocLink } from "@/lib/compass/docs";

// One card of the learners' Python guide (docs/compass.md, "The guide"): the published card in the learner's language,
// its examples runnable, and its related concepts as links when they have cards.

export function CompassCardPage({
  conceptKey,
  card,
  links,
  related,
  usage,
  signedIn,
}: {
  conceptKey: string;
  card: CardDraft;
  links: Record<string, DocLink>;
  related: { key: string; label: { es: string; en: string }; published: boolean }[];
  usage: { lessonCount: number; firstLesson: string | null };
  signedIn: boolean;
}) {
  const { language } = useLanguage();
  useEffect(() => {
    void logCardView(conceptKey).catch(() => undefined);
  }, [conceptKey]);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 md:py-14">
      <Link href="/python" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        <Compass className="size-4" aria-hidden="true" /> {language === "es" ? "Guía de Python" : "Python guide"}
      </Link>
      <div className="mt-6">
        <ConceptCard
          card={{ ...card, related: [] }}
          links={links}
          language={language}
          usage={usage}
          renderExample={(example) => <ExampleRunner code={example.code} output={example.output} language={language} signedIn={signedIn} />}
        />
      </div>
      {related.length > 0 && (
        <nav aria-label={language === "es" ? "Relacionado" : "Related"} className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-6">
          <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{language === "es" ? "Relacionado" : "Related"}</span>
          {related.map((entry) =>
            entry.published ? (
              <Link key={entry.key} href={`/python/${encodeURIComponent(entry.key)}`} className="rounded-full border border-border px-3 py-1 text-sm transition-colors hover:border-foreground/40 hover:bg-accent">
                {entry.label[language]}
              </Link>
            ) : (
              <span key={entry.key} className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                {entry.label[language]}
              </span>
            ),
          )}
        </nav>
      )}
    </div>
  );
}
