"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";

// The lesson video player's state that isn't React's (components/courses/video-player/video-player.tsx): the learner's
// settings, kept per browser, and the caption cues, read from the video's own tracks.

/** `m:ss`, or `h:mm:ss` once a video runs past an hour. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The playback rates offered, slowest first. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const rateLabel = (rate: number) => `${rate}×`;

export type PlayerPrefs = {
  speed: number;
  /** 0 to 1. */
  volume: number;
  muted: boolean;
  /** The captions' language (a track's srclang), "off", or null: the page's language when the video has it. */
  captions: string | null;
  transcript: boolean;
};

const KEY = "adc.videoPlayer.v1";
const DEFAULTS: PlayerPrefs = { speed: 1, volume: 1, muted: false, captions: null, transcript: false };

/** Whatever is stored is a stranger's input: one bad value must never mute every video or pin an odd speed. */
function sanitise(raw: string | null): PlayerPrefs {
  if (!raw) return DEFAULTS;
  let value: Partial<Record<keyof PlayerPrefs, unknown>>;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULTS;
  }
  if (!value || typeof value !== "object") return DEFAULTS;
  const number = (entry: unknown, fallback: number, low: number, high: number) =>
    typeof entry === "number" && Number.isFinite(entry) ? Math.min(high, Math.max(low, entry)) : fallback;
  return {
    speed: number(value.speed, DEFAULTS.speed, 0.25, 3),
    volume: number(value.volume, DEFAULTS.volume, 0, 1),
    muted: typeof value.muted === "boolean" ? value.muted : DEFAULTS.muted,
    captions: typeof value.captions === "string" && /^(off|[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(value.captions) ? value.captions : null,
    transcript: typeof value.transcript === "boolean" ? value.transcript : DEFAULTS.transcript,
  };
}

// One store for every player on the page, so a speed chosen in one video holds in the next.
let memory: string | null = null; // When the browser refuses storage (a private window), the settings live here.
let cachedRaw: string | null | undefined;
let cached = DEFAULTS;
const listeners = new Set<() => void>();

function snapshot(): PlayerPrefs {
  let raw = memory;
  if (raw === null) {
    try {
      raw = window.localStorage.getItem(KEY);
    } catch {
      raw = null;
    }
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = sanitise(raw);
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => event.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The learner's player settings: per browser, the same in every lesson video, defaults on the server. */
export function usePlayerPrefs(): [PlayerPrefs, (patch: Partial<PlayerPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
  const patch = useCallback((next: Partial<PlayerPrefs>) => {
    const merged = JSON.stringify({ ...snapshot(), ...next });
    try {
      window.localStorage.setItem(KEY, merged);
      memory = null;
    } catch {
      memory = merged;
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [prefs, patch];
}

export type Cue = { start: number; end: number; text: string };

/**
 * The cues of every caption track on the video, by language, as data. The `<track>` elements only make the browser
 * parse the WebVTT: they stay `hidden`, never `showing`, because the player draws the captions itself (above its
 * control bar, where the browser can't put them), and the cues also feed the transcript and the seek bar's preview.
 * A track's `load` event is unreliable once cached, so the cues are polled for a few seconds.
 */
export function useTrackCues(videoRef: RefObject<HTMLVideoElement | null>, tracksKey: string): Record<string, Cue[]> {
  const [cues, setCues] = useState<Record<string, Cue[]>>({});
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !tracksKey) return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const harvest = () => {
      const found: Record<string, Cue[]> = {};
      let waiting = false;
      for (const element of Array.from(video.querySelectorAll("track"))) {
        const track = element.track;
        if (track.mode !== "hidden") track.mode = "hidden"; // Parsed, never painted.
        const list = track.cues;
        if (!list || list.length === 0) {
          waiting = true;
          continue;
        }
        found[element.srclang] = Array.from(list).flatMap((cue) => {
          const text = (cue as VTTCue).text
            .split("\n")
            .map((line) => line.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join("\n");
          return text ? [{ start: cue.startTime, end: cue.endTime, text }] : [];
        });
      }
      setCues(found);
      return !waiting;
    };
    const poll = () => {
      if (stopped || harvest() || ++tries >= 40) return;
      timer = setTimeout(poll, 250);
    };
    timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [videoRef, tracksKey]);
  return cues;
}

/** The cue being spoken at `time`, or -1. */
export function cueIndexAt(cues: Cue[], time: number): number {
  for (let index = 0; index < cues.length; index++) {
    if (time < cues[index].start) return -1;
    if (time < cues[index].end) return index;
  }
  return -1;
}
