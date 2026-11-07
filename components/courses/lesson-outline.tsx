"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CircleDashed, GripVertical, ListTree, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { LessonStatus } from "@/actions/lessons";
import { Tip } from "@/components/ui/tip";
import { InlineCode } from "@/components/courses/inline-code";
import type { LessonWorkspaceData } from "@/components/courses/lesson-workspace";
import { lessonPath } from "@/lib/lab";
import { clampOutlineWidth, OUTLINE_COOKIE, OUTLINE_WIDTH, type OutlinePreference } from "@/lib/outline-preference";
import { cn } from "@/lib/utils";

// The course outline beside a lesson: on wide screens a sidebar on the page's left edge, which the learner can resize
// (drag its edge, or the arrow keys on it) and collapse to a slim rail (its button, Ctrl/⌘+B, or dragging it narrow);
// the choice is remembered in a cookie the page reads, so it renders at the right width with no jump. On narrower
// screens, a folded outline above the lesson. The Notebook tab starts with the rail, for the notebook's room.

/** Dragged this far below the minimum, the sidebar folds to the rail. */
const COLLAPSE_BELOW = OUTLINE_WIDTH.min - 72;
const KEY_STEP = 16;
const clampWidth = clampOutlineWidth;

function saveOutlinePreference(preference: OutlinePreference) {
    document.cookie = `${OUTLINE_COOKIE}=${preference.collapsed ? 1 : 0}:${preference.width}; path=/; max-age=31536000; samesite=lax`;
}

export type OutlineCopy = {
    outline: string;
    collapse: string;
    expand: string;
    resize: string;
    resizeHint: string;
    previous: string;
    next: string;
    status: Record<LessonStatus, string>;
};

type TreeProps = {
    data: LessonWorkspaceData;
    progress: Record<string, LessonStatus>;
    currentHref: string;
    t: OutlineCopy;
};

