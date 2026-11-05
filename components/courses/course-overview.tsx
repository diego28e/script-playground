"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ArrowRight, BookOpen, Check, ChevronDown, CircleDashed, ExternalLink, FolderKanban, NotebookPen, PlayCircle, Repeat } from "lucide-react";
import { toast } from "sonner";
import type { LessonKind } from "@prisma/client";
import { enrollInCourse, type getCourseBySlug } from "@/actions/courses";
import { useLanguage } from "@/components/providers/language-provider";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { InlineCode, formatHours } from "@/components/courses/inline-code";
import { labNotebookUrl, lessonPath, sourceFileUrl } from "@/lib/lab";

export type CourseDetail = NonNullable<Awaited<ReturnType<typeof getCourseBySlug>>["data"]>;
type CourseLesson = CourseDetail["modules"][number]["lessons"][number];

const COPY = {
    es: {
        eyebrow: "Curso",
        language: { en: "en inglés", es: "en español" } as Record<string, string>,
        modules: "módulos",
        lessons: "lecciones",
        signInToEnroll: "Entra para inscribirte",
        enroll: "Inscribirme",
        enrolling: "Inscribiendo…",
        continueWith: (code: string) => `Continuar con ${code}`,
        allDone: "Repasar el curso",
        repository: "Ver en GitHub",
        progress: (done: number, total: number) => `${done} de ${total} lecciones completadas`,
        module: "Módulo",
        objectives: "Al terminar podrás",
        requirements: "Requisitos del proyecto",
        prerequisites: "Antes de empezar",
        openInLab: "Abrir en el laboratorio",
        openLesson: "Abrir la lección",
        enrollError: "No pudimos inscribirte. Inténtalo de nuevo.",
        enrolled: "¡Listo! Ya estás inscrito.",
        kinds: { NOTEBOOK: "Notebook", READING: "Lectura", PROJECT: "Proyecto", VIDEO: "Video", PRACTICE: "Práctica" },
        status: { COMPLETED: "Completada", IN_PROGRESS: "En curso" },
    },
    en: {
        eyebrow: "Course",
        language: { en: "in English", es: "in Spanish" } as Record<string, string>,
        modules: "modules",
        lessons: "lessons",
        signInToEnroll: "Sign in to enroll",
        enroll: "Enroll",
        enrolling: "Enrolling…",
        continueWith: (code: string) => `Continue with ${code}`,
        allDone: "Review the course",
        repository: "View on GitHub",
        progress: (done: number, total: number) => `${done} of ${total} lessons completed`,
        module: "Module",
        objectives: "By the end you can",
        requirements: "Project requirements",
        prerequisites: "Before you start",
        openInLab: "Open in the lab",
        openLesson: "Open the lesson",
        enrollError: "We couldn't enroll you. Try again.",
        enrolled: "You're enrolled.",
        kinds: { NOTEBOOK: "Notebook", READING: "Reading", PROJECT: "Project", VIDEO: "Video", PRACTICE: "Practice" },
        status: { COMPLETED: "Completed", IN_PROGRESS: "In progress" },
    },
};

const KIND_ICONS: Record<LessonKind, typeof NotebookPen> = {
    NOTEBOOK: NotebookPen,
    READING: BookOpen,
    PROJECT: FolderKanban,
    VIDEO: PlayCircle,
    PRACTICE: Repeat,
};

/** Where a lesson opens: its notebook in the student's lab, or its file in the repository. */
function lessonHref(course: CourseDetail, lesson: CourseLesson) {
    if ((lesson.kind === "NOTEBOOK" || lesson.kind === "PROJECT") && lesson.sourcePath) {
        return labNotebookUrl(course.slug, lesson.sourcePath);
    }
    return sourceFileUrl(course.sourceRepoUrl, course.sourceRef, lesson.sourcePath);
}

