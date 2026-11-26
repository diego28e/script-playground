"use client";

import Link from "next/link";
import { ArrowRight, PenLine } from "lucide-react";
import type { BoardOffer } from "@/lib/board/offer";
import { cn } from "@/lib/utils";

// "Learn on the whiteboard" on the lesson page (docs/whiteboard.md): the lesson's skills, each with the learner's state
// and its board (continued when one is open), or the whole lesson while its skills aren't approved yet.

const COPY = {
  es: {
    title: "Aprende en la pizarra",
    text: "Un profesor que habla y dibuja contigo, una habilidad cada vez. Sabe qué estás aprendiendo y cómo te ha ido en la práctica.",
    open: "Abrir",
    continue: "Seguir",
    next: "Siguiente",
    lesson: "Aprender esta lección en la pizarra",
    states: { new: "Nueva", learning: "Aprendiendo", reviewing: "Repasando", secure: "Dominada" },
  },
  en: {
    title: "Learn on the whiteboard",
    text: "A teacher who talks and draws with you, one skill at a time. It knows what you're learning and how your practice went.",
    open: "Open",
    continue: "Continue",
    next: "Next",
    lesson: "Learn this lesson on the whiteboard",
    states: { new: "New", learning: "Learning", reviewing: "Reviewing", secure: "Secure" },
  },
};

const STATE_TONE = {
  new: "bg-muted text-muted-foreground",
  learning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  reviewing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  secure: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
} as const;

export function LessonBoard({ offer, lessonHref, language }: { offer: BoardOffer; lessonHref: string; language: "es" | "en" }) {
  const t = COPY[language];
  const next = offer.skills.find((skill) => skill.state !== "secure")?.key;
  return (
    <section aria-labelledby="lesson-board-title" className="mt-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ring/15 text-ring">
          <PenLine className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="lesson-board-title" className="text-base font-semibold">
            {t.title}
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{t.text}</p>
        </div>
      </div>
      {offer.skills.length ? (
        <ul className="mt-4 divide-y divide-border">
          {offer.skills.map((skill) => (
            <li key={skill.key} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{language === "es" ? skill.labelEs : skill.labelEn}</p>
                <p className="mt-0.5 flex items-center gap-2 text-xs">
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", STATE_TONE[skill.state])}>{t.states[skill.state]}</span>
                  {skill.key === next && <span className="font-medium text-ring">{t.next}</span>}
                </p>
              </div>
              <Link
                // Opening a board creates its session: never ahead of the click.
                prefetch={false}
                href={`${lessonHref}/board?skill=${encodeURIComponent(skill.key)}`}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  skill.key === next ? "bg-foreground text-background hover:opacity-90" : "border border-border hover:bg-accent",
                )}
              >
                {skill.open ? t.continue : t.open}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Link
          prefetch={false}
          href={`${lessonHref}/board`}
          className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {offer.lessonOpen ? t.continue : t.lesson}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}
