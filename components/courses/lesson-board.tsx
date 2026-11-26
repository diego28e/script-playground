"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, ChevronDown, PenLine } from "lucide-react";
import type { BoardDone, BoardOffer } from "@/lib/board/offer";
import { cn } from "@/lib/utils";

// "Learn on the whiteboard" on the lesson page (docs/whiteboard.md): the lesson's skills, each with the learner's state
// in practice, its board (continued when one is open), and the newest board the teacher finished on it, with what that
// board found. Or the whole lesson while its skills aren't approved yet.

const COPY = {
  es: {
    title: "Aprende en la pizarra",
    text: "Un profesor que habla y dibuja contigo, una habilidad cada vez. Sabe qué estás aprendiendo y cómo te ha ido en la práctica.",
    open: "Abrir",
    continue: "Seguir",
    next: "Siguiente",
    lesson: "Aprender esta lección en la pizarra",
    done: (date: string) => `Hecha en la pizarra · ${date}`,
    found: "Lo que encontró la pizarra",
    taught: "Se explicó",
    showed: "Mostraste",
    struggles: "Te costó",
    minutes: (minutes: number) => `${Math.max(1, Math.round(minutes))} min`,
    ready: "Lista para practicar: va primero en tu práctica.",
    practise: "Ir a practicar",
    replay: "Ver la pizarra",
    states: { new: "Nueva", learning: "Aprendiendo", reviewing: "Repasando", secure: "Dominada" },
  },
  en: {
    title: "Learn on the whiteboard",
    text: "A teacher who talks and draws with you, one skill at a time. It knows what you're learning and how your practice went.",
    open: "Open",
    continue: "Continue",
    next: "Next",
    lesson: "Learn this lesson on the whiteboard",
    done: (date: string) => `Done on the board · ${date}`,
    found: "What the board found",
    taught: "Explained",
    showed: "You showed",
    struggles: "You found hard",
    minutes: (minutes: number) => `${Math.max(1, Math.round(minutes))} min`,
    ready: "Ready to practise: it goes first in your practice.",
    practise: "Go to practice",
    replay: "See the board",
    states: { new: "New", learning: "Learning", reviewing: "Reviewing", secure: "Secure" },
  },
};

const STATE_TONE = {
  new: "bg-muted text-muted-foreground",
  learning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  reviewing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  secure: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
} as const;

const linkClass = "inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

/** The newest finished board's mark: a toggle that shows what it found. */
function DoneMark({ done, language, open, onToggle, id }: { done: BoardDone; language: "es" | "en"; open: boolean; onToggle: () => void; id: string }) {
  const t = COPY[language];
  const date = new Date(done.at).toLocaleDateString(language === "es" ? "es" : "en-US", { month: "short", day: "numeric" });
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={id}
      className="inline-flex items-center gap-1 rounded-full bg-ring/15 px-2 py-0.5 font-medium text-ring transition-colors hover:bg-ring/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Check className="size-3" aria-hidden="true" />
      {t.done(date)}
      <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
  );
}

/** What the board found: what was explained, what the learner showed, what was hard, and the way on. */
function Found({ done, language, id, boardHref, practiceHref }: { done: BoardDone; language: "es" | "en"; id: string; boardHref: string; practiceHref: string }) {
  const t = COPY[language];
  const part = (label: string, items: string[]) =>
    items.length ? (
      <div>
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5">
          <ul className="list-disc space-y-0.5 pl-4 text-sm leading-relaxed">
            {items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </dd>
      </div>
    ) : null;
  return (
    <div id={id} className="mt-2 rounded-xl bg-muted/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t.found} · {t.minutes(done.minutes)}
      </p>
      <dl className="mt-2 space-y-2">
        {part(t.taught, done.taught)}
        {part(t.showed, done.learnerDid)}
        {part(t.struggles, done.struggles)}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {done.readyToPractise && (
          <span className="text-muted-foreground">
            {t.ready}{" "}
            <Link href={practiceHref} className={linkClass}>
              {t.practise}
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </span>
        )}
        <Link prefetch={false} href={boardHref} className={linkClass}>
          {t.replay}
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function LessonBoard({ offer, lessonHref, practiceHref, language }: { offer: BoardOffer; lessonHref: string; practiceHref: string; language: "es" | "en" }) {
  const t = COPY[language];
  const [shown, setShown] = useState<string | null>(null);
  const next = offer.skills.find((skill) => skill.state !== "secure")?.key;
  const toggle = (key: string) => setShown((current) => (current === key ? null : key));
  const sessionHref = (done: BoardDone) => `${lessonHref}/board?session=${encodeURIComponent(done.sessionId)}`;
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
          {offer.skills.map((skill) => {
            const foundId = `board-found-${skill.key}`;
            return (
              <li key={skill.key} className="py-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{language === "es" ? skill.labelEs : skill.labelEn}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={cn("rounded-full px-2 py-0.5 font-medium", STATE_TONE[skill.state])}>{t.states[skill.state]}</span>
                      {skill.done && <DoneMark done={skill.done} language={language} open={shown === skill.key} onToggle={() => toggle(skill.key)} id={foundId} />}
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
                </div>
                {skill.done && shown === skill.key && <Found done={skill.done} language={language} id={foundId} boardHref={sessionHref(skill.done)} practiceHref={practiceHref} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              prefetch={false}
              href={`${lessonHref}/board`}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {offer.lessonOpen ? t.continue : t.lesson}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
            {offer.lessonDone && (
              <span className="text-xs">
                <DoneMark done={offer.lessonDone} language={language} open={shown === "lesson"} onToggle={() => toggle("lesson")} id="board-found-lesson" />
              </span>
            )}
          </div>
          {offer.lessonDone && shown === "lesson" && <Found done={offer.lessonDone} language={language} id="board-found-lesson" boardHref={sessionHref(offer.lessonDone)} practiceHref={practiceHref} />}
        </div>
      )}
    </section>
  );
}