export function CourseOverview({ course, signedIn }: { course: CourseDetail; signedIn: boolean }) {
    const { language } = useLanguage();
    const t = COPY[language];
    const router = useRouter();
    const [enrolling, startEnrolling] = useTransition();

    const lessons = course.modules.flatMap((courseModule) => courseModule.lessons);
    const completed = lessons.filter((lesson) => course.progress[lesson.id] === "COMPLETED").length;
    const totalMinutes = lessons.reduce((sum, lesson) => sum + (lesson.estimatedMinutes ?? 0), 0);
    // "Continue" opens the first unfinished lesson's page in the lesson workspace.
    const nextModule = course.modules.find((courseModule) => courseModule.lessons.some((lesson) => course.progress[lesson.id] !== "COMPLETED"));
    const next = nextModule?.lessons.find((lesson) => course.progress[lesson.id] !== "COMPLETED");
    const nextHref = nextModule && next ? lessonPath(course.slug, nextModule.slug, next.slug) : null;
    const parts = [...new Set(course.modules.map((courseModule) => courseModule.part ?? ""))];

    const enroll = () =>
        startEnrolling(async () => {
            try {
                const result = await enrollInCourse(course.id);
                if (!result.success) {
                    toast.error(t.enrollError);
                    return;
                }
                // Updates after an await need their own transition to keep the button busy until the page refreshes.
                startEnrolling(() => router.refresh());
                toast.success(t.enrolled);
            } catch {
                toast.error(t.enrollError);
            }
        });

    return (
        <div>
            <section className="relative overflow-hidden border-b border-border bg-gradient-to-br from-hero-from via-hero-via to-hero-to">
                <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                    <defs>
                        <pattern id="course-grid" width="60" height="60" patternUnits="userSpaceOnUse">
                            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="var(--hero-grid)" strokeWidth="0.5" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#course-grid)" />
                </svg>
                <div className="container relative mx-auto px-4 py-14 md:py-20">
                    <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        {t.eyebrow} · {t.language[course.language] ?? course.language}
                    </p>
                    <h1 className="mt-4 max-w-4xl text-4xl font-extralight leading-tight tracking-tight text-balance sm:text-5xl md:text-6xl">
                        {course.title}
                    </h1>
                    {course.summary && (
                        <p className="mt-5 max-w-3xl text-lg font-light leading-relaxed text-muted-foreground">{course.summary}</p>
                    )}
                    <p className="mt-6 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        {course.modules.length} {t.modules} · {lessons.length} {t.lessons} · {formatHours(totalMinutes)}
                    </p>
                    {course.enrolled && (
                        <div className="mt-6 max-w-md">
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${lessons.length ? (completed / lessons.length) * 100 : 0}%` }} />
                            </div>
                            <p className="mt-2 font-mono text-[11px] text-muted-foreground">{t.progress(completed, lessons.length)}</p>
                        </div>
                    )}
                    <div className="mt-8 flex flex-wrap items-center gap-3">
                        {!signedIn ? (
                            <ShimmerButton href={`/login?next=${encodeURIComponent(`/courses/${course.slug}`)}`} tone="signal" size="lg">
                                {t.signInToEnroll}
                                <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden="true" />
                            </ShimmerButton>
                        ) : !course.enrolled ? (
                            <ShimmerButton tone="signal" size="lg" onClick={enroll} pending={enrolling} pendingLabel={t.enrolling}>
                                {t.enroll}
                                <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden="true" />
                            </ShimmerButton>
                        ) : nextHref && next ? (
                            <ShimmerButton href={nextHref} tone="signal" size="lg">
                                {t.continueWith(next.code ?? next.title)}
                                <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden="true" />
                            </ShimmerButton>
                        ) : (
                            <ShimmerButton href={`/courses/${course.slug}#${course.modules[0]?.slug ?? ""}`} tone="ink" size="lg">
                                {t.allDone}
                            </ShimmerButton>
                        )}
                        {course.sourceRepoUrl && (
                            <ShimmerButton href={course.sourceRepoUrl} external tone="glass" size="lg" onHover>
                                {t.repository}
                                <ExternalLink className="size-4" strokeWidth={2.25} aria-hidden="true" />
                            </ShimmerButton>
                        )}
                    </div>
                </div>
            </section>

            <div className="container mx-auto flex flex-col gap-12 px-4 py-12">
                {parts.map((part) => (
                    <section key={part || "course"} className="flex flex-col gap-5">
                        {part && <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{part}</h2>}
                        {course.modules
                            .filter((courseModule) => (courseModule.part ?? "") === part)
                            .map((courseModule) => (
                                <article
                                    key={courseModule.id}
                                    id={courseModule.slug}
                                    className="scroll-mt-24 overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-tile)]"
                                >
                                    <header className="flex flex-col gap-2 px-6 pt-6 pb-4">
                                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                                            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                                {t.module} {String(courseModule.position).padStart(2, "0")}
                                            </span>
                                            {courseModule.estimatedTime && (
                                                <span className="font-mono text-[11px] text-muted-foreground">{courseModule.estimatedTime}</span>
                                            )}
                                        </div>
                                        <h3 className="text-xl font-semibold tracking-tight">{courseModule.title}</h3>
                                        {courseModule.goals && <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">{courseModule.goals}</p>}
                                    </header>
                                    <ol className="border-t border-border">
                                        {courseModule.lessons.map((lesson) => (
                                            <LessonRow key={lesson.id} course={course} moduleSlug={courseModule.slug} lesson={lesson} t={t} />
                                        ))}
                                    </ol>
                                </article>
                            ))}
                    </section>
                ))}
            </div>
        </div>
    );
}

function LessonRow({ course, moduleSlug, lesson, t }: { course: CourseDetail; moduleSlug: string; lesson: CourseLesson; t: (typeof COPY)["es"] }) {
    const Icon = KIND_ICONS[lesson.kind];
    const status = course.progress[lesson.id];
    const href = lessonHref(course, lesson);
    const inLab = lesson.kind === "NOTEBOOK" || lesson.kind === "PROJECT";

    return (
        <li className="border-b border-border last:border-b-0">
            <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-4 px-6 py-3.5 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={t.kinds[lesson.kind]} />
                    <span className="hidden w-12 shrink-0 font-mono text-xs text-muted-foreground sm:inline">
                        {lesson.code ?? (lesson.kind === "PROJECT" ? "★" : "")}
                    </span>
                    <span className="min-w-0 flex-1 text-sm leading-snug">
                        <InlineCode text={lesson.title} />
                    </span>
                    {lesson.estimatedTime && (
                        <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground md:inline">{lesson.estimatedTime}</span>
                    )}
                    {status === "COMPLETED" ? (
                        <Check className="size-4 shrink-0 text-primary" aria-label={t.status.COMPLETED} />
                    ) : status === "IN_PROGRESS" ? (
                        <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-label={t.status.IN_PROGRESS} />
                    ) : (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                    )}
                </summary>
                <div className="flex flex-col gap-4 bg-muted/30 px-6 py-5 sm:pl-[5.5rem]">
                    {lesson.objectives.length > 0 && (
                        <div>
                            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                {lesson.kind === "PROJECT" ? t.requirements : t.objectives}
                            </p>
                            <ul className="flex flex-col gap-1.5 text-sm leading-relaxed">
                                {lesson.objectives.map((objective, index) => (
                                    <li key={index} className="flex gap-2">
                                        <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
                                        <span className="[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]">
                                            <ReactMarkdown components={{ p: ({ children }) => <>{children}</> }}>{objective}</ReactMarkdown>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {lesson.prerequisites && (
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            <span className="font-medium text-foreground">{t.prerequisites}:</span> {lesson.prerequisites}
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <ShimmerButton href={lessonPath(course.slug, moduleSlug, lesson.slug)} tone="ink" size="sm" onHover>
                            {t.openLesson}
                            <ArrowRight className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                        </ShimmerButton>
                        {href && inLab && (
                            <ShimmerButton href={href} external tone="glass" size="sm" onHover>
                                {t.openInLab}
                                <ExternalLink className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                            </ShimmerButton>
                        )}
                    </div>
                </div>
            </details>
        </li>
    );
}
