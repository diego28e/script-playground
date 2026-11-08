"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActivityResult, LearnerResponse, MediaProgress } from "@intellectif/lk-core";
import { InteractiveVideo, type InteractiveVideoSlot } from "@intellectif/lk-react/components/InteractiveVideo";
import "@intellectif/lk-react/theme/defaults.css";
import "@intellectif/lk-react/theme/skin.css";
import { saveVideoState, type VideoState } from "@/actions/lessons";
import type { LessonVideo as LessonVideoData } from "@/lib/lesson-video";
import { LK_STRINGS_ES } from "@/lib/lk-strings-es";
import { VideoPlayer } from "@/components/courses/video-player/video-player";

const COPY = {
    es: {
        saveError: "No pudimos guardar tu avance en el video. Seguiremos intentándolo.",
    },
    en: {
        saveError: "We couldn't save your place in the video. We'll keep trying.",
    },
};

type Props = {
    video: LessonVideoData;
    lessonId: string;
    /** Which of the lesson's videos this is: its state is kept under this id (actions/lessons.ts saveVideoState). */
    videoId: string;
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
function useVideoState(lessonId: string, videoId: string, tracking: boolean, initialState: VideoState | null, errorMessage: string) {
    const state = useRef<VideoState>(initialState ?? EMPTY);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dirty = useRef(false);
    const warned = useRef(false);

    const flush = useCallback(async () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (!tracking || !dirty.current) return;
        dirty.current = false;
        const result = await saveVideoState(lessonId, videoId, state.current).catch(() => ({ success: false }));
        if (!result.success) {
            dirty.current = true;
            if (!warned.current) {
                warned.current = true;
                toast.error(errorMessage);
            }
        }
    }, [lessonId, videoId, tracking, errorMessage]);

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
 * The box around either player. It reads the video's size to fit the player to the picture: a vertical video gets a
 * narrow portrait frame instead of a strip in a 16:9 one.
 *
 * Both players are in the server's HTML, so a cached file's metadata can load before hydration, and React drops a
 * `loadedmetadata` that fires then. The box reads the size itself when the video already has it. lk-react (23.7.2
 * on) also reads its own metadata on mount; the plain player doesn't, so for it (`replay`) the box fires the event
 * again and the player's handler resumes where the learner left off.
 */
function usePlayerBox(replay: boolean) {
    const ref = useRef<HTMLDivElement>(null);
    const [portrait, setPortrait] = useState(false);
    useEffect(() => {
        const container = ref.current;
        if (!container) return;
        // Capture: media events don't bubble, but they do pass through ancestors on the way down.
        const readSize = (element: HTMLVideoElement) => {
            if (element.videoWidth > 0) setPortrait(element.videoHeight > element.videoWidth);
        };
        const onMetadata = (event: Event) => {
            if (event.target instanceof HTMLVideoElement) readSize(event.target);
        };
        container.addEventListener("loadedmetadata", onMetadata, true);
        let done = false;
        const check = () => {
            const element = container.querySelector("video");
            if (!element || done) return;
            done = true;
            observer.disconnect();
            if (element.readyState < HTMLMediaElement.HAVE_METADATA) return;
            if (replay) element.dispatchEvent(new Event("loadedmetadata"));
            else readSize(element);
        };
        const observer = new MutationObserver(check);
        observer.observe(container, { childList: true, subtree: true });
        check();
        return () => {
            observer.disconnect();
            container.removeEventListener("loadedmetadata", onMetadata, true);
        };
    }, [replay]);
    return { ref, portrait };
}

// A portrait player is as tall as the screen allows and at most 24rem wide, but never narrower than 18rem, which the
// controls need, nor wider than the column.
const BOX =
    "lk-scope mx-auto w-full overflow-hidden rounded-2xl data-[portrait]:max-w-[min(100%,max(18rem,min(24rem,calc((100svh-9rem)*9/16))))]";

export function LessonVideo({ video, lessonId, videoId, title, language, tracking, initialState, onFinished }: Props) {
    const t = COPY[language];
    const { initial, update } = useVideoState(lessonId, videoId, tracking, initialState, t.saveError);
    const onProgress = (progress: MediaProgress) => update((current) => ({ ...current, progress }), 4000);
    const { ref: boxRef, portrait } = usePlayerBox(video.kind === "plain");

    if (video.kind === "plain") {
        return (
            <div ref={boxRef} className={BOX} data-portrait={portrait || undefined}>
                <PlainVideo
                    media={video.media}
                    portrait={portrait}
                    initial={initial}
                    language={language}
                    onProgress={onProgress}
                    onEnded={() => {
                        // Watched to the end: kept, so the lesson's playlist ticks it (and a video lesson completes).
                        update((current) => ({ ...current, finishedAt: current.finishedAt ?? new Date().toISOString() }), 0);
                        onFinished?.();
                    }}
                />
            </div>
        );
    }

    return (
        <div ref={boxRef} className={BOX} data-portrait={portrait || undefined}>
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

/**
 * A video with no questions yet: the platform's own player (components/courses/video-player), with its captions in
 * the learner's choice of language, speed, transcript and resume, and none of the browser's menus.
 */
function PlainVideo({
    media,
    portrait,
    initial,
    language,
    onProgress,
    onEnded,
}: {
    media: Extract<LessonVideoData, { kind: "plain" }>["media"];
    portrait: boolean;
    initial: VideoState;
    language: "es" | "en";
    onProgress: (progress: MediaProgress) => void;
    onEnded?: () => void;
}) {
    return (
        <VideoPlayer
            src={media.url}
            poster={media.poster}
            tracks={media.tracks ?? []}
            title={media.alt ?? ""}
            language={language}
            portrait={portrait}
            startAt={initial.progress?.at ?? 0}
            furthestBefore={initial.progress?.furthest ?? 0}
            onProgress={({ at, furthest }) => onProgress({ progressVersion: "1.0", at, furthest })}
            onEnded={onEnded}
        />
    );
}
