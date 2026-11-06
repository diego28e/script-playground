"use client";

import { useEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
    ArrowLeft,
    ArrowRight,
    BookOpen,
    Check,
    CircleDashed,
    ExternalLink,
    FolderKanban,
    ListTree,
    NotebookPen,
    PlayCircle,
    Repeat,
} from "lucide-react";
import type { LessonKind } from "@prisma/client";
import type { getLessonWorkspace, LessonStatus } from "@/actions/lessons";
import { recordLessonOpened, setLessonCompleted } from "@/actions/lessons";
import { enrollInCourse } from "@/actions/courses";
import { useLanguage } from "@/components/providers/language-provider";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Tip } from "@/components/ui/tip";
import { InlineCode } from "@/components/courses/inline-code";
import { LessonVideo } from "@/components/courses/lesson-video";
import type { LessonVideo as LessonVideoData } from "@/lib/lesson-video";
import { labNotebookUrl, lessonPath, sourceFileUrl } from "@/lib/lab";
import { cn } from "@/lib/utils";

type WorkspaceResult = NonNullable<Extract<Awaited<ReturnType<typeof getLessonWorkspace>>, { success: true }>["data"]>;
// The page takes the stored video off the lesson and passes it checked and signed, as `video`.
export type LessonWorkspaceData = Omit<WorkspaceResult, "lesson"> & { lesson: Omit<WorkspaceResult["lesson"], "video"> };

const COPY = {
    es: {
        outline: "Contenido del curso",
        module: "Módulo",
        lesson: (index: number, total: number) => `Lección ${index} de ${total}`,
        kinds: { NOTEBOOK: "Notebook", READING: "Lectura", PROJECT: "Proyecto", VIDEO: "Video", PRACTICE: "Práctica" } as Record<LessonKind, string>,
        objectives: "Al terminar podrás",
        requirements: "Requisitos del proyecto",
        prerequisites: "Antes de empezar",
        openInLab: "Abrir en tu laboratorio",
        labHint: "El notebook se abre en tu laboratorio, en una pestaña nueva. Si tu servidor está apagado, se enciende primero (tarda unos segundos).",
        viewSource: "Ver en GitHub",
        markComplete: "Marcar como completada",
        completed: "Completada",
        saving: "Guardando…",
        undoHint: "Haz clic de nuevo para desmarcarla.",
        signInToTrack: "Entra para guardar tu progreso",
        enrollToTrack: "Inscríbete para guardar tu progreso",
        enrolling: "Inscribiendo…",
        enrolled: "¡Listo! Ya estás inscrito.",
        enrollError: "No pudimos inscribirte. Inténtalo de nuevo.",
        saveError: "No pudimos guardar tu progreso. Inténtalo de nuevo.",
        previous: "Anterior",
        next: "Siguiente",
        backToCourse: "Volver al curso",
        unavailable: "Este tipo de lección todavía no se puede abrir aquí.",
        status: { COMPLETED: "Completada", IN_PROGRESS: "En curso" } as Record<LessonStatus, string>,
    },
    en: {
        outline: "Course outline",
        module: "Module",
        lesson: (index: number, total: number) => `Lesson ${index} of ${total}`,
        kinds: { NOTEBOOK: "Notebook", READING: "Reading", PROJECT: "Project", VIDEO: "Video", PRACTICE: "Practice" } as Record<LessonKind, string>,
        objectives: "By the end you can",
        requirements: "Project requirements",
        prerequisites: "Before you start",
        openInLab: "Open in your lab",
        labHint: "The notebook opens in your lab, in a new tab. If your server is stopped, it starts first (a few seconds).",
        viewSource: "View on GitHub",
        markComplete: "Mark as complete",
        completed: "Completed",
        saving: "Saving…",
        undoHint: "Click again to unmark it.",
        signInToTrack: "Sign in to save your progress",
        enrollToTrack: "Enroll to save your progress",
        enrolling: "Enrolling…",
        enrolled: "You're enrolled.",
        enrollError: "We couldn't enroll you. Try again.",
        saveError: "We couldn't save your progress. Try again.",
        previous: "Previous",
        next: "Next",
        backToCourse: "Back to the course",
        unavailable: "This kind of lesson can't be opened here yet.",
        status: { COMPLETED: "Completed", IN_PROGRESS: "In progress" } as Record<LessonStatus, string>,
    },
};

