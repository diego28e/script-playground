"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Hand, MessageCircleQuestion, Play } from "lucide-react";
import { onStopsChange, readStopsOn, stopCrossed, writeStopsOn, type PlayerStop } from "@/lib/lesson-stops/shared";
import { cn } from "@/lib/utils";

// Hands-on stops in the audio and video players (docs/lesson-stops.md): the recording pauses where the learner has a
// step to do on their own computer and shows it, with its exact commands to copy, until they continue. Each learner can
// turn the pauses off (listening away from the computer) with the switch on the player; it holds for every lesson.

const COPY = {
  es: {
    yourTurn: "Te toca",
    continue: "Hecho, continuar",
    ask: "Preguntar al profesor",
    copy: "Copiar",
    copied: "Copiado",
    off: "No pausar en las lecciones",
    label: "Pausar en los pasos prácticos",
    switchOn: (count: number) => `Pausa en ${count} ${count === 1 ? "paso práctico" : "pasos prácticos"}. Toca para no pausar.`,
    switchOff: "No pausa en los pasos prácticos. Toca para pausar.",
  },
  en: {
    yourTurn: "Your turn",
    continue: "Done, continue",
    ask: "Ask the teacher",
    copy: "Copy",
    copied: "Copied",
    off: "Don't pause in lessons",
    label: "Pause at hands-on steps",
    switchOn: (count: number) => `Pauses at ${count} hands-on ${count === 1 ? "step" : "steps"}. Tap to stop pausing.`,
    switchOff: "Doesn't pause at hands-on steps. Tap to pause.",
  },
};

/**
 * Follows the playhead and stops at each step: the player calls `onTime` on every time update. A stop already
 * continued doesn't stop again unless the learner goes back before it.
 */
export function useLessonStops(stops: PlayerStop[], media: () => HTMLMediaElement | null) {
  const [on, setOn] = useState(true);
  const [active, setActive] = useState<PlayerStop | null>(null);
  const done = useRef(new Set<string>());
  const last = useRef(0);

  useEffect(() => {
    const read = () => setOn(readStopsOn());
    const first = setTimeout(read, 0);
    const stop = onStopsChange(read);
    return () => {
      clearTimeout(first);
      stop();
    };
  }, []);

  const onTime = useCallback(
    (now: number) => {
      const before = last.current;
      last.current = now;
      for (const stop of stops) if (done.current.has(stop.id) && stop.at > now + 1) done.current.delete(stop.id);
      if (!on || active || !stops.length) return;
      const element = media();
      if (!element || element.paused) return;
      const reached = stopCrossed(stops, before, now, done.current);
      if (!reached) return;
      done.current.add(reached.id);
      element.pause();
      setActive(reached);
    },
    [active, media, on, stops],
  );

  const resume = useCallback(() => {
    setActive(null);
    void media()?.play().catch(() => undefined);
  }, [media]);

  const toggle = useCallback(() => {
    writeStopsOn(!on);
    setOn(!on);
    if (on) setActive(null);
  }, [on]);

  return { on, active, onTime, resume, toggle, dismiss: () => setActive(null) };
}

/** What the switch on the player's bar does now: pause at the steps or not, for every lesson. */
export function stopsHint(on: boolean, count: number, language: "es" | "en") {
  return on ? COPY[language].switchOn(count) : COPY[language].switchOff;
}

export const stopsLabel = (language: "es" | "en") => COPY[language].label;

/** The switch's icon: a raised hand, struck through while the player doesn't pause. */
export function StopsIcon({ on, className }: { on: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <Hand className={cn("size-4", on ? "text-signal" : "text-white/50")} aria-hidden="true" />
      {!on && <span className="absolute left-1/2 top-1/2 h-[1.5px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded bg-white/70" aria-hidden="true" />}
    </span>
  );
}

/** The step, shown while the recording waits: what to do, its commands to copy, and the way on. */
export function StopCard({
  stop,
  language,
  onContinue,
  onAsk,
  onTurnOff,
  className,
}: {
  stop: PlayerStop;
  language: "es" | "en";
  onContinue: () => void;
  onAsk?: () => void;
  onTurnOff: () => void;
  className?: string;
}) {
  const t = COPY[language];
  const [copied, setCopied] = useState<number | null>(null);
  const title = language === "es" ? stop.titleEs : stop.titleEn;
  const step = language === "es" ? stop.stepEs : stop.stepEn;
  const copy = async (command: string, index: number) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(index);
      setTimeout(() => setCopied((current) => (current === index ? null : current)), 1500);
    } catch {
      // The clipboard refused: the command stays on screen to select by hand.
    }
  };
  return (
    <div role="alertdialog" aria-labelledby={`stop-${stop.id}`} className={cn("rounded-xl border border-signal/40 bg-[#141c2b] p-4 text-white shadow-lg", className)}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-signal">
        <Hand className="size-3.5" aria-hidden="true" />
        {t.yourTurn}
      </p>
      <p id={`stop-${stop.id}`} className="mt-1 text-base font-semibold">
        {title}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-white/80">{step}</p>
      {stop.commands.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {stop.commands.map((command, index) => (
            <li key={index} className="flex items-start gap-2 rounded-lg bg-black/40 px-3 py-2">
              <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-white/90">{command}</code>
              <button
                type="button"
                onClick={() => void copy(command, index)}
                aria-label={`${t.copy}: ${command}`}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
              >
                {copied === index ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                {copied === index ? t.copied : t.copy}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onContinue}
          autoFocus
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-signal px-4 text-sm font-semibold text-[#121826] hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40"
        >
          <Play className="size-3.5" fill="currentColor" aria-hidden="true" />
          {t.continue}
        </button>
        {onAsk && (
          <button
            type="button"
            onClick={onAsk}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
          >
            <MessageCircleQuestion className="size-4 text-signal" aria-hidden="true" />
            {t.ask}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onTurnOff} className="rounded-md px-2 py-1 text-xs text-white/60 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70">
          {t.off}
        </button>
      </div>
    </div>
  );
}
