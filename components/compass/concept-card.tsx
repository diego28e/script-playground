import ReactMarkdown from "react-markdown";
import { AlertTriangle, ArrowUpRight, BookOpen, Lightbulb } from "lucide-react";
import type { CardDraft } from "@/lib/compass/cards";
import type { DocLink } from "@/lib/compass/docs";
import { cn } from "@/lib/utils";

// A Python Compass card as a learner reads it (docs/compass.md): the admin's editor previews it live, and the guide's
// pages will show it. Code on the platform's dark code surface in both themes; the official docs as plain links.

const COPY = {
  es: { when: "Úsalo cuando", examples: "Ejemplos", mistake: "Error común", why: "Por qué", fix: "Cómo se escribe", prints: "Imprime", raises: "Lanza", docs: "Documentación oficial de Python", related: "Relacionado", inCourse: (n: number, first: string | null) => `Aparece en ${n} lecciones del curso${first ? `, desde la ${first}` : ""}.` },
  en: { when: "Reach for it when", examples: "Examples", mistake: "Common mistake", why: "Why", fix: "How to write it", prints: "Prints", raises: "Raises", docs: "Official Python documentation", related: "Related", inCourse: (n: number, first: string | null) => `Used in ${n} lessons of the course${first ? `, from ${first}` : ""}.` },
};

const MARKDOWN = "text-[15px] leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.88em] [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2.5 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-code [&_pre]:p-3.5 [&_pre]:text-[13px] [&_pre]:text-code-foreground [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5";

function Code({ code, className }: { code: string; className?: string }) {
  return <pre className={cn("overflow-x-auto rounded-xl bg-code p-3.5 font-mono text-[13px] leading-relaxed text-code-foreground", className)}>{code}</pre>;
}

export function ConceptCard({
  card,
  links,
  language,
  related,
  usage,
  renderExample,
}: {
  /** Draws an example another way (the guide's pages make it runnable); the static code and output otherwise. */
  renderExample?: (example: CardDraft["examples"][number], index: number) => React.ReactNode;
  card: CardDraft;
  /** The docs links by key (the card stores keys; the page resolves them). */
  links: Record<string, DocLink>;
  language: "es" | "en";
  /** Related concepts' labels by key. */
  related?: Record<string, string>;
  usage?: { lessonCount: number; firstLesson: string | null };
}) {
  const t = COPY[language];
  const es = language === "es";
  const docs = card.docs.map((key) => links[key]).filter(Boolean);
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{es ? card.titleEs : card.titleEn}</h2>
        <p className="text-lg leading-snug text-muted-foreground">{es ? card.summaryEs : card.summaryEn}</p>
        {usage && usage.lessonCount > 0 && <p className="font-mono text-xs text-muted-foreground">{t.inCourse(usage.lessonCount, usage.firstLesson)}</p>}
      </header>

      <div className={MARKDOWN}>
        <ReactMarkdown>{es ? card.explanationEs : card.explanationEn}</ReactMarkdown>
      </div>

      <p className="flex gap-2.5 rounded-xl bg-muted/60 p-3.5 text-sm leading-relaxed">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-foreground/70" aria-hidden="true" />
        <span>
          <span className="font-medium">{t.when}: </span>
          {(es ? card.whenEs : card.whenEn).replace(/^(Úsalo cuando|Reach for it when)[:,]?\s*/i, "")}
        </span>
      </p>

      {card.examples.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t.examples}</h3>
          {card.examples.map((example, index) => (
            <figure key={index} className="space-y-1.5">
              {renderExample ? (
                renderExample(example, index)
              ) : (
                <div className="overflow-hidden rounded-xl ring-1 ring-code-border">
                  <Code code={example.code} className="rounded-none" />
                  <div className="border-t border-code-border bg-code-panel px-3.5 py-2.5 font-mono text-[13px] text-code-foreground">
                    <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-code-muted">{t.prints}</span>
                    <span className="whitespace-pre-wrap text-signal">{example.output || "(nothing)"}</span>
                  </div>
                </div>
              )}
              {(es ? example.noteEs : example.noteEn) && <figcaption className="text-sm text-muted-foreground">{es ? example.noteEs : example.noteEn}</figcaption>}
            </figure>
          ))}
        </section>
      )}

      {card.mistakes.map((mistake, index) => (
        <section key={index} className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-200">
            <AlertTriangle className="size-4" aria-hidden="true" /> {t.mistake}
          </h3>
          <div className="overflow-hidden rounded-xl ring-1 ring-code-border">
            <Code code={mistake.code} className="rounded-none" />
            <div className="border-t border-code-border bg-code-panel px-3.5 py-2.5 font-mono text-[13px]">
              <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-code-muted">{mistake.raises ? t.raises : t.prints}</span>
              <span className={cn("whitespace-pre-wrap", mistake.raises ? "text-red-300" : "text-code-foreground")}>{mistake.raises || mistake.output}</span>
            </div>
          </div>
          <p className="text-sm leading-relaxed">
            <span className="font-medium">{t.why}: </span>
            {es ? mistake.whyEs : mistake.whyEn}
          </p>
          {(es ? mistake.fixEs : mistake.fixEn) && (
            <div className={cn("text-sm leading-relaxed", MARKDOWN)}>
              <ReactMarkdown>{`**${t.fix}:** ${es ? mistake.fixEs : mistake.fixEn}`}</ReactMarkdown>
            </div>
          )}
        </section>
      ))}

      {docs.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <BookOpen className="size-3.5" aria-hidden="true" /> {t.docs}
          </h3>
          <ul className="space-y-1">
            {docs.map((link) => (
              <li key={link.key}>
                <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline decoration-border underline-offset-4 hover:decoration-foreground">
                  {link.title}
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.related.length > 0 && related && (
        <section className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t.related}</span>
          {card.related.map((key) => (
            <span key={key} className="rounded-full bg-muted px-2.5 py-1 text-xs">
              {related[key] ?? key}
            </span>
          ))}
        </section>
      )}
    </article>
  );
}
