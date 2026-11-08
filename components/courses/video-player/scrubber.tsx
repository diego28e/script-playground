"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { clock, cueIndexAt, type Cue } from "./player-state";

/** Half the widest the preview bubble gets, in px: it stays inside the bar near the ends. */
const BUBBLE_INSET = 120;

type Hover = { x: number; time: number; width: number };

/**
 * The seek bar: thin at rest, thicker when pointed at, over a generous hit area. It shows what has downloaded, and
 * under the pointer the time and the line spoken there, so a learner can find "where he explained that" by its words.
 * Pointer events with capture, so a drag that leaves the bar keeps seeking.
 */
export function Scrubber({
  current,
  duration,
  buffered,
  cues,
  label,
  onSeek,
  onScrubChange,
}: {
  current: number;
  duration: number;
  /** Seconds downloaded, from 0. */
  buffered: number;
  cues: Cue[];
  label: string;
  onSeek: (seconds: number) => void;
  onScrubChange: (scrubbing: boolean) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [dragging, setDragging] = useState(false);
  const ready = duration > 0;
  const progress = ready ? Math.min(100, (current / duration) * 100) : 0;
  const loaded = ready ? Math.min(100, (buffered / duration) * 100) : 0;

  const measure = useCallback(
    (clientX: number): Hover | null => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || !ready) return null;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return { x: ratio * rect.width, time: ratio * duration, width: rect.width };
    },
    [duration, ready],
  );

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    onScrubChange(false);
  };

  // Handled here and kept from the player's own arrow keys, or the playhead would move twice.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!ready) return;
    const step = event.shiftKey ? 1 : 5;
    const jumps: Record<string, number> = { ArrowLeft: -step, ArrowRight: step, PageDown: -30, PageUp: 30 };
    if (event.key in jumps) {
      event.preventDefault();
      event.stopPropagation();
      onSeek(current + jumps[event.key]);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      onSeek(event.key === "Home" ? 0 : duration);
    }
  };

  const preview = hover ? cues[cueIndexAt(cues, hover.time)] : undefined;
  const bubbleLeft = hover ? (hover.width > BUBBLE_INSET * 2 ? Math.min(hover.width - BUBBLE_INSET, Math.max(BUBBLE_INSET, hover.x)) : hover.width / 2) : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={ready ? 0 : -1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
      aria-valuetext={`${clock(current)} / ${clock(duration)}`}
      onPointerDown={(event) => {
        const at = measure(event.clientX);
        if (!at) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onScrubChange(true);
        setHover(at);
        onSeek(at.time);
      }}
      onPointerMove={(event) => {
        const at = measure(event.clientX);
        if (!at) return;
        setHover(at);
        if (dragging) onSeek(at.time);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => !dragging && setHover(null)}
      onKeyDown={onKeyDown}
      className={cn("group/scrub relative flex h-4 w-full touch-none select-none items-center outline-none", ready ? "cursor-pointer" : "cursor-default opacity-50")}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150",
          dragging ? "h-[5px]" : "h-[3px] group-hover/scrub:h-[5px] group-focus-visible/scrub:h-[5px]",
        )}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${loaded}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-signal" style={{ width: `${progress}%` }} />
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal shadow-[0_0_0_2px_rgba(0,0,0,0.35)] transition-transform duration-150",
          dragging ? "scale-110" : "scale-0 group-hover/scrub:scale-100 group-focus-visible/scrub:scale-100",
        )}
        style={{ left: `${progress}%` }}
      />
      {hover && ready && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-3 w-max max-w-[15rem] -translate-x-1/2 rounded-lg border border-white/10 bg-[#0f1520]/95 px-2.5 py-1.5 text-center shadow-lg backdrop-blur-sm"
          style={{ left: `${bubbleLeft}px` }}
        >
          {preview && <p className="mb-1 line-clamp-2 text-[11px] leading-snug whitespace-pre-line text-white/75">{preview.text}</p>}
          <span className="font-mono text-xs tabular-nums text-white">{clock(hover.time)}</span>
        </div>
      )}
    </div>
  );
}
