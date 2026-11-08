"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { clock, type Cue } from "./player-state";

type Strings = { search: string; clear: string; follow: string; following: string; nothing: string; transcript: string };

function highlight(text: string, query: string) {
  if (!query) return text;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-signal/30 px-0.5 text-white">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * The narration as text, under the video: the line being spoken is marked and kept in view, any line can be clicked
 * to jump there, and a search finds the moment something was said. Scrolling the list by hand stops it following
 * until "Follow" is pressed.
 */
export const TranscriptPanel = memo(function TranscriptPanel({
  cues,
  activeIndex,
  language,
  strings,
  onSeek,
}: {
  cues: Cue[];
  activeIndex: number;
  /** The transcript's language, for screen readers and hyphenation. */
  language: string;
  strings: Strings;
  onSeek: (seconds: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const ownScrollAt = useRef(0);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = cues.map((cue, index) => ({ cue, index }));
    return needle ? all.filter(({ cue }) => cue.text.toLowerCase().includes(needle)) : all;
  }, [cues, query]);

  // Keeps the spoken line in the middle of the list (the list scrolls, never the page).
  useEffect(() => {
    if (!follow || query) return;
    const list = listRef.current;
    const line = activeRef.current;
    if (!list || !line) return;
    ownScrollAt.current = Date.now();
    list.scrollTo({ top: line.offsetTop - list.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
  }, [activeIndex, follow, query]);

  return (
    <div className="border-t border-white/10 bg-[#0f1520]" aria-label={strings.transcript} role="region">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/40" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.search}
            aria-label={strings.search}
            className="h-8 w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-8 text-sm text-white placeholder:text-white/40 focus:border-signal/60 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={strings.clear}
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {!query && (
          <button
            type="button"
            onClick={() => setFollow(true)}
            aria-pressed={follow}
            className={cn(
              "h-8 shrink-0 rounded-lg px-2.5 text-xs transition-colors",
              follow ? "text-white/45" : "bg-signal/15 text-signal hover:bg-signal/25",
            )}
          >
            {follow ? strings.following : strings.follow}
          </button>
        )}
      </div>
      <div
        ref={listRef}
        lang={language}
        onScroll={() => {
          if (Date.now() - ownScrollAt.current > 600) setFollow(false);
        }}
        className="relative max-h-56 overflow-y-auto px-1.5 pb-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent]"
      >
        {visible.length === 0 && <p className="px-3 py-4 text-center text-sm text-white/50">{strings.nothing}</p>}
        {visible.map(({ cue, index }) => {
          const active = index === activeIndex;
          return (
            <button
              key={index}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSeek(cue.start)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex w-full gap-3 rounded-lg border-l-2 px-2.5 py-1.5 text-left text-sm leading-relaxed transition-colors",
                active ? "border-signal bg-white/[0.07] text-white" : "border-transparent text-white/60 hover:bg-white/5 hover:text-white/90",
              )}
            >
              <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-white/40">{clock(cue.start)}</span>
              <span className="whitespace-pre-line">{highlight(cue.text.replace(/\n/g, " "), query.trim())}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
