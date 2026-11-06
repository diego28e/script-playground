"use client";

import Link from "next/link";
import { ArrowLeft, Layers, Lock, Repeat } from "lucide-react";
import type { PracticeMapData } from "@/actions/practice-learner";
import { useLanguage } from "@/components/providers/language-provider";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

// The progress map (docs/practice.md, "What the learner sees"): every skill of the course, grouped by module and
// lesson, coloured by where the learner stands, with how far up its ladder they are and when it comes back.

const STATUSES = ["mastered", "credited", "reviewing", "learning", "ready", "upcoming", "locked", "suspended"] as const;
type Status = (typeof STATUSES)[number];

const COPY = {
  es: {
    eyebrow: "Mi mapa",
    back: "Volver a la práctica",
    practise: "Practicar hoy",
    notReady: "La práctica de este curso aún no está lista. Vuelve pronto.",
    status: {
      mastered: "Dominada",
      credited: "Convalidada",
      reviewing: "Repasando",
      learning: "Aprendiendo",
      ready: "Lista para empezar",
      upcoming: "Llega con su lección",
      locked: "Bloqueada",
      suspended: "En pausa",
    } as Record<Status, string>,
    stage: { recognise: "Reconocer", recall: "Recordar", produce: "Producir", apply: "Aplicar", example: "Ejemplo", complete: "Completar", write: "Escribir", transfer: "Transferir" } as Record<string, string>,
    dueNow: "Toca hoy",
    dueIn: (days: number) => (days === 1 ? "Vuelve mañana" : `Vuelve en ${days} días`),
    recall: (percent: number) => `${percent}% de recuerdo`,
    lesson: "Lección",
    found: "Base que te faltaba",
    module: "Módulo",
  },
  en: {
    eyebrow: "My map",
    back: "Back to practice",
    practise: "Practise today",
    notReady: "Practice for this course isn't ready yet. Check back soon.",
    status: {
      mastered: "Mastered",
      credited: "Credited",
      reviewing: "Reviewing",
      learning: "Learning",
      ready: "Ready to start",
      upcoming: "Comes with its lesson",
      locked: "Locked",
      suspended: "Paused",
    } as Record<Status, string>,
    stage: { recognise: "Recognise", recall: "Recall", produce: "Produce", apply: "Apply", example: "Example", complete: "Complete", write: "Write", transfer: "Transfer" } as Record<string, string>,
    dueNow: "Due today",
    dueIn: (days: number) => (days === 1 ? "Back tomorrow" : `Back in ${days} days`),
    recall: (percent: number) => `${percent}% recall`,
    lesson: "Lesson",
    found: "Groundwork you were missing",
    module: "Module",
  },
};

/** Each ladder in order; a skill's stage is one of these, so its rung is its place in its own ladder. */
const LADDERS = [
  ["recognise", "recall", "produce", "apply"],
  ["example", "complete", "write", "transfer"],
];
function rung(stage: string | null): number {
  if (!stage) return 0;
  for (const ladder of LADDERS) {
    const at = ladder.indexOf(stage);
    if (at !== -1) return at + 1;
  }
  return 0;
}

const TILE: Record<Status, string> = {
  mastered: "border-ring bg-ring text-background",
  credited: "border-ring/60 bg-ring/70 text-background",
  reviewing: "border-ring/50 bg-ring/25",
  learning: "border-ring/40 bg-ring/12",
  ready: "border-ring/70 border-dashed bg-card",
  upcoming: "border-border border-dashed bg-card text-muted-foreground",
  locked: "border-border bg-muted/40 text-muted-foreground",
  suspended: "border-destructive/40 bg-destructive/10",
};
const SWATCH: Record<Status, string> = {
  mastered: "bg-ring",
  credited: "bg-ring/70",
  reviewing: "bg-ring/40",
  learning: "bg-ring/20 ring-1 ring-ring/40",
  ready: "border border-dashed border-ring/70",
  upcoming: "border border-dashed border-border",
  locked: "bg-muted",
  suspended: "bg-destructive/30",
};

function asStatus(status: string): Status {
  return (STATUSES as readonly string[]).includes(status) ? (status as Status) : "locked";
}

