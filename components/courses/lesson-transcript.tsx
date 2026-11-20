"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import { estimatedStarts, transcriptParagraphs, wordAt, type TranscriptParagraph } from "@/lib/lesson-audio/words";

// The lesson audio's transcript, following the audio (docs/lesson-audio.md, "Following the audio"): the word being
// said is lit, the paragraph it's in stands out, and the panel scrolls to keep it in view. Tapping a word plays from
// there. Scrolling by hand stops the following until "Follow the audio" is pressed (or a word tapped). When each word is
// said comes from the worker's timing (lib/lesson-audio/timing.ts); until a lesson is timed, an even-pace estimate.

const COPY = {
  es: { transcript: "Transcripción", hint: "Toca una palabra para escuchar desde ahí.", follow: "Seguir el audio" },
  en: { transcript: "Transcript", hint: "Tap a word to listen from there.", follow: "Follow the audio" },
};

type Props = {
  script: string;
  /** When each word starts, in hundredths of a second, or null to estimate. */
  timings: number[] | null;
  duration: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  onSeek: (seconds: number) => void;
  language: "es" | "en";
};

export function LessonTranscript({ script, timings, duration, audioRef, playing, onSeek, language }: Props) {
  const t = COPY[language];
  const paragraphs = useMemo(() => transcriptParagraphs(script), [script]);
  const starts = useMemo(() => timings ?? estimatedStarts(paragraphs.flatMap((paragraph) => paragraph.words), duration || 1), [timings, paragraphs, duration]);
  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const ownScroll = useRef(0);

  // The word being said: every frame while playing (cheap: a state change only when the word changes), and on a seek.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => setActive(audio.currentTime > 0 ? wordAt(starts, audio.currentTime) : -1);
    update();
    let frame = 0;
    if (playing) {
      const tick = () => {
        update();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    audio.addEventListener("seeked", update);
    audio.addEventListener("timeupdate", update);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("seeked", update);
      audio.removeEventListener("timeupdate", update);
    };
  }, [audioRef, playing, starts]);

  // Keeps the word in view: when it leaves the band a third of the way down, the panel scrolls it back there.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !following || active < 0) return;
    const word = box.querySelector<HTMLElement>(`[data-w="${active}"]`);
    if (!word) return;
    const top = word.offsetTop;
    const view = box.clientHeight;
    if (top >= box.scrollTop + view * 0.15 && top <= box.scrollTop + view * 0.65) return;
    ownScroll.current = Date.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: Math.max(0, top - view * 0.3), behavior: reduced ? "auto" : "smooth" });
  }, [active, following]);

  // Scrolling by hand (not the panel's own scroll) stops the following.
  const userScrolled = useCallback(() => {
    if (Date.now() - ownScroll.current > 700) setFollowing(false);
  }, []);

  const jump = (event: React.MouseEvent<HTMLDivElement>) => {
    const word = (event.target as HTMLElement).closest<HTMLElement>("[data-w]");
    if (!word) return;
    const index = Number(word.dataset.w);
    if (!Number.isFinite(index) || starts[index] === undefined) return;
    setFollowing(true);
    onSeek(starts[index] / 100);
  };

  const current = paragraphs.findIndex((paragraph) => active >= paragraph.first && active < paragraph.first + paragraph.words.length);

  return (
    <div className="relative border-t border-white/10">
      <h3 className="sr-only">{t.transcript}</h3>
      <div
        ref={boxRef}
        tabIndex={0}
        aria-label={t.transcript}
        onWheel={userScrolled}
        onTouchMove={userScrolled}
        onKeyDown={userScrolled}
        onClick={jump}
        className="relative max-h-[min(55vh,26rem)] overflow-y-auto px-4 py-4 text-[15px] leading-relaxed sm:px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal/60 [scrollbar-color:rgba(255,255,255,0.25)_transparent]"
      >
        <p className="mb-3 text-xs text-white/45">{t.hint}</p>
        {paragraphs.map((paragraph, index) => (
          <Paragraph
            key={index}
            paragraph={paragraph}
            word={index === current ? active : -1}
            state={current < 0 ? "future" : index < current ? "past" : index === current ? "current" : "future"}
          />
        ))}
      </div>
      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-signal px-3.5 py-1.5 text-xs font-semibold text-[#121826] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40 rise-in"
        >
          <LocateFixed className="size-3.5" aria-hidden="true" />
          {t.follow}
        </button>
      )}
    </div>
  );
}

/** A paragraph: only the one being said re-renders as the words go by. */
const Paragraph = memo(function Paragraph({ paragraph, word, state }: { paragraph: TranscriptParagraph; word: number; state: "past" | "current" | "future" }) {
  return (
    <p className={cn("mb-3 cursor-pointer transition-colors duration-300 last:mb-0 motion-reduce:transition-none", state === "current" ? "text-white/60" : state === "past" ? "text-white/45" : "text-white/70")}>
      {paragraph.words.map((text, index) => {
        const at = paragraph.first + index;
        return (
          <span key={index}>
            <span data-w={at} className={cn(state === "current" && at < word && "text-white", at === word && "transcript-word-now")}>
              {text}
            </span>{" "}
          </span>
        );
      })}
    </p>
  );
});
