"use client";

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import type { ActivityResult, LearnerResponse, MediaProgress } from "@intellectif/lk-core";
import type { InteractiveVideoSlot } from "@intellectif/lk-react/components/InteractiveVideo";
import "@intellectif/lk-react/theme/defaults.css";
import "@intellectif/lk-react/theme/skin.css";
import { saveVideoState, type VideoState } from "@/actions/lessons";
import type { LessonVideo as LessonVideoData } from "@/lib/lesson-video";
import { LK_STRINGS_ES } from "@/lib/lk-strings-es";
import { DotLoader } from "@/components/ui/dot-loader";

// The player is drawn in the browser only: lk-react 23.7.1 numbers its element ids with a counter and checks
// picture-in-picture support while rendering, so its server HTML never matches the browser's and React throws a
// hydration error. The placeholder keeps the video's shape, so nothing jumps when it arrives.
const InteractiveVideo = dynamic(() => import("@intellectif/lk-react/components/InteractiveVideo").then((module) => module.InteractiveVideo), {
    ssr: false,
    loading: () => (
        <div className="grid aspect-video w-full place-items-center rounded-2xl bg-black">
            <DotLoader className="text-white/70" />
        </div>
    ),
});

const COPY = {
    es: {
        saveError: "No pudimos guardar tu avance en el video. Seguiremos intentándolo.",
        noVideo: "Tu navegador no puede reproducir este video.",
    },
    en: {
        saveError: "We couldn't save your place in the video. We'll keep trying.",
        noVideo: "Your browser can't play this video.",
    },
};

type Props = {
    video: LessonVideoData;
    lessonId: string;
    title: string;
    language: "es" | "en";
    /** Only an enrolled, signed-in learner's place and answers are kept. */
    tracking: boolean;
    initialState: VideoState | null;
    /** Called when the learner reaches the end of the video (and, for an interactive one, presses Finish). */
    onFinished?: () => void;
};

const EMPTY: VideoState = { responses: {}, submitted: [], scores: {} };

/**
 * Keeps the learner's video state and saves it a moment after it changes: progress arrives every few seconds while
 * playing, so saves are batched, and the latest save always carries the whole state.
 */
function useVideoState(lessonId: string, tracking: boolean, initialState: VideoState | null, errorMessage: string) {
    const state = useRef<VideoState>(initialState ?? EMPTY);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dirty = useRef(false);
    const warned = useRef(false);

    const flush = useCallback(async () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (!tracking || !dirty.current) return;
        dirty.current = false;
        const result = await saveVideoState(lessonId, state.current).catch(() => ({ success: false }));
        if (!result.success) {
            dirty.current = true;
            if (!warned.current) {
                warned.current = true;
                toast.error(errorMessage);
            }
        }
    }, [lessonId, tracking, errorMessage]);

    const update = useCallback(
        (change: (current: VideoState) => VideoState, delay: number) => {
            state.current = change(state.current);
            if (!tracking) return;
            dirty.current = true;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flush, delay);
        },
        [tracking, flush],
    );

    // Leaving the page or switching tabs saves what is pending.
    useEffect(() => {
        const onHide = () => document.visibilityState === "hidden" && void flush();
        document.addEventListener("visibilitychange", onHide);
        return () => {
            document.removeEventListener("visibilitychange", onHide);
            void flush();
        };
    }, [flush]);

    return { initial: initialState ?? EMPTY, update };
}

/**
 * lk-react 23.7.1 reads the video's length and applies the resume point in its `loadedmetadata` handler. When the
 * file is cached, the browser can load the metadata before React has attached the player to the page, and React
 * drops events for an element it hasn't mounted yet: the learner starts at 0:00 with no length shown. When the
 * player's <video> appears with its metadata already loaded, this replays the event so the SDK's own handler runs.
 */
function useReplayMissedMetadata() {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const container = ref.current;
        if (!container) return;
        let done = false;
        const check = () => {
            const element = container.querySelector("video");
            if (!element || done) return;
            done = true;
            observer.disconnect();
            if (element.readyState >= HTMLMediaElement.HAVE_METADATA) element.dispatchEvent(new Event("loadedmetadata"));
        };
        const observer = new MutationObserver(check);
        observer.observe(container, { childList: true, subtree: true });
        check();
        return () => observer.disconnect();
    }, []);
    return ref;
}