export function PracticeMap({ courseSlug, courseTitle, map }: { courseSlug: string; courseTitle: string; map: PracticeMapData | null }) {
  const { language } = useLanguage();
  const t = COPY[language];
  const total = map ? Object.values(map.counts).reduce((sum, count) => sum + count, 0) : 0;
  const mastered = map ? (map.counts.mastered ?? 0) + (map.counts.credited ?? 0) : 0;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10 md:py-14">
      <Link href={`/practice/${courseSlug}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> {t.back}
      </Link>
      <header className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{t.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-light tracking-tight text-balance md:text-4xl">{courseTitle}</h1>
        </div>
        {map && total > 0 && (
          <div className="w-full sm:w-auto sm:min-w-48 sm:text-right">
            <p className="font-mono text-xs text-muted-foreground">
              {mastered} / {total} · {t.status.mastered.toLowerCase()}
            </p>
            {/* One bar, split by status, in the legend's order. */}
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              {STATUSES.filter((status) => ["mastered", "credited", "reviewing", "learning"].includes(status)).map((status) => (
                <div key={status} className={SWATCH[status]} style={{ width: `${((map.counts[status] ?? 0) / total) * 100}%` }} />
              ))}
            </div>
          </div>
        )}
      </header>

      {!map ? (
        <p className="mt-8 rounded-3xl border border-border bg-card p-8 text-muted-foreground shadow-[var(--shadow-tile)]">{t.notReady}</p>
      ) : (
        <>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Legend">
            {STATUSES.filter((status) => map.counts[status]).map((status) => (
              <li key={status} className="inline-flex items-center gap-2">
                <span className={cn("size-3 rounded-sm", SWATCH[status])} aria-hidden="true" />
                <span>{t.status[status]}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{map.counts[status]}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 grid gap-10">
            {map.modules.map((courseModule) => (
              <section key={courseModule.position} aria-labelledby={`module-${courseModule.position}`}>
                <h2 id={`module-${courseModule.position}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3">
                  <span className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {t.module} {courseModule.position}
                  </span>
                  <span className="text-lg font-medium tracking-tight">{courseModule.title}</span>
                </h2>
                <div className="mt-4 grid gap-6">
                  {courseModule.lessons.map((lesson) => (
                    <div key={lesson.code} className="grid gap-3 md:grid-cols-[14rem_1fr] md:gap-6">
                      <p className="text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{lesson.code}</span>
                        <span className="mt-0.5 block text-muted-foreground md:text-foreground">{lesson.title}</span>
                      </p>
                      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {lesson.skills.map((skill) => (
                          <SkillTile key={skill.key} skill={skill} t={t} language={language} now={map.at} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-12">
            <Button asChild>
              <Link href={`/practice/${courseSlug}`}>
                <Repeat className="mr-2 size-4" aria-hidden="true" /> {t.practise}
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

type Skill = PracticeMapData["modules"][number]["lessons"][number]["skills"][number];

function SkillTile({ skill, t, language, now }: { skill: Skill; t: (typeof COPY)["es"]; language: "es" | "en"; now: number }) {
  const status = asStatus(skill.status);
  const filled = status === "mastered" || status === "credited";
  const step = rung(skill.stage);
  const started = status === "learning" || status === "reviewing" || filled;
  const days = skill.due !== null ? Math.ceil((skill.due - now) / 86_400_000) : null;
  const label = language === "es" ? skill.labelEs : skill.labelEn;
  return (
    <li className={cn("flex min-h-24 flex-col justify-between gap-3 rounded-2xl border p-3.5", TILE[status])}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm leading-snug font-medium">{label}</p>
        {status === "locked" && <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
        {skill.found && <Layers role="img" className="mt-0.5 size-3.5 shrink-0" aria-label={t.found} />}
      </div>
      <div className={cn("flex flex-wrap items-center justify-between gap-2 text-xs", filled ? "text-background/80" : "text-muted-foreground")}>
        <span>{t.status[status]}</span>
        {started && (
          <Tip content={skill.stage ? t.stage[skill.stage] : null}>
          <span className="inline-flex items-center gap-1.5">
            {skill.stage && <span className="sr-only">{t.stage[skill.stage]}</span>}
            {[1, 2, 3, 4].map((position) => (
              <span
                key={position}
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", position <= step ? (filled ? "bg-background" : "bg-ring") : filled ? "bg-background/35" : "bg-foreground/15")}
              />
            ))}
          </span>
          </Tip>
        )}
      </div>
      {started && days !== null && (
        <p className={cn("-mt-1 font-mono text-[11px]", filled ? "text-background/80" : "text-muted-foreground")}>
          {days <= 0 ? t.dueNow : t.dueIn(days)}
          {skill.recall !== null && ` · ${t.recall(Math.round(skill.recall * 100))}`}
        </p>
      )}
    </li>
  );
}
