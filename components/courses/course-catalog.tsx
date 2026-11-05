"use client";

import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { formatHours } from "@/components/courses/inline-code";

export type CatalogCourse = {
    id: string;
    slug: string;
    title: string;
    summary: string | null;
    language: string;
    moduleCount: number;
    lessonCount: number;
    totalMinutes: number;
    enrolled: boolean;
    completedCount: number;
};

const COPY = {
    es: {
        eyebrow: "Catálogo",
        heading: "Cursos",
        lede: "Cada curso combina notebooks reales en tu laboratorio, lecturas y proyectos, con práctica espaciada para que lo aprendido se quede.",
        modules: "módulos",
        lessons: "lecciones",
        open: "Ver el curso",
        resume: "Continuar",
        progress: (done: number, total: number) => `${done} de ${total} lecciones completadas`,
        language: { en: "En inglés", es: "En español" } as Record<string, string>,
        empty: "Todavía no hay cursos publicados.",
    },
    en: {
        eyebrow: "Catalog",
        heading: "Courses",
        lede: "Every course combines real notebooks in your lab, readings and projects, with spaced practice so what you learn sticks.",
        modules: "modules",
        lessons: "lessons",
        open: "View course",
        resume: "Continue",
        progress: (done: number, total: number) => `${done} of ${total} lessons completed`,
        language: { en: "In English", es: "In Spanish" } as Record<string, string>,
        empty: "No courses are published yet.",
    },
};

export function CourseCatalog({ courses }: { courses: CatalogCourse[] }) {
    const { language } = useLanguage();
    const t = COPY[language];

    return (
        <div className="container mx-auto px-4 py-12 md:py-16">
            <header className="mb-10 max-w-3xl">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{t.eyebrow}</p>
                <h1 className="mt-3 text-4xl font-extralight tracking-tight sm:text-5xl">{t.heading}</h1>
                <p className="mt-4 text-base font-light leading-relaxed text-muted-foreground sm:text-lg">{t.lede}</p>
            </header>

            {courses.length === 0 ? (
                <p className="rounded-3xl border border-dashed border-border bg-muted/40 p-10 text-center text-muted-foreground">{t.empty}</p>
            ) : (
                <ul className="grid gap-6 md:grid-cols-2">
                    {courses.map((course) => {
                        const percent = course.lessonCount ? Math.round((course.completedCount / course.lessonCount) * 100) : 0;
                        return (
                            <li
                                key={course.id}
                                className="flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-tile)]"
                            >
                                {/* The graph-paper motif of the home hero, as the card's header band. */}
                                <div className="relative h-24 border-b border-border bg-gradient-to-br from-hero-from via-hero-via to-hero-to">
                                    <svg className="absolute inset-0 size-full" aria-hidden="true">
                                        <defs>
                                            <pattern id={`grid-${course.id}`} width="24" height="24" patternUnits="userSpaceOnUse">
                                                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="var(--hero-grid)" strokeWidth="1" />
                                            </pattern>
                                        </defs>
                                        <rect width="100%" height="100%" fill={`url(#grid-${course.id})`} />
                                    </svg>
                                    <span className="absolute bottom-3 left-6 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                        {t.language[course.language] ?? course.language} · {course.moduleCount} {t.modules} · {course.lessonCount} {t.lessons} · {formatHours(course.totalMinutes)}
                                    </span>
                                </div>
                                <div className="flex flex-1 flex-col gap-4 p-6">
                                    <h2 className="text-2xl font-semibold tracking-tight text-balance">{course.title}</h2>
                                    {course.summary && <p className="text-sm leading-relaxed text-muted-foreground">{course.summary}</p>}
                                    {course.enrolled && (
                                        <div>
                                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                                <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                                            </div>
                                            <p className="mt-2 font-mono text-[11px] text-muted-foreground">{t.progress(course.completedCount, course.lessonCount)}</p>
                                        </div>
                                    )}
                                    <div className="mt-auto pt-2">
                                        <ShimmerButton href={`/courses/${course.slug}`} tone={course.enrolled ? "ink" : "glass"} onHover>
                                            {course.enrolled ? t.resume : t.open}
                                            <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden="true" />
                                        </ShimmerButton>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
