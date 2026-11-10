"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Tip } from "@/components/ui/tip";
import type { LessonPython, LessonPythonConcept } from "@/lib/compass/lesson";
import { cn } from "@/lib/utils";

// "Python in this lesson" (docs/compass.md): on the lesson page, before the learner starts, the Python its notebook
// uses for the first time in the course, and the rest that has a card. A construct with a card opens it in the
// Python guide; one without yet is named all the same, so the learner knows what to look up.

const COPY = {
  es: {
    heading: "Python en esta lección",
    fresh: "Nuevo aquí",
    also: "También usa",
    guide: "Guía de Python",
    more: (n: number) => `+${n} más`,
    less: "Menos",
    soon: "Su tarjeta llega pronto",
  },
  en: {
    heading: "Python in this lesson",
    fresh: "New here",
    also: "Also uses",
    guide: "Python guide",
    more: (n: number) => `+${n} more`,
    less: "Fewer",
    soon: "Its card is coming soon",
  },
};

// A row shows its first SHOWN chips and folds the rest behind "+N more", but only when that hides a few: a button
// that hides one or two chips takes about their room.
const SHOWN = 8;
const FOLD_AT = SHOWN + 3;

function Chip({ concept, language, fresh, soon }: { concept: LessonPythonConcept; language: "es" | "en"; fresh?: boolean; soon: string }) {
  const label = concept.label[language];
  if (!concept.published) {
    return (
      <Tip content={soon}>
        <span tabIndex={0} className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground">
          {label}
        </span>
      </Tip>
    );
  }
  return (
    <Link
      href={`/python/${encodeURIComponent(concept.key)}?from=lesson`}
      target="_blank"
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        fresh ? "bg-foreground text-background hover:bg-foreground/85" : "bg-muted text-foreground hover:bg-accent",
      )}
    >
      {label}
    </Link>
  );
}

function Row({ title, concepts, language, fresh, t, icon }: { title: string; concepts: LessonPythonConcept[]; language: "es" | "en"; fresh?: boolean; t: (typeof COPY)["en"]; icon?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  if (!concepts.length) return null;
  const folds = concepts.length >= FOLD_AT;
  const shown = all || !folds ? concepts : concepts.slice(0, SHOWN);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {icon}
        {title}
      </span>
      {shown.map((concept) => (
        <Chip key={concept.key} concept={concept} language={language} fresh={fresh} soon={t.soon} />
      ))}
      {folds && (
        <button type="button" onClick={() => setAll(!all)} className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          {all ? t.less : t.more(concepts.length - SHOWN)}
        </button>
      )}
    </div>
  );
}

export function LessonPythonSection({ python, language }: { python: LessonPython; language: "es" | "en" }) {
  const t = COPY[language];
  return (
    <section className="space-y-2.5 border-t border-border py-6 first:border-t-0" aria-labelledby="lesson-python">
      <div className="flex items-center justify-between gap-3">
        <h2 id="lesson-python" className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t.heading}
        </h2>
        <Link href="/python" target="_blank" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {t.guide} <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </div>
      <Row title={t.fresh} concepts={python.fresh} language={language} fresh t={t} icon={<Sparkles className="size-3.5" aria-hidden="true" />} />
      <Row title={t.also} concepts={python.also} language={language} t={t} />
    </section>
  );
}
