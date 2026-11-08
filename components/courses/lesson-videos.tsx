"use client";

import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import type { VideoState } from "@/actions/lessons";
import { LessonVideo } from "@/components/courses/lesson-video";
import { Tip } from "@/components/ui/tip";
import type { LessonVideo as LessonVideoData } from "@/lib/lesson-video";
import { cn } from "@/lib/utils";

// A lesson's videos (docs/lesson-videos.md): one per skill as a rule, in teaching order. One video plays alone.
// Several get a small stepper ABOVE the player, kept apart from the lesson's own previous / next below the page: a
// numbered dot per video, joined by lines that fill as videos are watched, a tick on each watched one, and on the
// current one a thin ring that fills as it plays. Titles show on hover (the platform's tooltip), not in the row: a
// lesson can have seven videos. The current video's title is said once, left of the stepper, and "Next" rises in when
// a video ends. The open video is kept in the address (?video=2), so a link or a reload opens it.

export type PlayableVideo = {
  id: string;
  title: { es: string | null; en: string | null };
  durationSeconds: number | null;
  video: LessonVideoData;
};

const COPY = {
  es: {
    heading: "Videos de la lección",
    untitled: (index: number) => `Video ${index}`,
    video: (index: number) => `Video ${index}`,
    next: "Siguiente",
    nextVideo: (title: string) => `Siguiente video: ${title}`,
    watched: "Visto",
    playing: "Reproduciendo",
  },
  en: {
    heading: "Lesson videos",
    untitled: (index: number) => `Video ${index}`,
    video: (index: number) => `Video ${index}`,
    next: "Next",
    nextVideo: (title: string) => `Next video: ${title}`,
    watched: "Watched",
    playing: "Playing",
  },
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

// The current dot's ring: a 28 px circle, stroke 2.
const RING_RADIUS = 12.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

type Props = {
  videos: PlayableVideo[];
  lessonId: string;
  lessonTitle: string;
  language: "es" | "en";
  tracking: boolean;
  initialStates: Record<string, VideoState>;
  /** Every video has been watched to the end (a video lesson is then complete). */
  onAllFinished?: () => void;
};

export function LessonVideos({ videos, lessonId, lessonTitle, language, tracking, initialStates, onAllFinished }: Props) {
  const t = COPY[language];
  // The video the address names (?video=2, counted from 1); read the same way on the server and in the browser.
  const asked = Number(useSearchParams().get("video"));
  const [current, setCurrent] = useState(Number.isInteger(asked) && asked >= 1 && asked <= videos.length ? asked - 1 : 0);
  const [finished, setFinished] = useState(() => new Set(videos.filter((video) => initialStates[video.id]?.finishedAt).map((video) => video.id)));
  // How far the current video has played, for its ring; a new video starts from where its player resumes.
  const [playhead, setPlayhead] = useState<{ id: string; fraction: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const titleOf = (video: PlayableVideo, index: number) =>
    (language === "es" ? (video.title.es ?? video.title.en) : (video.title.en ?? video.title.es)) ?? (videos.length === 1 ? lessonTitle : t.untitled(index + 1));

  const select = (index: number) => {
    setCurrent(index);
    const url = new URL(window.location.href);
    if (index === 0) url.searchParams.delete("video");
    else url.searchParams.set("video", String(index + 1));
    window.history.replaceState(window.history.state, "", url);
  };

  const finish = (id: string) => {
    if (finished.has(id)) return;
    const next = new Set(finished).add(id);
    setFinished(next);
    if (next.size === videos.length) onAllFinished?.();
  };

  const video = videos[current];
  const onPlayhead = useCallback((fraction: number) => setPlayhead({ id: video.id, fraction }), [video.id]);
  const player = (
    <LessonVideo
      // Another video is another player, with its own state.
      key={video.id}
      video={video.video}
      lessonId={lessonId}
      videoId={video.id}
      title={titleOf(video, current)}
      language={language}
      tracking={tracking}
      initialState={initialStates[video.id] ?? null}
      onFinished={() => finish(video.id)}
      onPlayhead={videos.length > 1 ? onPlayhead : undefined}
    />
  );
  if (videos.length === 1) return player;

  const next = current < videos.length - 1 ? current + 1 : null;
  const fraction = playhead?.id === video.id ? playhead.fraction : finished.has(video.id) ? 1 : 0;

  // Arrow keys move between the dots; Home and End go to the first and last.
  const onListKeyDown = (event: React.KeyboardEvent) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-step]") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {/* The stepper already says how many videos there are and which one this is: no counter beside the title. */}
        <h2 key={video.id} className="rise-in min-w-0 truncate text-base font-medium leading-snug tracking-tight" aria-live="polite">
          {titleOf(video, current)}
        </h2>

        <div className="flex items-center gap-3">
          <nav aria-label={t.heading}>
            <ol ref={listRef} className="flex items-center" onKeyDown={onListKeyDown}>
              {videos.map((entry, index) => {
                const active = index === current;
                const done = finished.has(entry.id);
                const title = titleOf(entry, index);
                const previousDone = index > 0 && finished.has(videos[index - 1].id);
                return (
                  <li key={entry.id} className="flex items-center">
                    {index > 0 && (
                      // The line before a video fills once the one before it has been watched.
                      <span aria-hidden="true" className="relative mx-1 h-px w-4 overflow-hidden rounded-full bg-border sm:w-6">
                        <span
                          className="absolute inset-y-0 left-0 bg-foreground/70 transition-[width] duration-500 ease-out"
                          style={{ width: previousDone ? "100%" : "0%" }}
                        />
                      </span>
                    )}
                    <Tip
                      content={
                        <span className="flex flex-col gap-0.5 text-left">
                          <span className="font-medium">{title}</span>
                          <span className="font-mono text-[10px] tabular-nums opacity-70">
                            {[entry.durationSeconds ? clock(entry.durationSeconds) : null, active ? t.playing : done ? t.watched : null].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      }
                    >
                      <button
                        type="button"
                        data-step
                        onClick={() => select(index)}
                        aria-current={active ? "step" : undefined}
                        aria-label={`${t.video(index + 1)}: ${title}${done ? `, ${t.watched}` : ""}`}
                        className={cn(
                          "relative grid size-7 shrink-0 place-items-center rounded-full font-mono text-[11px] tabular-nums transition-[background-color,color,box-shadow,transform] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          active
                            ? "step-settle text-foreground"
                            : done
                              ? "bg-foreground text-background hover:scale-110"
                              : "text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:scale-110 hover:text-foreground hover:shadow-[inset_0_0_0_1px_var(--muted-foreground)]",
                        )}
                        key={active ? `active-${entry.id}` : entry.id}
                      >
                        {active && (
                          // The current video's ring fills as it plays.
                          <svg aria-hidden="true" viewBox="0 0 28 28" className="absolute inset-0 -rotate-90">
                            <circle cx="14" cy="14" r={RING_RADIUS} fill="none" strokeWidth="2" className="stroke-border" />
                            <circle
                              cx="14"
                              cy="14"
                              r={RING_RADIUS}
                              fill="none"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeDasharray={RING_LENGTH}
                              strokeDashoffset={RING_LENGTH * (1 - Math.max(0.02, fraction))}
                              className="stroke-foreground transition-[stroke-dashoffset] duration-300 ease-linear dark:stroke-signal"
                            />
                          </svg>
                        )}
                        {done && !active ? <Check className="size-3.5" strokeWidth={2.75} aria-hidden="true" /> : <span className="relative">{index + 1}</span>}
                      </button>
                    </Tip>
                  </li>
                );
              })}
            </ol>
          </nav>

          {next !== null && finished.has(video.id) && (
            <Tip content={t.nextVideo(titleOf(videos[next], next))}>
              <button
                type="button"
                onClick={() => select(next)}
                className="rise-in inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t.next}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
            </Tip>
          )}
        </div>
      </div>

      {player}
    </div>
  );
}
