"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Headphones, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tip";
import { Scrubber } from "@/components/courses/video-player/scrubber";
import { PlayerMenu } from "@/components/courses/video-player/player-menu";
import { clock, rateLabel, SPEEDS, usePlayerPrefs } from "@/components/courses/video-player/player-state";

// The lesson told by a teacher (docs/lesson-audio.md): an audio version of the whole lesson, for listening away from the
// screen or alongside the page. It looks like the video player's bar and shares its speed setting. It remembers where
// the learner stopped, follows them down the page as a small bar while it plays, and answers the phone's lock-screen
// controls (the Media Session API).

export type LessonAudioTrack = {
  /** A signed URL. */
  src: string;
  seconds: number | null;
  /** What the teacher says, for reading along or searching. */
  transcript: string | null;
  /** Changes when the audio is voiced again, so the player starts afresh. */
  key: string;
};

const COPY = {
  es: {
    title: "Escucha esta lección",
    subtitle: "Un profesor te explica toda la lección, en voz alta.",
    minutes: (minutes: number) => `${minutes} min`,
    resume: (at: string) => `Sigue desde ${at}`,
    play: "Reproducir la lección en audio",
    pause: "Pausar",
    back: "Retroceder 15 segundos",
    forward: "Adelantar 30 segundos",
    speed: "Velocidad",
    speedLabel: (rate: string) => `Velocidad, ${rate}`,
    transcript: "Transcripción",
    showTranscript: "Mostrar lo que dice el profesor",
    hideTranscript: "Ocultar la transcripción",
    seek: "Posición en el audio",
    toPlayer: "Ir al reproductor",
    close: "Cerrar la barra",
    failed: "No se pudo cargar el audio. Recarga la página para intentarlo de nuevo.",
    left: (time: string) => `quedan ${time}`,
  },
  en: {
    title: "Listen to this lesson",
    subtitle: "A teacher explains the whole lesson, out loud.",
    minutes: (minutes: number) => `${minutes} min`,
    resume: (at: string) => `Resume from ${at}`,
    play: "Play the lesson's audio",
    pause: "Pause",
    back: "Back 15 seconds",
    forward: "Forward 30 seconds",
    speed: "Playback speed",
    speedLabel: (rate: string) => `Playback speed, ${rate}`,
    transcript: "Transcript",
    showTranscript: "Show what the teacher says",
    hideTranscript: "Hide the transcript",
    seek: "Position in the audio",
    toPlayer: "Go to the player",
    close: "Close the bar",
    failed: "The audio couldn't load. Reload the page to try again.",
    left: (time: string) => `${time} left`,
  },
};

