"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, PlayCircle } from "lucide-react";
import type { VideoState } from "@/actions/lessons";
import { LessonVideo } from "@/components/courses/lesson-video";
import type { LessonVideo as LessonVideoData } from "@/lib/lesson-video";
import { cn } from "@/lib/utils";

// A lesson's videos (docs/lesson-videos.md): one per skill as a rule, in teaching order. One video plays alone; several
// get a playlist under the player, with each one's length and a tick once watched to the end, and "next" when one
// ends. The playlist sits under the player, not beside it, because the videos are landscape screencasts: the player
// keeps the column's full width, which code on screen needs. The open video is kept in the address (?video=2), so a
// link or a reload opens it.

export type PlayableVideo = {
  id: string;
  title: { es: string | null; en: string | null };
  durationSeconds: number | null;
  video: LessonVideoData;
};

const COPY = {
  es: {
    heading: "Videos de la lección",
    counter: (index: number, total: number) => `Video ${index} de ${total}`,
    untitled: (index: number) => `Video ${index}`,
    next: "Siguiente",
    watched: "Visto",
  },
  en: {
    heading: "Lesson videos",
    counter: (index: number, total: number) => `Video ${index} of ${total}`,
    untitled: (index: number) => `Video ${index}`,
    next: "Next",
    watched: "Watched",
  },
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

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
    />
  );
  if (videos.length === 1) return player;

  const next = current < videos.length - 1 ? current + 1 : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        {player}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t.counter(current + 1, videos.length)}</p>
            <h2 className="mt-1 text-lg font-medium leading-snug tracking-tight">{titleOf(video, current)}</h2>
          </div>
          {next !== null && finished.has(video.id) && (
            <button
              type="button"
              onClick={() => select(next)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.next}: <span className="max-w-[16rem] truncate">{titleOf(videos[next], next)}</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <nav aria-label={t.heading} className="rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-tile)]">
        <p className="px-3 pt-2 pb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t.heading} · {videos.length}
        </p>
        <ol className="grid gap-0.5 sm:grid-cols-2">
          {videos.map((entry, index) => {
            const active = index === current;
            const done = finished.has(entry.id);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => select(index)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-label={done ? t.watched : undefined}>
                    {done ? (
                      <Check className="size-4 text-foreground" strokeWidth={2.5} />
                    ) : active ? (
                      <PlayCircle className="size-4 text-foreground" />
                    ) : (
                      <span className="font-mono text-[11px] tabular-nums">{index + 1}</span>
                    )}
                  </span>
                  <span className={cn("min-w-0 flex-1 leading-snug", active && "font-medium")}>{titleOf(entry, index)}</span>
                  {entry.durationSeconds ? <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{clock(entry.durationSeconds)}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