/** The course title, its progress, and the modules with their lessons; the current module open. */
function OutlineTree({ data, progress, currentHref, t }: TreeProps) {
    const { course } = data;
    return (
        <ol className="flex flex-col gap-0.5">
            {course.modules.map((courseModule) => {
                const current = courseModule.slug === data.module.slug;
                const finished = courseModule.lessons.filter((lesson) => progress[lesson.id] === "COMPLETED").length;
                return (
                    <li key={courseModule.id}>
                        <details open={current} className="group/module">
                            <summary className="flex cursor-pointer list-none items-start gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                                <span className="mt-px w-6 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{String(courseModule.position).padStart(2, "0")}</span>
                                <span className={cn("min-w-0 flex-1 leading-snug", current ? "font-medium text-foreground" : "text-foreground/90")}>{courseModule.title}</span>
                                <span className="mt-px shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                                    {finished}/{courseModule.lessons.length}
                                </span>
                            </summary>
                            <ol className="mb-2 ml-[1.15rem] flex flex-col gap-px border-l border-border pl-2">
                                {courseModule.lessons.map((lesson) => {
                                    const href = lessonPath(course.slug, courseModule.slug, lesson.slug);
                                    const active = href === currentHref;
                                    const state = progress[lesson.id];
                                    return (
                                        <li key={lesson.id}>
                                            <Link
                                                href={href}
                                                aria-current={active ? "page" : undefined}
                                                data-current-lesson={active || undefined}
                                                className={cn(
                                                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                    active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                                                )}
                                            >
                                                <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center" aria-label={state ? t.status[state] : undefined}>
                                                    {state === "COMPLETED" ? (
                                                        <Check className="size-3.5 text-foreground" strokeWidth={2.5} />
                                                    ) : state === "IN_PROGRESS" ? (
                                                        <CircleDashed className="size-3.5" />
                                                    ) : (
                                                        <span className={cn("block size-1.5 rounded-full", active ? "bg-foreground" : "bg-border")} />
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
}

function CourseHeading({ data, progress }: { data: LessonWorkspaceData; progress: Record<string, LessonStatus> }) {
    const { course } = data;
    const total = data.position.total;
    const done = Object.values(progress).filter((value) => value === "COMPLETED").length;
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Link
                href={`/courses/${course.slug}`}
                className="rounded text-sm font-semibold leading-snug text-balance hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                {course.title}
            </Link>
            {data.enrolled && (
                <div className="flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                        {done}/{total}
                    </span>
                </div>
            )}
        </div>
    );
}

/** Below the wide layout: the outline folded above the lesson. */
export function MobileOutline(props: TreeProps) {
    return (
        <details className="mb-8 rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-tile)] lg:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <ListTree className="size-4 text-muted-foreground" aria-hidden="true" />
                {props.t.outline}
            </summary>
            <div className="flex flex-col gap-3 px-2 pt-2">
                <CourseHeading data={props.data} progress={props.progress} />
                <nav aria-label={props.t.outline} className="-mx-2">
                    <OutlineTree {...props} />
                </nav>
            </div>
        </details>
    );
}

type SidebarProps = TreeProps & {
    initial: OutlinePreference;
    /** The Notebook tab is open: the sidebar starts as the rail, without changing the learner's saved choice. */
    roomForNotebook: boolean;
    /** How many times the Notebook tab has opened: each time, the sidebar starts as the rail again. */
    notebookOpenings: number;
    previousHref: string | null;
    previousTitle: string | null;
    nextHref: string | null;
    nextTitle: string | null;
};

export function LessonSidebar({ initial, roomForNotebook, notebookOpenings, previousHref, previousTitle, nextHref, nextTitle, ...tree }: SidebarProps) {
    const { t } = tree;
    const [preference, setPreference] = useState(initial);
    // Opened by hand while the notebook is showing (during which opening of the tab); folds again the next time.
    const [openedDuring, setOpenedDuring] = useState<number | null>(null);
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const collapsed = roomForNotebook ? openedDuring !== notebookOpenings : preference.collapsed;
    const width = dragWidth ?? preference.width;
    const scroller = useRef<HTMLDivElement>(null);

    const update = useCallback(
        (next: OutlinePreference) => {
            setPreference(next);
            saveOutlinePreference(next);
        },
        [],
    );

    const setCollapsed = useCallback(
        (value: boolean) => {
            if (roomForNotebook) setOpenedDuring(value ? null : notebookOpenings);
            else update({ ...preference, collapsed: value });
        },
        [roomForNotebook, notebookOpenings, preference, update],
    );

    // Ctrl/⌘+B folds and unfolds it, as in code editors; not while typing.
    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "b") return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
            event.preventDefault();
            setCollapsed(!collapsed);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [collapsed, setCollapsed]);

    // A course has over a hundred lessons: the current one is brought into view when the outline opens.
    useEffect(() => {
        if (collapsed) return;
        const box = scroller.current;
        const current = box?.querySelector<HTMLElement>("[data-current-lesson]");
        if (!box || !current) return;
        const top = current.offsetTop - box.offsetTop;
        if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 48) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }, [collapsed, tree.currentHref]);

    // Dragging the edge: pointer capture keeps the drag even over the notebook's frame, which would otherwise take
    // the pointer; a class on the page stops frames from taking it at all while it lasts.
    const drag = useRef<{ startX: number; startWidth: number } | null>(null);
    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // The pointer is already gone (released, or a stylus lifted): the drag still follows the moves it gets.
        }
        drag.current = { startX: event.clientX, startWidth: width };
        document.documentElement.dataset.resizing = "outline";
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        const raw = drag.current.startWidth + event.clientX - drag.current.startX;
        setDragWidth(raw < COLLAPSE_BELOW ? OUTLINE_WIDTH.min : clampWidth(raw));
        // Shown as folding: released here, it collapses.
        event.currentTarget.dataset.folding = raw < COLLAPSE_BELOW ? "true" : "false";
    };
    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        const raw = drag.current.startWidth + event.clientX - drag.current.startX;
        drag.current = null;
        delete document.documentElement.dataset.resizing;
        delete event.currentTarget.dataset.folding;
        setDragWidth(null);
        if (raw < COLLAPSE_BELOW) setCollapsed(true);
        else update({ ...preference, width: clampWidth(raw) });
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
        const next =
            event.key === "ArrowLeft"
                ? width - step
                : event.key === "ArrowRight"
                  ? width + step
                  : event.key === "Home"
                    ? OUTLINE_WIDTH.min
                    : event.key === "End"
                      ? OUTLINE_WIDTH.max
                      : null;
        if (event.key === "Enter") {
            event.preventDefault();
            setCollapsed(true);
            return;
        }
        if (next === null) return;
        event.preventDefault();
        update({ ...preference, width: clampWidth(next) });
    };

    const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘B" : "Ctrl+B";

    if (collapsed) {
        return (
            <aside
                aria-label={t.outline}
                className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-14 shrink-0 flex-col items-center gap-1 self-start border-r border-border bg-muted/40 py-3 lg:flex"
            >
                <RailButton label={t.expand} hint={`${t.expand} · ${shortcut}`} onClick={() => setCollapsed(false)}>
                    <PanelLeftOpen className="size-4" aria-hidden="true" />
                </RailButton>
                <span className="my-2 h-px w-6 bg-border" aria-hidden="true" />
                {previousHref && previousTitle && (
                    <RailLink href={previousHref} label={`${t.previous}: ${previousTitle.replaceAll("`", "")}`}>
                        <ArrowLeft className="size-4" aria-hidden="true" />
                    </RailLink>
                )}
                {nextHref && nextTitle && (
                    <RailLink href={nextHref} label={`${t.next}: ${nextTitle.replaceAll("`", "")}`}>
                        <ArrowRight className="size-4" aria-hidden="true" />
                    </RailLink>
                )}
            </aside>
        );
    }

    return (
        <aside
            aria-label={t.outline}
            style={{ width }}
            className={cn(
                "sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 self-start border-r border-border bg-muted/40 lg:flex lg:flex-col",
                dragWidth === null && "transition-[width] duration-200 ease-out",
            )}
        >
            <div className="flex items-start gap-2 border-b border-border px-4 pt-5 pb-4">
                <CourseHeading data={tree.data} progress={tree.progress} />
                <Tip content={`${t.collapse} · ${shortcut}`} side="right">
                    <button
                        type="button"
                        onClick={() => setCollapsed(true)}
                        aria-label={t.collapse}
                        className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <PanelLeftClose className="size-4" aria-hidden="true" />
                    </button>
                </Tip>
            </div>
            <div ref={scroller} className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
                <nav aria-label={t.outline}>
                    <OutlineTree {...tree} />
                </nav>
            </div>
            <Tip content={t.resizeHint} side="right">
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t.resize}
                    aria-valuemin={OUTLINE_WIDTH.min}
                    aria-valuemax={OUTLINE_WIDTH.max}
                    aria-valuenow={width}
                    tabIndex={0}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onLostPointerCapture={(event) => drag.current && endDrag(event)}
                    onDoubleClick={() => update({ ...preference, width: OUTLINE_WIDTH.default })}
                    onKeyDown={onKeyDown}
                    className="group/handle absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none data-[folding=true]:cursor-w-resize"
                >
                    {/* The edge lights up under the pointer and while dragging; the grip says it can be dragged. */}
                    <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/handle:bg-foreground/30 group-focus-visible/handle:bg-ring group-active/handle:bg-foreground/50" />
                    <span className="relative flex h-6 w-3 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground opacity-0 shadow-[var(--shadow-tile)] transition-opacity group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100 group-active/handle:opacity-100">
                        <GripVertical className="size-2.5" aria-hidden="true" />
                    </span>
                </div>
            </Tip>
        </aside>
    );
}

function RailButton({ label, hint, onClick, children }: { label: string; hint: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <Tip content={hint} side="right">
            <button
                type="button"
                onClick={onClick}
                aria-label={label}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                {children}
            </button>
        </Tip>
    );
}

function RailLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
    return (
        <Tip content={label} side="right">
            <Link
                href={href}
                aria-label={label}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                {children}
            </Link>
        </Tip>
    );
}