// Where each lesson's audio was left, per browser. Small and safe to lose.
const POSITIONS_KEY = "adc.lessonAudio.v1";
const readPosition = (lessonId: string): number => {
  try {
    const value = (JSON.parse(window.localStorage.getItem(POSITIONS_KEY) ?? "{}") as Record<string, number>)[lessonId];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
};
const writePosition = (lessonId: string, seconds: number | null) => {
  try {
    const all = JSON.parse(window.localStorage.getItem(POSITIONS_KEY) ?? "{}") as Record<string, number>;
    if (seconds === null) delete all[lessonId];
    else all[lessonId] = Math.round(seconds);
    // The 200 most recent are plenty.
    const kept = Object.fromEntries(Object.entries(all).slice(-200));
    window.localStorage.setItem(POSITIONS_KEY, JSON.stringify(kept));
  } catch {
    // Storage refused: the position is only lost.
  }
};

const roundButton =
  "flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70";

export function LessonAudio({ track, lessonId, lessonTitle, language }: { track: LessonAudioTrack; lessonId: string; lessonTitle: string; language: "es" | "en" }) {
  const t = COPY[language];
  const audioRef = useRef<HTMLAudioElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = usePlayerPrefs();
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(track.seconds ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [saved, setSaved] = useState(0);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // The card is off screen while playing: the small bar shows. Closing the bar keeps it closed until the next play.
  const [offScreen, setOffScreen] = useState(false);
  const [miniClosed, setMiniClosed] = useState(false);
  const lastSaved = useRef(0);

  // Where the learner left it, read after mounting (the server has no storage).
  useEffect(() => {
    const read = setTimeout(() => {
      const at = readPosition(lessonId);
      setSaved(at);
      setCurrent(at);
    }, 0);
    return () => clearTimeout(read);
  }, [lessonId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = prefs.speed;
  }, [prefs.speed]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) => setOffScreen(!entry.isIntersecting), { threshold: 0 });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const seek = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      const end = duration || audio?.duration || 0;
      const at = Math.max(0, Math.min(end || seconds, seconds));
      setCurrent(at);
      if (audio && audio.readyState >= 1) audio.currentTime = at;
    },
    [duration],
  );

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    setMiniClosed(false);
    try {
      await audio.play();
    } catch {
      // Refused (no user gesture, or the file didn't load): the error event says which.
    }
  }, []);

  // The phone's lock screen and the keyboard's media keys.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: lessonTitle, artist: "Academia del Código", album: t.title });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void audioRef.current?.play()],
      ["pause", () => audioRef.current?.pause()],
      ["seekbackward", () => seek((audioRef.current?.currentTime ?? 0) - 15)],
      ["seekforward", () => seek((audioRef.current?.currentTime ?? 0) + 30)],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // An action this browser doesn't support.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // As above.
        }
      }
    };
  }, [lessonTitle, seek, t.title]);

  const minutes = Math.max(1, Math.round((duration || track.seconds || 0) / 60));
  const showMini = playing && offScreen && !miniClosed;
  const paragraphs = track.transcript?.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()) ?? [];

  return (
    <>
      {/* Not overflow-hidden: the speed menu opens above its button, over the card's top edge. */}
      <div ref={cardRef} className="mt-6 max-w-3xl rounded-2xl bg-[#0f1520] text-white shadow-[var(--shadow-tile)]">
        <div className="flex items-center gap-4 px-4 pt-4 sm:px-5">
          <button
            type="button"
            onClick={() => void toggle()}
            aria-label={playing ? t.pause : t.play}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-signal text-[#121826] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            {playing ? <Pause className="size-5" fill="currentColor" aria-hidden="true" /> : <Play className="ml-0.5 size-5" fill="currentColor" aria-hidden="true" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Headphones className="size-4 text-signal" aria-hidden="true" />
              {t.title}
              <span className="font-mono text-xs font-normal tabular-nums text-white/60">· {t.minutes(minutes)}</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-white/60">{saved > 5 && !playing && current === saved ? t.resume(clock(saved)) : t.subtitle}</p>
          </div>
        </div>

        <div className="px-4 pb-3 pt-3 sm:px-5">
          <Scrubber current={current} duration={duration} buffered={buffered} cues={[]} label={t.seek} onSeek={seek} onScrubChange={() => undefined} />
          <div className="mt-1.5 flex items-center gap-1">
            <span className="font-mono text-xs tabular-nums text-white/70">
              {clock(current)} / {clock(duration)}
            </span>
            <span className="flex-1" />
            <Tip content={t.back}>
              <button type="button" onClick={() => seek(current - 15)} aria-label={t.back} className={roundButton}>
                <RotateCcw className="size-4" aria-hidden="true" />
              </button>
            </Tip>
            <Tip content={t.forward}>
              <button type="button" onClick={() => seek(current + 30)} aria-label={t.forward} className={roundButton}>
                <RotateCw className="size-4" aria-hidden="true" />
              </button>
            </Tip>
            <PlayerMenu
              label={t.speed}
              trigger={<span className="font-mono tabular-nums">{rateLabel(prefs.speed)}</span>}
              triggerLabel={t.speedLabel(rateLabel(prefs.speed))}
              active={prefs.speed !== 1}
              options={SPEEDS.map((speed) => ({ value: speed, label: rateLabel(speed) }))}
              value={prefs.speed}
              onChange={(speed) => {
                setPrefs({ speed });
                setSpeedOpen(false);
              }}
              open={speedOpen}
              onOpenChange={setSpeedOpen}
            />
            {paragraphs.length > 0 && (
              <Tip content={transcriptOpen ? t.hideTranscript : t.showTranscript}>
                <button
                  type="button"
                  onClick={() => setTranscriptOpen(!transcriptOpen)}
                  aria-expanded={transcriptOpen}
                  aria-label={transcriptOpen ? t.hideTranscript : t.showTranscript}
                  className={cn(roundButton, transcriptOpen && "bg-signal/15 text-signal hover:bg-signal/25 hover:text-signal")}
                >
                  <FileText className="size-4" aria-hidden="true" />
                </button>
              </Tip>
            )}
          </div>
          {failed && <p className="mt-2 text-xs text-red-300">{t.failed}</p>}
        </div>

        {transcriptOpen && (
          <div className="max-h-80 overflow-y-auto border-t border-white/10 px-4 py-4 text-sm leading-relaxed text-white/80 sm:px-5 [scrollbar-color:rgba(255,255,255,0.25)_transparent]">
            <h3 className="sr-only">{t.transcript}</h3>
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="mb-3 last:mb-0">
                {paragraph}
              </p>
            ))}
          </div>
        )}

        <audio
          ref={audioRef}
          src={track.src}
          // Nothing downloads until the learner presses play.
          preload="none"
          onContextMenu={(event) => event.preventDefault()}
          onLoadedMetadata={(event) => {
            const audio = event.currentTarget;
            if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
            audio.playbackRate = prefs.speed;
            if (current > 0 && Math.abs(audio.currentTime - current) > 1) audio.currentTime = current;
          }}
          onPlay={() => {
            setPlaying(true);
            setFailed(false);
          }}
          onPause={(event) => {
            setPlaying(false);
            writePosition(lessonId, event.currentTarget.currentTime);
          }}
          onEnded={() => {
            setPlaying(false);
            writePosition(lessonId, null);
            setSaved(0);
          }}
          onTimeUpdate={(event) => {
            const audio = event.currentTarget;
            setCurrent(audio.currentTime);
            if (audio.buffered.length) setBuffered(audio.buffered.end(audio.buffered.length - 1));
            if (Math.abs(audio.currentTime - lastSaved.current) > 5) {
              lastSaved.current = audio.currentTime;
              writePosition(lessonId, audio.currentTime);
            }
          }}
          onError={() => {
            setPlaying(false);
            setFailed(true);
          }}
        />
      </div>

      {showMini && (
        <div
          role="region"
          aria-label={t.title}
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-full bg-[#0f1520]/95 py-2 pl-2 pr-3 text-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm rise-in"
        >
          <button
            type="button"
            onClick={() => void toggle()}
            aria-label={playing ? t.pause : t.play}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal text-[#121826] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40"
          >
            {playing ? <Pause className="size-4" fill="currentColor" aria-hidden="true" /> : <Play className="ml-0.5 size-4" fill="currentColor" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
            aria-label={t.toPlayer}
          >
            <span className="block truncate text-xs font-medium">{lessonTitle}</span>
            <span className="block font-mono text-[11px] tabular-nums text-white/60">{t.left(clock(Math.max(0, duration - current)))}</span>
          </button>
          <Tip content={t.close}>
            <button type="button" onClick={() => setMiniClosed(true)} aria-label={t.close} className="flex size-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
              <X className="size-4" aria-hidden="true" />
            </button>
          </Tip>
        </div>
      )}
    </>
  );
}