const KIND_ICONS: Record<LessonKind, typeof NotebookPen> = {
    NOTEBOOK: NotebookPen,
    READING: BookOpen,
    PROJECT: FolderKanban,
    VIDEO: PlayCircle,
    PRACTICE: Repeat,
};

type Props = {
    data: LessonWorkspaceData;
    signedIn: boolean;
    /** A READING lesson's guide, rendered on the server (components/courses/lesson-markdown.tsx). */
    reading?: ReactNode;
    /** The lesson's video, with URLs the browser can load (app/(main)/courses/[slug]/[module]/[lesson]/page.tsx). */
    video?: LessonVideoData | null;
};

export function LessonWorkspace({ data, signedIn, reading, video }: Props) {
    const { language } = useLanguage();
    const t = COPY[language];
    const router = useRouter();
    const { course, lesson, previous, next } = data;
    const tracking = signedIn && data.enrolled;

    // The server's progress, plus what this page changed since (keyed by lesson, so it stays right across
    // lesson-to-lesson navigation and agrees with the server after a refresh).
    const [changed, setProgress] = useState<Record<string, LessonStatus>>({});
    const progress = { ...data.progress, ...changed };
    // Opening the lesson starts it; the outline updates when the server confirms.
    useEffect(() => {
        if (!tracking) return;
        let cancelled = false;
        recordLessonOpened(lesson.id).then((result) => {
            const confirmed = result.success ? result.status : undefined;
            if (!cancelled && confirmed) setProgress((current) => ({ ...current, [lesson.id]: confirmed }));
        });
        return () => {
            cancelled = true;
        };
    }, [tracking, lesson.id]);

    const [saving, startSaving] = useTransition();
    const [status, setOptimisticStatus] = useOptimistic<LessonStatus | undefined>(progress[lesson.id]);
    const completed = status === "COMPLETED";

    const toggleComplete = (target = !completed) =>
        startSaving(async () => {
            setOptimisticStatus(target ? "COMPLETED" : "IN_PROGRESS");
            try {
                const result = await setLessonCompleted(lesson.id, target);
                if (!result.success) throw new Error(result.error);
                setProgress((current) => ({ ...current, [lesson.id]: target ? "COMPLETED" : "IN_PROGRESS" }));
            } catch {
                toast.error(t.saveError);
            }
        });

    const [enrolling, startEnrolling] = useTransition();
    const enroll = () =>
        startEnrolling(async () => {
            try {
                const result = await enrollInCourse(course.id);
                if (!result.success) throw new Error(result.error);
                startEnrolling(() => router.refresh());
                toast.success(t.enrolled);
            } catch {
                toast.error(t.enrollError);
            }
        });

    const inLab = (lesson.kind === "NOTEBOOK" || lesson.kind === "PROJECT") && lesson.sourcePath;
    const sourceUrl = sourceFileUrl(course.sourceRepoUrl, course.sourceRef, lesson.sourcePath);
    const Icon = KIND_ICONS[lesson.kind];
    const here = lessonPath(course.slug, data.module.slug, lesson.slug);

    return (
        <div className="container mx-auto grid gap-8 px-4 py-8 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-12 lg:py-10">
            <LessonOutline data={data} progress={progress} currentHref={here} t={t} />

            <article className="min-w-0">
                <header className="border-b border-border pb-8">
                    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        <Link href={`/courses/${course.slug}`} className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {course.title}
                        </Link>
                        <span aria-hidden="true">/</span>
                        <span>
                            {t.module} {String(data.module.position).padStart(2, "0")}
                        </span>
                    </nav>
                    <h1 className="mt-4 text-3xl font-light leading-tight tracking-tight text-balance sm:text-4xl">
                        <InlineCode text={lesson.title} />
                    </h1>
                    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                            <Icon className="size-3.5" aria-hidden="true" />
                            {t.kinds[lesson.kind]}
                        </span>
                        {lesson.code && <span>· {lesson.code}</span>}
                        {lesson.estimatedTime && <span>· {lesson.estimatedTime}</span>}
                        <span>· {t.lesson(data.position.index, data.position.total)}</span>
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        {inLab && (
                            <ShimmerButton href={labNotebookUrl(course.slug, lesson.sourcePath!)} external tone="signal" size="lg">
                                {t.openInLab}
                                <ExternalLink className="size-4" strokeWidth={2.25} aria-hidden="true" />
                            </ShimmerButton>
                        )}
                        {tracking ? (
                            // Wrapped: ShimmerButton keeps its own ref, which a tooltip trigger needs.
                            <Tip wrap content={completed ? t.undoHint : null}>
                            <ShimmerButton
                                tone={completed ? "ink" : "glass"}
                                size="lg"
                                onHover
                                onClick={() => toggleComplete()}
                                pending={saving}
                                pendingLabel={t.saving}
                                aria-pressed={completed}
                            >
                                {completed ? <Check className="size-4" strokeWidth={2.5} aria-hidden="true" /> : <CircleDashed className="size-4" aria-hidden="true" />}
                                {completed ? t.completed : t.markComplete}
                            </ShimmerButton>
                            </Tip>
                        ) : signedIn ? (
                            <ShimmerButton tone="glass" size="lg" onHover onClick={enroll} pending={enrolling} pendingLabel={t.enrolling}>
                                {t.enrollToTrack}
                            </ShimmerButton>
                        ) : (
                            <ShimmerButton href={`/login?next=${encodeURIComponent(here)}`} tone="glass" size="lg" onHover>
                                {t.signInToTrack}
                            </ShimmerButton>
                        )}
                        {sourceUrl && (
                            <a
                                href={sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-12 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                {t.viewSource}
                                <ExternalLink className="size-3.5" aria-hidden="true" />
                            </a>
                        )}
                    </div>
                    {inLab && <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">{t.labHint}</p>}
                </header>

                {(lesson.objectives.length > 0 || lesson.prerequisites) && (
                    <section className="grid gap-6 border-b border-border py-8 md:grid-cols-2">
                        {lesson.objectives.length > 0 && (
                            <div className={cn(!lesson.prerequisites && "md:col-span-2")}>
                                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                    {lesson.kind === "PROJECT" ? t.requirements : t.objectives}
                                </h2>
                                <ul className="flex flex-col gap-2 text-sm leading-relaxed">
                                    {lesson.objectives.map((objective, index) => (
                                        <li key={index} className="flex gap-2.5">
                                            <Check className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                            <span className="[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]">
                                                <ReactMarkdown components={{ p: ({ children }) => <>{children}</> }}>{objective}</ReactMarkdown>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {lesson.prerequisites && (
                            <div>
                                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t.prerequisites}</h2>
                                <p className="text-sm leading-relaxed text-muted-foreground">{lesson.prerequisites}</p>
                            </div>
                        )}
                    </section>
                )}

                {video && (
                    <section className="border-b border-border py-8">
                        <LessonVideo
                            // A new lesson is a new player, with its own state.
                            key={lesson.id}
                            video={video}
                            lessonId={lesson.id}
                            title={lesson.title.replaceAll("`", "")}
                            language={language}
                            tracking={tracking}
                            initialState={data.videoState}
                            // Watching a video lesson to the end completes it; in a notebook lesson the video is only a part.
                            onFinished={lesson.kind === "VIDEO" && tracking && !completed ? () => toggleComplete(true) : undefined}
                        />
                    </section>
                )}
                {lesson.kind === "READING" && reading && <section className="py-8">{reading}</section>}
                {((lesson.kind === "VIDEO" && !video) || lesson.kind === "PRACTICE") && (
                    <p className="my-8 rounded-2xl border border-dashed border-border bg-muted/40 p-6 text-sm text-muted-foreground">{t.unavailable}</p>
                )}

                <nav aria-label={`${t.previous} / ${t.next}`} className="mt-8 grid gap-3 border-t border-border pt-8 sm:grid-cols-2">
                    {previous ? (
                        <NeighbourLink href={lessonPath(course.slug, previous.moduleSlug, previous.slug)} label={t.previous} lesson={previous} direction="previous" />
                    ) : (
                        <NeighbourLink href={`/courses/${course.slug}`} label={t.backToCourse} lesson={{ code: null, title: course.title }} direction="previous" />
                    )}
                    {next && <NeighbourLink href={lessonPath(course.slug, next.moduleSlug, next.slug)} label={t.next} lesson={next} direction="next" />}
                </nav>
            </article>
        </div>
    );
}

function NeighbourLink({
    href,
    label,
    lesson,
    direction,
}: {
    href: string;
    label: string;
    lesson: { code: string | null; title: string };
    direction: "previous" | "next";
}) {
    return (
        <Link
            href={href}
            className={cn(
                "group flex flex-col gap-1 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-tile)] transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                direction === "next" && "sm:col-start-2 sm:items-end sm:text-right",
            )}
        >
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {direction === "previous" && <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />}
                {label}
                {direction === "next" && <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
            </span>
            <span className="text-sm font-medium leading-snug">
                {lesson.code && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{lesson.code}</span>}
                <InlineCode text={lesson.title} />
            </span>
        </Link>
    );
}

function LessonOutline({
    data,
    progress,
    currentHref,
    t,
}: {
    data: LessonWorkspaceData;
    progress: Record<string, LessonStatus>;
    currentHref: string;
    t: (typeof COPY)["es"];
}) {
    const { course } = data;
    const total = data.position.total;
    const done = Object.values(progress).filter((value) => value === "COMPLETED").length;

    const modules = (
        <ol className="flex flex-col gap-1">
            {course.modules.map((courseModule) => {
                const current = courseModule.slug === data.module.slug;
                const finished = courseModule.lessons.filter((lesson) => progress[lesson.id] === "COMPLETED").length;
                return (
                    <li key={courseModule.id}>
                        <details open={current} className="group/module">
                            <summary className="flex list-none items-start gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                                <span className="mt-0.5 w-6 shrink-0 font-mono text-[11px] text-muted-foreground">{String(courseModule.position).padStart(2, "0")}</span>
                                <span className={cn("min-w-0 flex-1 leading-snug", current && "font-medium")}>{courseModule.title}</span>
                                <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">
                                    {finished}/{courseModule.lessons.length}
                                </span>
                            </summary>
                            <ol className="mb-2 ml-4 flex flex-col border-l border-border pl-2">
                                {courseModule.lessons.map((lesson) => {
                                    const href = lessonPath(course.slug, courseModule.slug, lesson.slug);
                                    const active = href === currentHref;
                                    const state = progress[lesson.id];
                                    return (
                                        <li key={lesson.id}>
                                            <Link
                                                href={href}
                                                aria-current={active ? "page" : undefined}
                                                className={cn(
                                                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px] leading-snug transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                    active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                                                )}
                                            >
                                                <span className="mt-0.5 shrink-0" aria-label={state ? t.status[state] : undefined}>
                                                    {state === "COMPLETED" ? (
                                                        <Check className="size-3.5 text-foreground" strokeWidth={2.5} />
                                                    ) : state === "IN_PROGRESS" ? (
                                                        <CircleDashed className="size-3.5" />
                                                    ) : (
                                                        <span className="mt-1 ml-1 block size-1.5 rounded-full bg-border" />
                                                    )}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <InlineCode text={lesson.title} />
                                                </span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ol>
                        </details>
                    </li>
                );
            })}
        </ol>
    );

    const heading = (
        <div className="flex flex-col gap-2 px-2 pb-3">
            <Link href={`/courses/${course.slug}`} className="text-sm font-semibold leading-snug hover:underline hover:underline-offset-4">
                {course.title}
            </Link>
            {data.enrolled && (
                <div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                    </div>
                    <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                        {done}/{total}
                    </p>
                </div>
            )}
        </div>
    );

    return (
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
            {/* Phones get the outline folded above the lesson; wide screens keep it beside. */}
            <details className="rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-tile)] lg:hidden">
                <summary className="flex list-none items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <ListTree className="size-4 text-muted-foreground" aria-hidden="true" />
                    {t.outline}
                </summary>
                <div className="pt-2">
                    {heading}
                    {modules}
                </div>
            </details>
            <nav aria-label={t.outline} className="hidden lg:block">
                <p className="mb-3 px-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t.outline}</p>
                {heading}
                {modules}
            </nav>
        </aside>
    );
}
