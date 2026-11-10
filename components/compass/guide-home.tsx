"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Compass, Search, X } from "lucide-react";
import { logGuideSearch } from "@/actions/compass-guide";
import { useLanguage } from "@/components/providers/language-provider";
import type { GuideEntry } from "@/lib/compass/guide";
import { cn } from "@/lib/utils";

// The learners' Python guide (docs/compass.md, "The guide"): search first, since a learner comes with a question
// ("how do I…", "what is **kwargs"), then every published card in the order the course needs them. The search runs
// in the browser over the published cards, so it answers as you type; a search the learner settles on is recorded,
// and one that finds nothing tells the admin which card to write next.

const COPY = {
  es: {
    eyebrow: "Python Compass",
    title: "El Python que vas a usar en el curso",
    lead: "Cada idea de Python explicada sin rodeos, con ejemplos que puedes cambiar y ejecutar aquí mismo, y el enlace exacto a la documentación oficial.",
    search: "¿Qué quieres saber? (“f-string”, “**kwargs”, “cómo recorro un diccionario”…)",
    clear: "Borrar la búsqueda",
    start: "En el orden en que el curso los usa",
    results: (n: number) => `${n} ${n === 1 ? "resultado" : "resultados"}`,
    none: (query: string) => `Todavía no hay una tarjeta para “${query}”. Lo anotamos: así sabemos qué tarjeta escribir.`,
    lessons: (n: number, first: string | null) => `${n} lecciones${first ? ` · desde la ${first}` : ""}`,
    empty: "Estamos escribiendo las primeras tarjetas. Vuelve pronto.",
  },
  en: {
    eyebrow: "Python Compass",
    title: "The Python you'll use in the course",
    lead: "Every Python idea explained plainly, with examples you can change and run right here, and the exact link to the official documentation.",
    search: "What do you want to know? (“f-string”, “**kwargs”, “how do I loop over a dict”…)",
    clear: "Clear the search",
    start: "In the order the course uses them",
    results: (n: number) => `${n} ${n === 1 ? "result" : "results"}`,
    none: (query: string) => `There's no card for “${query}” yet. We noted it, so we know which card to write.`,
    lessons: (n: number, first: string | null) => `${n} lessons${first ? ` · from ${first}` : ""}`,
    empty: "The first cards are being written. Come back soon.",
  },
};

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** How well an entry matches the query: its name and title first, then its summary, then what its explanation says. */
function score(entry: GuideEntry, query: string): number {
  const needle = fold(query.trim());
  if (!needle) return 0;
  const words = needle.split(/[^a-z0-9_*.:]+/).filter((word) => word.length > 1);
  const name = fold(`${entry.key} ${entry.key.replaceAll("-", " ")} ${entry.label.es} ${entry.label.en} ${entry.title.es} ${entry.title.en}`);
  const summary = fold(`${entry.summary.es} ${entry.summary.en}`);
  const body = fold(entry.body);
  let total = 0;
  if (name.includes(needle)) total += 20;
  if (summary.includes(needle)) total += 8;
  if (body.includes(needle)) total += 3;
  for (const word of words) {
    if (name.includes(word)) total += 5;
    else if (summary.includes(word)) total += 2;
    else if (body.includes(word)) total += 1;
  }
  // Every word should appear somewhere, or it's a weak match.
  if (words.length > 1 && !words.every((word) => name.includes(word) || summary.includes(word) || body.includes(word))) total = Math.min(total, 2);
  return total;
}

export function GuideHome({ entries }: { entries: GuideEntry[] }) {
  const { language } = useLanguage();
  const t = COPY[language];
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return null;
    return entries
      .map((entry) => ({ entry, score: score(entry, query) }))
      .filter((match) => match.score > 2)
      .sort((a, b) => b.score - a.score || (a.entry.usageRank ?? 1e6) - (b.entry.usageRank ?? 1e6))
      .map((match) => match.entry);
  }, [entries, query]);

  // A search the learner settled on (a pause, or Enter): recorded once, with whether anything matched.
  const logged = useRef("");
  const log = (text: string) => {
    const settled = text.trim();
    if (settled.length < 2 || settled === logged.current || !results) return;
    logged.current = settled;
    void logGuideSearch({ query: settled, results: results.length, top: results[0]?.key ?? null }).catch(() => undefined);
  };
  useEffect(() => {
    const timer = setTimeout(() => log(query), 1500);
    return () => clearTimeout(timer);
  });

  const shown = results ?? entries;
  return (
    <div className="container mx-auto max-w-4xl px-4 py-12 md:py-16">
      <p className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <Compass className="size-4" aria-hidden="true" /> {t.eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-light tracking-tight text-balance md:text-5xl">{t.title}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">{t.lead}</p>

      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          log(query);
        }}
        className="relative mt-8"
      >
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search}
          aria-label={t.search}
          autoFocus
          className="h-14 w-full rounded-2xl border border-input bg-card pl-12 pr-12 text-base shadow-[var(--shadow-tile)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            aria-label={t.clear}
            className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </form>

      <div className="mt-8" aria-live="polite">
        {entries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">{t.empty}</p>
        ) : results && results.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">{t.none(query.trim())}</p>
        ) : (
          <>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{results ? t.results(results.length) : t.start}</p>
            <ol className="grid gap-3 sm:grid-cols-2">
              {shown.map((entry) => (
                <li key={entry.key}>
                  <Link
                    href={`/python/${encodeURIComponent(entry.key)}`}
                    className={cn("group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-lg font-medium leading-snug tracking-tight">{entry.title[language] || entry.label[language]}</span>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
                    </span>
                    <span className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{entry.summary[language]}</span>
                    {entry.lessonCount > 0 && <span className="mt-3 font-mono text-[11px] text-muted-foreground">{t.lessons(entry.lessonCount, entry.firstLesson)}</span>}
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
