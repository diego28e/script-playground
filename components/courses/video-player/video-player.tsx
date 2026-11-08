"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Captions,
  CaptionsOff,
  Keyboard,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  TextQuote,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";
import { PlayerMenu } from "./player-menu";
import { Scrubber } from "./scrubber";
import { TranscriptPanel } from "./transcript-panel";
import { clock, cueIndexAt, rateLabel, SPEEDS, usePlayerPrefs, useTrackCues } from "./player-state";

// The platform's player for lesson videos without quizzes (an interactive video plays in lk-react's own player).
// Drawn after the reviewer player of the OCW platform, made for learners:
// - every control is ours, never the browser's: no download item, no native menu, and the same look in every browser;
//   right-click on the video does nothing. (A determined learner can still find the file: its signed address is in
//   the page and expires in hours. This removes the easy ways.)
// - captions are drawn by the player above its bar, in the learner's choice of language (Off, English, Español…);
//   the cues also give the transcript under the video and the line spoken under the pointer on the seek bar;
// - speed from 0.5× to 2×, volume, ±10 s, picture in picture, fullscreen and keyboard shortcuts (? lists them), with
//   speed, volume and the caption language remembered in the browser for every lesson video;
// - the bar hides while the video plays and comes back with the pointer, the keyboard or a pause.
// Key it by the video (a new file is a new player): the time, length, buffer and errors all belong to one file.

const COPY = {
  en: {
    play: "Play",
    pause: "Pause",
    replay: "Watch again",
    back: "Back 10 seconds",
    forward: "Forward 10 seconds",
    mute: "Mute",
    unmute: "Unmute",
    volume: "Volume",
    seek: "Seek",
    remaining: "Show time remaining",
    elapsed: "Show time elapsed",
    speed: "Playback speed",
    captions: "Captions",
    captionsOff: "Off",
    noCaptions: "This video has no captions yet",
    transcript: "Transcript",
    pip: "Picture in picture",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    shortcuts: "Keyboard shortcuts",
    close: "Close",
    retry: "Try again",
    errors: {
      1: "Playback was stopped before it began.",
      2: "The connection dropped while loading the video.",
      3: "This video file couldn't be played.",
      4: "The video couldn't be loaded. Reload the page to get a fresh link.",
    } as Record<number, string>,
    error: "This video couldn't be played.",
    search: "Search the transcript",
    clear: "Clear the search",
    follow: "Follow",
    following: "Following",
    nothing: "No line says that.",
    keys: [
      ["Space / K", "Play or pause"],
      ["J / L", "Back or forward 10 s"],
      ["← / →", "Back or forward 5 s (Shift: 1 s)"],
      ["< / >", "Slower or faster"],
      ["0 – 9", "Jump to 0% – 90%"],
      ["Home / End", "Start or end"],
      ["M", "Mute"],
      ["C", "Captions on or off"],
      ["T", "Transcript"],
      ["P", "Picture in picture"],
      ["F", "Fullscreen"],
      ["?", "This list"],
    ],
  },
  es: {
    play: "Reproducir",
    pause: "Pausar",
    replay: "Ver de nuevo",
    back: "Retroceder 10 segundos",
    forward: "Adelantar 10 segundos",
    mute: "Silenciar",
    unmute: "Activar sonido",
    volume: "Volumen",
    seek: "Buscar en el video",
    remaining: "Ver tiempo restante",
    elapsed: "Ver tiempo transcurrido",
    speed: "Velocidad",
    captions: "Subtítulos",
    captionsOff: "Desactivados",
    noCaptions: "Este video aún no tiene subtítulos",
    transcript: "Transcripción",
    pip: "Imagen en imagen",
    fullscreen: "Pantalla completa",
    exitFullscreen: "Salir de pantalla completa",
    shortcuts: "Atajos de teclado",
    close: "Cerrar",
    retry: "Reintentar",
    errors: {
      1: "La reproducción se detuvo antes de empezar.",
      2: "Se cortó la conexión mientras cargaba el video.",
      3: "No se pudo reproducir este archivo de video.",
      4: "No se pudo cargar el video. Recarga la página para obtener un enlace nuevo.",
    } as Record<number, string>,
    error: "No se pudo reproducir este video.",
    search: "Buscar en la transcripción",
    clear: "Borrar la búsqueda",
    follow: "Seguir",
    following: "Siguiendo",
    nothing: "Ninguna línea dice eso.",
    keys: [
      ["Espacio / K", "Reproducir o pausar"],
      ["J / L", "Retroceder o adelantar 10 s"],
      ["← / →", "Retroceder o adelantar 5 s (Shift: 1 s)"],
      ["< / >", "Más lento o más rápido"],
      ["0 – 9", "Ir al 0% – 90%"],
      ["Inicio / Fin", "Al principio o al final"],
      ["M", "Silenciar"],
      ["C", "Subtítulos sí o no"],
      ["T", "Transcripción"],
      ["P", "Imagen en imagen"],
      ["F", "Pantalla completa"],
      ["?", "Esta lista"],
    ],
  },
};