export function LessonVideo({ video, lessonId, title, language, tracking, initialState, onFinished }: Props) {
    const t = COPY[language];
    const { initial, update } = useVideoState(lessonId, tracking, initialState, t.saveError);
    const onProgress = (progress: MediaProgress) => update((current) => ({ ...current, progress }), 4000);
    const playerRef = useReplayMissedMetadata();

    if (video.kind === "plain") {
        return <PlainVideo media={video.media} initial={initial} onProgress={onProgress} onEnded={onFinished} fallback={t.noVideo} />;
    }

    return (
        <div ref={playerRef} className="lk-scope overflow-hidden rounded-2xl">
            <InteractiveVideo
                group={video.group}
                renderMode="practice"
                label={title}
                locale={language}
                strings={language === "es" ? LK_STRINGS_ES : undefined}
                progress={initial.progress}
                onProgress={onProgress}
                responses={initial.responses as Record<string, LearnerResponse>}
                submittedSlotIds={initial.submitted}
                onSubmit={(response: LearnerResponse, slot: InteractiveVideoSlot) =>
                    update(
                        (current) => ({
                            ...current,
                            responses: { ...current.responses, [slot.slotId]: response },
                            submitted: current.submitted.includes(slot.slotId) ? current.submitted : [...current.submitted, slot.slotId],
                        }),
                        500,
                    )
                }
                onActivityComplete={(result: ActivityResult, slot: InteractiveVideoSlot) =>
                    update(
                        (current) => ({
                            ...current,
                            scores: { ...current.scores, [slot.slotId]: { score: result.score, maxScore: result.maxScore, passed: result.passed } },
                        }),
                        500,
                    )
                }
                onFinished={() => {
                    update((current) => ({ ...current, finishedAt: new Date().toISOString() }), 0);
                    onFinished?.();
                }}
            />
        </div>
    );
}

/** A video with no questions yet: the browser's own player, with captions, a poster and resume. */
function PlainVideo({
    media,
    initial,
    onProgress,
    onEnded,
    fallback,
}: {
    media: Extract<LessonVideoData, { kind: "plain" }>["media"];
    initial: VideoState;
    onProgress: (progress: MediaProgress) => void;
    onEnded?: () => void;
    fallback: string;
}) {
    const ref = useRef<HTMLVideoElement>(null);
    const furthest = useRef(initial.progress?.furthest ?? 0);
    const lastReport = useRef(0);

    // Resume where the learner left off, unless that was the very end.
    const resume = (element: HTMLVideoElement) => {
        const at = initial.progress?.at ?? 0;
        if (at > 0 && at < element.duration - 5) element.currentTime = at;
    };
    // The <video> is in the server's HTML, so its metadata can load before React attaches onLoadedMetadata.
    useEffect(() => {
        if (ref.current && ref.current.readyState >= HTMLMediaElement.HAVE_METADATA) resume(ref.current);
        // Once, on mount: later loads are the handler's.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const report = (element: HTMLVideoElement, force = false) => {
        const at = element.currentTime;
        furthest.current = Math.max(furthest.current, at);
        if (!force && Date.now() - lastReport.current < 5000) return;
        lastReport.current = Date.now();
        onProgress({ progressVersion: "1.0", at, furthest: furthest.current });
    };

    return (
        <video
            ref={ref}
            controls
            playsInline
            preload="metadata"
            // Captions come from the media host, another origin; the browser only reads them with CORS.
            crossOrigin="anonymous"
            poster={media.poster}
            aria-label={media.alt}
            className="aspect-video w-full rounded-2xl bg-black"
            onLoadedMetadata={(event) => resume(event.currentTarget)}
            onTimeUpdate={(event) => report(event.currentTarget)}
            onPause={(event) => report(event.currentTarget, true)}
            onSeeked={(event) => report(event.currentTarget, true)}
            onEnded={(event) => {
                report(event.currentTarget, true);
                onEnded?.();
            }}
        >
            <source src={media.url} />
            {media.tracks?.map((track) => (
                <track key={`${track.kind}-${track.srclang}`} kind={track.kind} src={track.src} srcLang={track.srclang} label={track.label} default={track.default} />
            ))}
            {fallback}
        </video>
    );
}
