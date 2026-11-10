"use client";

import { useEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { LabFrame } from "@/components/courses/lab-frame";
import { LessonSidebar, MobileOutline } from "@/components/courses/lesson-outline";
import type { OutlinePreference } from "@/lib/outline-preference";
import { LessonPythonSection } from "@/components/compass/lesson-python";
import { LessonVideos, type PlayableVideo } from "@/components/courses/lesson-videos";
import { labNotebookUrl, lessonPath, sourceFileUrl } from "@/lib/lab";
import { cn } from "@/lib/utils";

type WorkspaceResult = NonNullable<Extract<Awaited<ReturnType<typeof getLessonWorkspace>>, { success: true }>["data"]>;
// The page takes the stored videos off the lesson and passes them checked and signed, as `videos`.
export type LessonWorkspaceData = Omit<WorkspaceResult, "lesson"> & { lesson: Omit<WorkspaceResult["lesson"], "videos"> };

const COPY = {
    es: {
        outline: "Contenido del curso",
        collapse: "Ocultar el contenido",
        expand: "Mostrar el contenido del curso",
        resize: "Ancho del contenido del curso",
        resizeHint: "Arrastra para cambiar el ancho; doble clic para volver al original",
        module: "Módulo",
        lesson: (index: number, total: number) => `Lección ${index} de ${total}`,
        kinds: { NOTEBOOK: "Notebook", READING: "Lectura", PROJECT: "Proyecto", VIDEO: "Video", PRACTICE: "Práctica" } as Record<LessonKind, string>,
        objectives: "Al terminar podrás",
        requirements: "Requisitos del proyecto",
        prerequisites: "Antes de empezar",
        openInLab: "Abrir en tu laboratorio",
        labHint: "El notebook se abre en tu laboratorio, en una pestaña nueva. Si tu servidor está apagado, se enciende primero (tarda unos segundos).",
        labHintTabs: "Trabájalo aquí, en la pestaña Notebook, o en tu laboratorio completo, en una pestaña nueva.",
        tabs: "Vista de la lección",
        tabLesson: "Lección",
        tabNotebook: "Notebook",
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
        collapse: "Hide the outline",
        expand: "Show the course outline",
        resize: "Course outline width",
        resizeHint: "Drag to resize; double-click to reset",
        module: "Module",
        lesson: (index: number, total: number) => `Lesson ${index} of ${total}`,
        kinds: { NOTEBOOK: "Notebook", READING: "Reading", PROJECT: "Project", VIDEO: "Video", PRACTICE: "Practice" } as Record<LessonKind, string>,
        objectives: "By the end you can",
        requirements: "Project requirements",
        prerequisites: "Before you start",
        openInLab: "Open in your lab",
        labHint: "The notebook opens in your lab, in a new tab. If your server is stopped, it starts first (a few seconds).",
        labHintTabs: "Work on it right here, in the Notebook tab, or in your full lab, in a new tab.",
        tabs: "Lesson view",
        tabLesson: "Lesson",
        tabNotebook: "Notebook",
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
    /** The lesson's videos in order, with URLs the browser can load (app/(main)/courses/[slug]/[module]/[lesson]/page.tsx). */
    videos: PlayableVideo[];
    /** The outline's saved width and whether it's folded (lesson-outline.tsx), read from a cookie by the page. */
    outline: OutlinePreference;
};

/** Lesson Markdown in a line (objectives, prerequisites): code spans styled, links to a new tab. */
const INLINE_MARKDOWN = {
    p: ({ children }: { children?: ReactNode }) => <>{children}</>,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground">
            {children}
        </a>
    ),
};
const CODE_SPANS = "[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]";

export function LessonWorkspace({ data, signedIn, reading, videos, outline }: Props) {
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

    // The Notebook tab (docs/notebook-embed.md): the lesson's notebook, in the learner's own lab, right here. Only for
    // enrolled learners, who are the ones the lab lets in. The tab is kept in the address (?tab=notebook); the frame
    // loads the first time the tab opens and then stays, so switching back and forth doesn't restart JupyterLab.
    const notebookTab = Boolean(inLab && tracking);
    const tabInAddress = useSearchParams().get("tab");
    const [tab, setTab] = useState<"lesson" | "notebook">(tabInAddress === "notebook" ? "notebook" : "lesson");
    const showNotebook = notebookTab && tab === "notebook";
    // The frame is never rendered on the server: it depends on the screen's width (a phone gets a link instead, and must
    // never load the frame, which starts the learner's lab server). A lesson opened at ?tab=notebook mounts it right
    // after the page comes alive in the browser.
    const [notebookOpened, setNotebookOpened] = useState(false);
    // Each opening of the Notebook tab folds the outline to its rail, for the notebook's room (lesson-outline.tsx).
    const [notebookOpenings, setNotebookOpenings] = useState(tabInAddress === "notebook" ? 1 : 0);
    useEffect(() => {
        if (!showNotebook) return;
        // A timer, not an animation frame: those don't run while the page is in a background tab.
        const timer = window.setTimeout(() => setNotebookOpened(true), 0);
        return () => window.clearTimeout(timer);
    }, [showNotebook]);
    const selectTab = (next: "lesson" | "notebook") => {
        if (next === "notebook" && tab !== "notebook") setNotebookOpenings((count) => count + 1);
        setTab(next);
        if (next === "notebook") {
            setNotebookOpened(true);
            // A video left playing behind the notebook would go on talking.
            document.querySelectorAll<HTMLMediaElement>("#lesson-panel-lesson video, #lesson-panel-lesson audio").forEach((media) => media.pause());
        }
        const url = new URL(window.location.href);
        if (next === "notebook") url.searchParams.set("tab", "notebook");
        else url.searchParams.delete("tab");
        window.history.replaceState(window.history.state, "", url);
    };

    const outlineProps = { data, progress, currentHref: here, t };
    return (
        // The page's full width: the outline on its left edge, the lesson in the rest at a readable width (the notebook
        // takes all of it).
        <div className="flex w-full flex-1">
            <LessonSidebar
                {...outlineProps}
                initial={outline}
                roomForNotebook={showNotebook}
                notebookOpenings={notebookOpenings}
                previousHref={previous ? lessonPath(course.slug, previous.moduleSlug, previous.slug) : null}
                previousTitle={previous?.title ?? null}
                nextHref={next ? lessonPath(course.slug, next.moduleSlug, next.slug) : null}
                nextTitle={next?.title ?? null}
            />
            <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10 xl:px-14">
            <div className={cn("mx-auto w-full", showNotebook ? "max-w-none" : "max-w-6xl")}>
            <MobileOutline {...outlineProps} />
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
                    {inLab && <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">{notebookTab ? t.labHintTabs : t.labHint}</p>}
                    {notebookTab && (
                        <div role="tablist" aria-label={t.tabs} className="mt-6 inline-flex rounded-full bg-muted p-1">
                            {(["lesson", "notebook"] as const).map((id) => (
                                <button
                                    key={id}
                                    type="button"
                                    role="tab"
                                    id={`lesson-tab-${id}`}
                                    aria-selected={tab === id}
                                    aria-controls={`lesson-panel-${id}`}
                                    tabIndex={tab === id ? 0 : -1}
                                    onClick={() => selectTab(id)}
                                    onKeyDown={(event) => {
                                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                        event.preventDefault();
                                        const other = id === "lesson" ? "notebook" : "lesson";
                                        selectTab(other);
                                        document.getElementById(`lesson-tab-${other}`)?.focus();
                                    }}
                                    className={cn(
                                        "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        tab === id ? "bg-card text-foreground shadow-[var(--shadow-tile)]" : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {id === "lesson" ? <BookOpen className="size-4" aria-hidden="true" /> : <NotebookPen className="size-4" aria-hidden="true" />}
                                    {id === "lesson" ? t.tabLesson : t.tabNotebook}
                                </button>
                            ))}
                        </div>
                    )}
                </header>

                {notebookTab && (
                    <div role="tabpanel" id="lesson-panel-notebook" aria-labelledby="lesson-tab-notebook" hidden={!showNotebook} className="pt-6">
                        {notebookOpened ? (
                            <LabFrame courseSlug={course.slug} sourcePath={lesson.sourcePath!} language={language} />
                        ) : (
                            <div className="h-[calc(100dvh-9rem)] min-h-[520px]" aria-hidden="true" />
                        )}
                    </div>
                )}

                <div
                    id="lesson-panel-lesson"
                    {...(notebookTab ? { role: "tabpanel", "aria-labelledby": "lesson-tab-lesson" } : {})}
                    hidden={showNotebook}
                >

                {(lesson.objectives.length > 0 || lesson.prerequisites) && (
                    <section className="grid gap-6 py-8 md:grid-cols-2">
                        {lesson.objectives.length > 0 && (
                            <div className={cn(!lesson.prerequisites && "md:col-span-2")}>
                                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                    {lesson.kind === "PROJECT" ? t.requirements : t.objectives}
                                </h2>
                                <ul className="flex flex-col gap-2 text-sm leading-relaxed">
                                    {lesson.objectives.map((objective, index) => (
                                        <li key={index} className="flex gap-2.5">
                                            <Check className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                            <span className={CODE_SPANS}>
                                                <ReactMarkdown components={INLINE_MARKDOWN}>{objective}</ReactMarkdown>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {lesson.prerequisites && (
                            <div>
                                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t.prerequisites}</h2>
                                <p className={cn("text-sm leading-relaxed text-muted-foreground", CODE_SPANS)}>
                                    <ReactMarkdown components={INLINE_MARKDOWN}>{lesson.prerequisites}</ReactMarkdown>
                                </p>
                            </div>
                        )}
                    </section>
                )}

                {data.python && <LessonPythonSection python={data.python} language={language} />}

                {videos.length > 0 && (
                    <section className="border-t border-border py-8 first:border-t-0">
                        <LessonVideos
                            // A new lesson is a new playlist, with its own state.
                            key={lesson.id}
                            videos={videos}
                            lessonId={lesson.id}
                            lessonTitle={lesson.title.replaceAll("`", "")}
                            language={language}
                            tracking={tracking}
                            initialStates={data.videoStates}
                            // Watching all of a video lesson's videos to the end completes it; elsewhere they're only a part.
                            onAllFinished={lesson.kind === "VIDEO" && tracking && !completed ? () => toggleComplete(true) : undefined}
                        />
                    </section>
                )}
                {lesson.kind === "READING" && reading && <section className="border-t border-border py-8 first:border-t-0">{reading}</section>}
                {((lesson.kind === "VIDEO" && videos.length === 0) || lesson.kind === "PRACTICE") && (
                    <p className="my-8 rounded-2xl border border-dashed border-border bg-muted/40 p-6 text-sm text-muted-foreground">{t.unavailable}</p>
                )}
                </div>

                <nav aria-label={`${t.previous} / ${t.next}`} className="grid gap-3 border-t border-border pt-8 sm:grid-cols-2">
                    {previous ? (
                        <NeighbourLink href={lessonPath(course.slug, previous.moduleSlug, previous.slug)} label={t.previous} lesson={previous} direction="previous" />
                    ) : (
                        <NeighbourLink href={`/courses/${course.slug}`} label={t.backToCourse} lesson={{ code: null, title: course.title }} direction="previous" />
                    )}
                    {next && <NeighbourLink href={lessonPath(course.slug, next.moduleSlug, next.slug)} label={t.next} lesson={next} direction="next" />}
                </nav>
            </article>
            </div>
            </div>
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