export type PlayerTrack = { kind: string; src: string; srclang: string; label: string };

type Props = {
  src: string;
  poster?: string;
  tracks?: PlayerTrack[];
  /** The video's name, for screen readers. */
  title: string;
  /** The page's language: the player's words, and the captions shown until the learner picks others. */
  language: "es" | "en";
  /** A vertical video gets a 9:16 frame. */
  portrait?: boolean;
  /** Where to start (the learner's last place), in seconds. */
  startAt?: number;
  /** The furthest the learner had got before, in seconds. */
  furthestBefore?: number;
  /** Where the learner is, every few seconds while playing and at once on pause, seek and end. */
  onProgress?: (progress: { at: number; furthest: number }) => void;
  onEnded?: () => void;
};

const SKIP_SECONDS = 10;
const CHROME_HIDE_MS = 2500;
const REPORT_MS = 5000;

const primary = (code: string) => code.split("-")[0].toLowerCase();

function bufferedTo(element: HTMLVideoElement): number {
  const ranges = element.buffered;
  for (let index = 0; index < ranges.length; index++) {
    if (ranges.start(index) <= element.currentTime && element.currentTime <= ranges.end(index)) return ranges.end(index);
  }
  return 0;
}

function BarButton({ label, hint, onClick, active, disabled, children }: { label: string; hint?: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <Tip content={hint ?? label} wrap={disabled}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70",
          disabled ? "cursor-not-allowed text-white/25" : active ? "text-signal hover:bg-signal/15" : "text-white/85 hover:bg-white/10 hover:text-white",
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

export function VideoPlayer({ src, poster, tracks = [], title, language, portrait = false, startAt = 0, furthestBefore = 0, onProgress, onEnded }: Props) {
  const t = COPY[language];
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const furthest = useRef(furthestBefore);
  const lastReport = useRef(0);

  const [prefs, setPrefs] = usePlayerPrefs();
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  // The big play button shows before the first play and after the end, never over a paused frame: a learner pauses
  // to read code, and the button would sit on it.
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(startAt);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [menu, setMenu] = useState<"speed" | "captions" | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [countdown, setCountdown] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  // Keyboard focus on a control keeps the bar up; a touch on a playing video brings the bar back before it pauses.
  const [focusInside, setFocusInside] = useState(false);
  const lastPointer = useRef<string>("mouse");

  // Caption tracks, and the one shown: the learner's choice, else the page's language, else the first.
  const captionTracks = useMemo(() => tracks.filter((track) => track.kind === "captions" || track.kind === "subtitles"), [tracks]);
  const find = useCallback((code: string | null) => (code ? captionTracks.find((track) => primary(track.srclang) === primary(code)) : undefined), [captionTracks]);
  const shown = prefs.captions === "off" ? null : (find(prefs.captions) ?? find(language) ?? captionTracks[0] ?? null);
  const readable = shown ?? find(language) ?? captionTracks[0] ?? null;
  const allCues = useTrackCues(videoRef, captionTracks.map((track) => track.src).join("|"));
  const shownCues = useMemo(() => (shown ? (allCues[shown.srclang] ?? []) : []), [allCues, shown]);
  const transcriptCues = useMemo(() => (readable ? (allCues[readable.srclang] ?? []) : []), [allCues, readable]);
  const activeCue = useMemo(() => cueIndexAt(shownCues, current), [shownCues, current]);
  const activeLine = useMemo(() => cueIndexAt(transcriptCues, current), [transcriptCues, current]);
  const transcriptOpen = prefs.transcript && transcriptCues.length > 0 && !fullscreen;

  /* ── Transport ── */

  const report = useCallback(
    (force = false) => {
      const element = videoRef.current;
      if (!element || !onProgress) return;
      furthest.current = Math.max(furthest.current, element.currentTime);
      if (!force && Date.now() - lastReport.current < REPORT_MS) return;
      lastReport.current = Date.now();
      onProgress({ at: element.currentTime, furthest: furthest.current });
    },
    [onProgress],
  );

  const toggle = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const element = videoRef.current;
    if (!element) return;
    const end = Number.isFinite(element.duration) ? element.duration : 0;
    const next = Math.min(Math.max(0, seconds), end);
    element.currentTime = next;
    setCurrent(next);
    setEnded(false);
  }, []);

  const skip = useCallback((delta: number) => {
    const element = videoRef.current;
    if (element) seekTo(element.currentTime + delta);
  }, [seekTo]);

  const nudgeSpeed = (direction: 1 | -1) => {
    const at = SPEEDS.indexOf(prefs.speed as (typeof SPEEDS)[number]);
    const from = at === -1 ? SPEEDS.indexOf(1) : at;
    setPrefs({ speed: SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, from + direction))] });
  };

  const toggleCaptions = () => {
    if (!captionTracks.length) return;
    setPrefs({ captions: shown ? "off" : (find(language) ?? captionTracks[0]).srclang });
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void shellRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const togglePip = useCallback(() => {
    const element = videoRef.current;
    if (!element || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void element.requestPictureInPicture().catch(() => undefined);
  }, []);

  /* ── What the element owns ── */

  // The time follows the video frame by frame while playing (timeupdate comes only four times a second, and the bar
  // would lurch), but not while the learner drags the playhead.
  useEffect(() => {
    if (!playing || scrubbing) return;
    let frame = 0;
    const tick = () => {
      const element = videoRef.current;
      if (element) {
        setCurrent(element.currentTime);
        setBuffered(bufferedTo(element));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scrubbing]);

  useEffect(() => {
    const element = videoRef.current;
    if (element) element.playbackRate = prefs.speed;
  }, [prefs.speed]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.volume = prefs.volume;
    element.muted = prefs.muted;
  }, [prefs.volume, prefs.muted]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onChange);
    const element = videoRef.current;
    const enter = () => setPip(true);
    const leave = () => setPip(false);
    element?.addEventListener("enterpictureinpicture", enter);
    element?.addEventListener("leavepictureinpicture", leave);
    // Known only in the browser; checked after mount so the server's HTML matches.
    const probe = setTimeout(() => setPipSupported(Boolean(document.pictureInPictureEnabled)), 0);
    return () => {
      clearTimeout(probe);
      document.removeEventListener("fullscreenchange", onChange);
      element?.removeEventListener("enterpictureinpicture", enter);
      element?.removeEventListener("leavepictureinpicture", leave);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  /* ── The bar hides while playing ── */

  const reveal = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
  }, []);
  const chrome = chromeVisible || !playing || scrubbing || menu !== null || shortcutsOpen || focusInside || Boolean(error);

  /* ── Keyboard ── */

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    // The transcript's search box is inside the player: typing there is typing.
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    // Space and Enter belong to the focused button (pressing Space on Mute mutes).
    if (target?.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === "Escape") {
      if (shortcutsOpen) {
        event.preventDefault();
        setShortcutsOpen(false);
      }
      return;
    }
    const handled = () => {
      event.preventDefault();
      reveal();
    };
    if (key >= "0" && key <= "9") {
      handled();
      seekTo((Number(key) / 10) * duration);
      return;
    }
    switch (key.length === 1 ? key.toLowerCase() : key) {
      case " ":
      case "k":
        handled();
        toggle();
        break;
      case "j":
        handled();
        skip(-SKIP_SECONDS);
        break;
      case "l":
        handled();
        skip(SKIP_SECONDS);
        break;
      case "ArrowLeft":
        handled();
        skip(event.shiftKey ? -1 : -5);
        break;
      case "ArrowRight":
        handled();
        skip(event.shiftKey ? 1 : 5);
        break;
      case "Home":
        handled();
        seekTo(0);
        break;
      case "End":
        handled();
        seekTo(duration);
        break;
      case "<":
        handled();
        nudgeSpeed(-1);
        break;
      case ">":
        handled();
        nudgeSpeed(1);
        break;
      case "m":
        handled();
        setPrefs({ muted: !prefs.muted });
        break;
      case "c":
        handled();
        toggleCaptions();
        break;
      case "t":
        handled();
        if (transcriptCues.length) setPrefs({ transcript: !prefs.transcript });
        break;
      case "p":
        handled();
        togglePip();
        break;
      case "f":
        handled();
        toggleFullscreen();
        break;
      case "?":
        handled();
        setShortcutsOpen((open) => !open);
        break;
    }
  };

  /* ── Render ── */

  const caption = shown && activeCue >= 0 ? shownCues[activeCue]?.text : undefined;
  const VolumeIcon = prefs.muted || prefs.volume === 0 ? VolumeX : prefs.volume < 0.5 ? Volume1 : Volume2;
  const captionOptions = [{ value: "off", label: t.captionsOff }, ...captionTracks.map((track) => ({ value: track.srclang, label: track.label }))];

  return (
    <div
      ref={shellRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={reveal}
      onPointerDown={(event) => {
        lastPointer.current = event.pointerType;
      }}
      onPointerLeave={() => playing && setChromeVisible(false)}
      onFocus={(event) => {
        if (event.target !== event.currentTarget) setFocusInside(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusInside(false);
      }}
      aria-label={title}
      role="region"
      className={cn(
        "@container group/player relative flex flex-col overflow-hidden rounded-2xl bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-signal/60",
        fullscreen && "h-screen w-screen rounded-none",
      )}
    >
      <div className={cn("relative flex min-h-0 flex-1 items-center justify-center bg-black", !chrome && playing && "cursor-none")}>
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          preload="metadata"
          playsInline
          // Captions come from the media host, another origin: the browser only reads them with CORS.
          crossOrigin="anonymous"
          controlsList="nodownload noremoteplayback"
          disableRemotePlayback
          draggable={false}
          aria-label={title}
          onClick={() => {
            // On a touch screen the first tap on a playing video shows the bar; the next one pauses.
            if (lastPointer.current === "touch" && playing && !chrome) {
              reveal();
              return;
            }
            toggle();
          }}
          onDoubleClick={toggleFullscreen}
          onContextMenu={(event) => event.preventDefault()}
          onPlay={() => {
            setPlaying(true);
            setStarted(true);
            setEnded(false);
            reveal();
          }}
          onPause={() => {
            setPlaying(false);
            report(true);
          }}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onSeeked={(event) => {
            setBuffered(bufferedTo(event.currentTarget));
            report(true);
          }}
          onProgress={(event) => setBuffered(bufferedTo(event.currentTarget))}
          onTimeUpdate={(event) => {
            // A seek from outside the bar (a media key, the picture-in-picture window) while paused.
            if (!playing && !scrubbing) setCurrent(event.currentTarget.currentTime);
            report();
          }}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            setDuration(element.duration);
            element.playbackRate = prefs.speed;
            element.volume = prefs.volume;
            element.muted = prefs.muted;
            // Back where the learner left off, unless that was the very end.
            if (startAt > 0 && startAt < element.duration - 5) {
              element.currentTime = startAt;
              setCurrent(startAt);
            }
          }}
          onEnded={() => {
            setPlaying(false);
            setEnded(true);
            setChromeVisible(true);
            report(true);
            onEnded?.();
          }}
          onError={(event) => {
            setWaiting(false);
            setError(t.errors[event.currentTarget.error?.code ?? 0] ?? t.error);
          }}
          className={cn("block cursor-pointer bg-black object-contain", fullscreen ? "h-full w-full" : portrait ? "aspect-[9/16] w-full" : "aspect-video w-full")}
        >
          {captionTracks.map((track) => (
            <track key={track.srclang} kind={track.kind} src={track.src} srcLang={track.srclang} label={track.label} />
          ))}
        </video>

        {caption && !error && (
          <div
            aria-hidden="true"
            className={cn("pointer-events-none absolute inset-x-0 z-10 flex justify-center px-[6%] transition-[bottom] duration-200", chrome ? "bottom-16" : "bottom-[5%]")}
          >
            <p
              lang={shown?.srclang}
              className="max-w-[min(56rem,92%)] whitespace-pre-line rounded-md bg-black/75 px-[0.6em] py-[0.25em] text-center font-medium leading-snug text-white shadow-lg [text-wrap:balance] text-[clamp(0.8rem,2.15cqw,2rem)]"
            >
              {caption}
            </p>
          </div>
        )}

        {waiting && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-white/85" aria-hidden="true" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
            <AlertTriangle className="size-6 text-amber-300" aria-hidden="true" />
            <p className="max-w-sm text-sm text-white/85" role="alert">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                videoRef.current?.load();
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3.5 py-1.5 text-xs text-white/90 transition-colors hover:bg-white/10"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t.retry}
            </button>
          </div>
        )}

        {!playing && !waiting && !error && (!started || ended) && (
          <button
            type="button"
            onClick={() => (ended ? (seekTo(0), void videoRef.current?.play()) : toggle())}
            aria-label={ended ? t.replay : t.play}
            className="absolute left-1/2 top-1/2 z-10 flex size-12 @md:size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-signal text-[#121826] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40"
          >
            {ended ? <RotateCcw className="size-5 @md:size-6" aria-hidden="true" /> : <Play className="ml-1 size-5 @md:size-7" fill="currentColor" aria-hidden="true" />}
          </button>
        )}

        {shortcutsOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#0f1520] p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t.shortcuts}</h3>
                <button type="button" onClick={() => setShortcutsOpen(false)} aria-label={t.close} className="flex size-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </button>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                {t.keys.map(([keys, what]) => (
                  <div key={keys} className="contents">
                    <dt className="whitespace-nowrap font-mono text-white/90">{keys}</dt>
                    <dd className="text-white/60">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}

        {/* The bar, over a scrim that keeps white icons readable on a light slide. */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-2 pt-10 transition-opacity duration-200",
            chrome ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <Scrubber current={current} duration={duration} buffered={buffered} cues={shownCues.length ? shownCues : transcriptCues} label={t.seek} onSeek={seekTo} onScrubChange={setScrubbing} />
          <div className="mt-1 flex items-center gap-0.5">
            <BarButton label={playing ? t.pause : t.play} hint={`${playing ? t.pause : t.play} (K)`} onClick={toggle}>
              {playing ? <Pause className="size-[18px]" fill="currentColor" /> : <Play className="size-[18px]" fill="currentColor" />}
            </BarButton>
            {/* On a narrow player (a phone) the bar keeps what matters most; the rest is a gesture or a key away. */}
            <span className="hidden @md:contents">
              <BarButton label={t.back} hint={`${t.back} (J)`} onClick={() => skip(-SKIP_SECONDS)}>
                <RotateCcw className="size-4" />
              </BarButton>
              <BarButton label={t.forward} hint={`${t.forward} (L)`} onClick={() => skip(SKIP_SECONDS)}>
                <RotateCw className="size-4" />
              </BarButton>
            </span>

            <div className="group/volume flex items-center">
              <BarButton label={prefs.muted ? t.unmute : t.mute} hint={`${prefs.muted ? t.unmute : t.mute} (M)`} onClick={() => setPrefs({ muted: !prefs.muted })}>
                <VolumeIcon className="size-4" />
              </BarButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={prefs.muted ? 0 : prefs.volume}
                aria-label={t.volume}
                onChange={(event) => setPrefs({ volume: Number(event.target.value), muted: Number(event.target.value) === 0 })}
                className="h-1 w-0 cursor-pointer opacity-0 accent-signal transition-[width,opacity] duration-200 focus:w-20 focus:opacity-100 group-hover/volume:w-20 group-hover/volume:opacity-100"
              />
            </div>

            <Tip content={countdown ? t.elapsed : t.remaining}>
              <button
                type="button"
                onClick={() => setCountdown((on) => !on)}
                className="ml-1 whitespace-nowrap rounded-md px-1.5 py-1 font-mono text-xs tabular-nums text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                {countdown ? `-${clock(Math.max(0, duration - current))}` : clock(current)}
                <span className="text-white/40"> / </span>
                {clock(duration)}
              </button>
            </Tip>

            <div className="ml-auto flex items-center gap-0.5">
              <BarButton
                label={t.transcript}
                hint={transcriptCues.length ? `${t.transcript} (T)` : t.noCaptions}
                onClick={() => setPrefs({ transcript: !prefs.transcript })}
                active={transcriptOpen}
                disabled={!transcriptCues.length || fullscreen}
              >
                <TextQuote className="size-4" />
              </BarButton>
              <PlayerMenu
                label={t.speed}
                triggerLabel={`${t.speed}, ${rateLabel(prefs.speed)}`}
                trigger={<span className="font-mono tabular-nums">{rateLabel(prefs.speed)}</span>}
                active={prefs.speed !== 1}
                options={SPEEDS.map((speed) => ({ value: speed, label: speed === 1 ? `${rateLabel(1)} · normal` : rateLabel(speed) }))}
                value={prefs.speed}
                onChange={(speed) => setPrefs({ speed })}
                open={menu === "speed"}
                onOpenChange={(open) => setMenu(open ? "speed" : null)}
              />
              {captionTracks.length > 0 ? (
                <PlayerMenu
                  label={t.captions}
                  triggerLabel={`${t.captions}, ${shown?.label ?? t.captionsOff}`}
                  trigger={
                    <>
                      {shown ? <Captions className="size-4" /> : <CaptionsOff className="size-4" />}
                      {shown && <span className="font-mono text-[10px] uppercase">{primary(shown.srclang)}</span>}
                    </>
                  }
                  active={Boolean(shown)}
                  options={captionOptions}
                  value={shown?.srclang ?? "off"}
                  onChange={(value) => setPrefs({ captions: value })}
                  open={menu === "captions"}
                  onOpenChange={(open) => setMenu(open ? "captions" : null)}
                />
              ) : (
                <BarButton label={t.captions} hint={t.noCaptions} onClick={() => undefined} disabled>
                  <CaptionsOff className="size-4" />
                </BarButton>
              )}
              {pipSupported && (
                <span className="hidden @sm:contents">
                  <BarButton label={t.pip} hint={`${t.pip} (P)`} onClick={togglePip} active={pip}>
                    <PictureInPicture2 className="size-4" />
                  </BarButton>
                </span>
              )}
              <span className="hidden @md:contents">
                <BarButton label={t.shortcuts} hint={`${t.shortcuts} (?)`} onClick={() => setShortcutsOpen((open) => !open)} active={shortcutsOpen}>
                  <Keyboard className="size-4" />
                </BarButton>
              </span>
              <BarButton label={fullscreen ? t.exitFullscreen : t.fullscreen} hint={`${fullscreen ? t.exitFullscreen : t.fullscreen} (F)`} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </BarButton>
            </div>
          </div>
        </div>
      </div>

      {transcriptOpen && readable && (
        <TranscriptPanel
          cues={transcriptCues}
          activeIndex={activeLine}
          language={readable.srclang}
          strings={{ search: t.search, clear: t.clear, follow: t.follow, following: t.following, nothing: t.nothing, transcript: t.transcript }}
          onSeek={(seconds) => {
            seekTo(seconds);
            if (videoRef.current?.paused) void videoRef.current.play().catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
