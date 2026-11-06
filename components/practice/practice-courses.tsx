"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

const COPY = {
  es: { eyebrow: "Práctica", title: "Elige un curso", none: "Aún no practicas ningún curso. Inscríbete en uno y completa una lección.", browse: "Ver los cursos" },
  en: { eyebrow: "Practice", title: "Pick a course", none: "You're not practising any course yet. Enrol in one and complete a lesson.", browse: "Browse the courses" },
};

/** The courses a learner can practise, when there's more than one (or none). */
export function PracticeCourses({ courses }: { courses: { slug: string; title: string }[] }) {
  const { language } = useLanguage();
  const t = COPY[language];
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 md:py-14">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{t.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-light tracking-tight md:text-4xl">{t.title}</h1>
      {courses.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-tile)]">
          <p className="text-muted-foreground">{t.none}</p>
          <Link href="/courses" className="mt-4 inline-flex items-center gap-2 font-medium hover:underline">
            {t.browse} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3">
          {courses.map((course) => (
            <li key={course.slug}>
              <Link
                href={`/practice/${course.slug}`}
                className="flex items-center justify-between gap-4 rounded-3xl border border-border bg-card px-6 py-5 shadow-[var(--shadow-tile)] transition-colors hover:bg-muted/50"
              >
                <span className="text-lg font-medium">{course.title}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
