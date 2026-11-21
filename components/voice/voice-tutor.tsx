"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Mic, MicOff, Play, Volume2, VolumeX, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { DEFAULT_SPEAK_SPEED, SPEAK_SPEEDS } from "@/lib/voice/speed";
import { Tip } from "@/components/ui/tip";
import { Orb, type OrbState } from "@/lib/voice/orb";
import { pieces, SoundBlocked, Speaker, speakable, speechCut, VoiceStream, type ListenGrant } from "@/lib/voice/browser";

// The voice sheet: a hands-free conversation with an AI, out loud. The orb listens (Deepgram Flux, which knows when the
// learner has finished); what they said goes to the lab's learning service; the reply is shown as it's written and read
// aloud as it comes; then the orb listens again, until the sheet is closed. Typing works too, for a noisy street or a
// quiet office. Two things open it: the lesson tutor (components/courses/lesson-tutor.tsx, docs/lesson-tutor.md) and
// the practice coach (components/practice/practice-coach.tsx, docs/practice.md "Widgets"). Each brings its own pass
// (which decides who answers), what a turn carries besides the words, and its own words on the sheet.

const COPY = {
  es: {
    connecting: "Conectando…",
    thinking: "Pensando…",
    speaking: "Hablando. Toca el orbe para interrumpir.",
    idle: "Micrófono apagado.",
    interrupt: "Interrumpir y hablar",
    micOn: "Hablar",
    micOff: "Apagar el micrófono",
    speed: (value: string) => `Velocidad de la voz: ${value}. Toca para cambiarla.`,
    soundOn: "Leer las respuestas en voz alta",
    soundOff: "No leer las respuestas en voz alta",
    send: "Enviar",
    close: "Cerrar",
    you: "Tú",
    micBlocked: "El navegador no deja usar el micrófono. Permítelo en los ajustes del sitio, o escribe.",
    micFailed: "No se pudo abrir el micrófono. Puedes escribir.",
    soundBlocked: "El navegador bloqueó el sonido. Toca el orbe para escuchar la próxima respuesta.",
    timeout: "El micrófono se apagó tras un rato. Tócalo para seguir hablando.",
    codeOmitted: "código omitido",
  },
  en: {
    connecting: "Connecting…",
    thinking: "Thinking…",
    speaking: "Speaking. Tap the orb to interrupt.",
    idle: "Microphone off.",
    interrupt: "Interrupt and talk",
    micOn: "Talk",
    micOff: "Turn the microphone off",
    speed: (value: string) => `Voice speed: ${value}. Tap to change it.`,
    soundOn: "Read answers aloud",
    soundOff: "Don't read answers aloud",
    send: "Send",
    close: "Close",
    you: "You",
    micBlocked: "The browser won't let the page use the microphone. Allow it in the site's settings, or type.",
    micFailed: "The microphone couldn't start. You can type.",
    soundBlocked: "The browser blocked the sound. Tap the orb to hear the next answer.",
    timeout: "The microphone turned off after a while. Tap it to keep talking.",
    codeOmitted: "code omitted",
  },
};

type Message = { role: "learner" | "teacher"; text: string; pending?: boolean; failed?: boolean };
type Phase = OrbState | "idle";

// Whether answers are read aloud, per browser.
const SOUND_KEY = "adc.lessonTutor.sound.v1";
const readSound = () => {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
};
const writeSound = (on: boolean) => {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Storage refused: only the preference is lost.
  }
};

// How fast replies are read, per browser.
const SPEED_KEY = "adc.voice.speed.v1";
const readSpeed = (): number => {
  try {
    const stored = Number(window.localStorage.getItem(SPEED_KEY));
    return (SPEAK_SPEEDS as readonly number[]).includes(stored) ? stored : DEFAULT_SPEAK_SPEED;
  } catch {
    return DEFAULT_SPEAK_SPEED;
  }
};
const writeSpeed = (speed: number) => {
  try {
    window.localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Storage refused: only the preference is lost.
  }
};

/** A reply as shown: prose, with commands and file names as code and a configuration in a block (it isn't read aloud). */
const REPLY =
  "space-y-2 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-signal [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-relaxed [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-white/90 [&_strong]:font-semibold [&_strong]:text-white";

/** A reading starts with its first sentence; after it, the answer is read a few sentences at a time. */
const PUSH_AT_LEAST = 240;

/** The opener's own words on the sheet, in the learner's language. */
export type VoiceTutorCopy = {
  title: string;
  /** Under the title: what the conversation is about. */
  about: string;
  /** The orb's line while it listens. */
  listening: string;
  /** Before the first message: what to talk about. */
  empty: string;
  placeholder: string;
  /** Who answers, for screen readers ("Teacher", "Coach"). */
  teacher: string;
  failed: string;
  /** The button that closes the sheet and goes back to what was paused; none when nothing was. */
  resume?: string;
};

export type VoiceTutorPass = { ok: true; url: string; pass: string; expiresAt: number } | { ok: false; message: string };

type Props = {
  language: "es" | "en";
  /** A pass for the learning service: it says who the learner is and who answers them. */
  getPass: () => Promise<VoiceTutorPass>;
  /** What a turn carries besides the words (the lesson's moment, the practice task), read when the turn is sent. */
  turnContext: () => Record<string, unknown>;
  copy: VoiceTutorCopy;
  /** Closed; `resume` when the learner chose to go back to what was paused. */
  onClose: (resume: boolean) => void;
};

export function VoiceTutor({ language, getPass: issuePass, turnContext, copy, onClose }: Props) {
  const t = useMemo(() => ({ ...COPY[language], ...copy }), [language, copy]);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [heard, setHeard] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sound, setSound] = useState(true);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEAK_SPEED);
  const speedRef = useRef<number>(DEFAULT_SPEAK_SPEED);
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState(true);

  const turnContextRef = useRef(turnContext);
  useEffect(() => {
    turnContextRef.current = turnContext;
  }, [turnContext]);
  const pass = useRef<{ url: string; pass: string; expiresAt: number } | null>(null);
  const stream = useRef<VoiceStream | null>(null);
  const micLevel = useRef(0);
  const micWanted = useRef(true);
  const wantMic = useCallback((on: boolean) => {
    micWanted.current = on;
    setMic(on);
  }, []);
  const soundRef = useRef(true);
  const messagesRef = useRef<Message[]>([]);
  const closed = useRef(false);
  const turn = useRef<AbortController | null>(null);
  const orbBox = useRef<HTMLDivElement>(null);
  const orb = useRef<Orb | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setMessagesBoth = useCallback((update: (list: Message[]) => Message[]) => {
    setMessages((list) => {
      const next = update(list);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const issuePassRef = useRef(issuePass);
  useEffect(() => {
    issuePassRef.current = issuePass;
  }, [issuePass]);
  /** A valid pass, asked for again a minute before it expires. */
  const getPass = useCallback(async () => {
    if (pass.current && pass.current.expiresAt - Date.now() > 60_000) return pass.current;
    const result = await issuePassRef.current();
    if (!result.ok) throw new Error(result.message);
    pass.current = { url: result.url, pass: result.pass, expiresAt: result.expiresAt };
    return pass.current;
  }, []);

  const call = useCallback(
    async (path: string, body: unknown, signal?: AbortSignal) => {
      const { url, pass: token } = await getPass();
      return fetch(`${url}/v1/lesson/${path}`, { method: "POST", headers: { Authorization: `Pass ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    },
    [getPass],
  );
  const callRef = useRef(call);
  useEffect(() => {
    callRef.current = call;
  }, [call]);

  // The replies read aloud, through the learning service.
  const [speaker] = useState(
    () =>
      new Speaker(
        async (text, signal) => {
          const response = await callRef.current("speak", { text, language, speed: speedRef.current }, signal);
          if (!response.ok || !response.body) throw new Error(`speak ${response.status}`);
          return response.body;
        },
        { onStart: () => undefined, onEnd: () => undefined, onSound: () => setPhase("speaking") },
      ),
  );

  /** Listening again, after an answer (or straight away), if the microphone is wanted and open. */
  const listen = useCallback(() => {
    if (closed.current) return;
    if (stream.current && micWanted.current) {
      stream.current.resume();
      setPhase("listening");
    } else {
      setPhase("idle");
    }
  }, []);

  const ask = useCallback(
    async (question: string, spoken: boolean) => {
      const text = question.trim();
      if (!text || closed.current) return;
      stream.current?.pause();
      speaker?.stop();
      turn.current?.abort();
      const controller = new AbortController();
      turn.current = controller;
      setHeard("");
      setNotice(null);
      setBusy(true);
      setPhase("thinking");
      const history = messagesRef.current.filter((message) => !message.failed && !message.pending && message.text.trim()).slice(-10);
      setMessagesBoth((list) => [...list, { role: "learner", text }, { role: "teacher", text: "", pending: true }]);
      const setReply = (reply: string, extra: Partial<Message> = {}) =>
        setMessagesBoth((list) => list.map((message, index) => (index === list.length - 1 ? { ...message, text: reply, ...extra } : message)));

      // The answer read aloud as it's written: the first whole sentence at once, then a few at a time.
      let reading: Promise<void> | null = null;
      let readError: unknown = null;
      let readUpTo = 0;
      let reply = "";
      const readOn = (final: boolean) => {
        if (!soundRef.current || !speaker) return;
        const cut = final ? reply.length : speechCut(reply, readUpTo);
        if (cut <= readUpTo) return;
        if (!final && readUpTo > 0 && cut - readUpTo < PUSH_AT_LEAST) return;
        if (!reading) reading = speaker.begin().catch((error) => void (readError = error));
        for (const piece of pieces(speakable(reply.slice(readUpTo, cut), t.codeOmitted), 1800)) speaker.push(piece);
        readUpTo = cut;
      };

      try {
        const response = await call("turn", { question: text, ...turnContextRef.current(), history, spoken, language }, controller.signal);
        if (!response.ok || !response.body) throw new Error(`turn ${response.status}`);
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        let result = null as { ok: boolean; reply?: string; message?: string } | null;
        for (;;) {
          const { done, value } = await reader.read();
          if (value) buffer += value;
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            if (!line) continue;
            const event = JSON.parse(line) as { type: string; text?: string; result?: typeof result };
            if (event.type === "delta" && event.text) {
              reply += event.text;
              setReply(reply);
              readOn(false);
            } else if (event.type === "reset") {
              // Another model started over: what was shown and read goes.
              reply = "";
              readUpTo = 0;
              speaker?.stop();
              reading = null;
              setReply("");
            } else if (event.type === "done") {
              result = event.result ?? null;
            }
          }
          if (done) break;
        }
        if (!result?.ok) {
          speaker?.stop();
          setReply(result?.message ?? t.failed, { pending: false, failed: true });
          return;
        }
        reply = result.reply ?? reply;
        setReply(reply, { pending: false });
        readOn(true);
        speaker?.close();
        if (reading) await reading;
        if (readError) throw readError;
      } catch (error) {
        if (controller.signal.aborted || closed.current) return;
        if (error instanceof SoundBlocked) {
          setNotice(t.soundBlocked);
          setReply(reply, { pending: false });
        } else {
          speaker?.stop();
          setReply(reply || t.failed, { pending: false, failed: !reply });
        }
      } finally {
        if (turn.current === controller) {
          turn.current = null;
          setBusy(false);
          listen();
        }
      }
    },
    [call, language, listen, setMessagesBoth, speaker, t],
  );

  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  /** The microphone on: a grant from the learning service, then the stream straight to Deepgram. */
  const startMic = useCallback(async () => {
    wantMic(true);
    if (stream.current) return listen();
    setPhase("connecting");
    setNotice(null);
    try {
      const response = await call("listen", { language });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; grant?: ListenGrant; maxMinutes?: number; message?: string } | null;
      if (!response.ok || !data?.grant) throw new Error(data?.message ?? t.micFailed);
      const opened = await VoiceStream.open(data.grant, data.maxMinutes ?? 10, {
        onWords: (words) => setHeard(words),
        onTurn: (words) => void askRef.current(words, true),
        onLevel: (level) => (micLevel.current = level),
        onEnd: (reason) => {
          stream.current = null;
          wantMic(false);
          if (!closed.current) {
            setNotice(reason === "timeout" ? t.timeout : t.micFailed);
            setPhase("idle");
          }
        },
      });
      if (closed.current) return opened.stop();
      stream.current = opened;
      if (turn.current || speaker?.playing) opened.pause();
      else setPhase("listening");
    } catch (error) {
      wantMic(false);
      const blocked = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setNotice(blocked ? t.micBlocked : error instanceof Error && error.message ? error.message : t.micFailed);
      setPhase("idle");
    }
  }, [call, language, listen, speaker, t, wantMic]);

  const stopMic = useCallback(() => {
    wantMic(false);
    stream.current?.stop();
    stream.current = null;
    setHeard("");
    if (!turn.current && !speaker?.playing) setPhase("idle");
  }, [speaker, wantMic]);

  // Opening: the sound is unlocked (this runs from the learner's tap), and the microphone opens.
  useEffect(() => {
    closed.current = false;
    const read = setTimeout(() => {
      const on = readSound();
      soundRef.current = on;
      setSound(on);
      speedRef.current = readSpeed();
      setSpeed(speedRef.current);
    }, 0);
    speaker.unlock();
    // The microphone opens after this render (it sets the sheet's state as it goes).
    const open = setTimeout(() => void startMic(), 0);
    return () => {
      clearTimeout(read);
      clearTimeout(open);
      closed.current = true;
      turn.current?.abort();
      speaker?.stop();
      stream.current?.stop();
      stream.current = null;
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The orb, drawn while the sheet is open.
  useEffect(() => {
    const box = orbBox.current;
    if (!box) return;
    const instance = new Orb(() => (speaker?.playing ? speaker.level : micLevel.current), "voice-orb");
    box.append(instance.node);
    instance.start();
    orb.current = instance;
    return () => {
      instance.stop();
      instance.node.remove();
      orb.current = null;
    };
  }, [speaker]);

  useEffect(() => {
    orb.current?.set(phase === "idle" ? "connecting" : phase);
  }, [phase]);

  // The newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  // Escape closes the sheet.
  const close = useCallback(
    (resume: boolean) => {
      closed.current = true;
      turn.current?.abort();
      speaker?.stop();
      stream.current?.stop();
      stream.current = null;
      onClose(resume);
    },
    [onClose, speaker],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const tapOrb = () => {
    speaker?.unlock();
    if (phase === "speaking" || speaker?.playing) {
      // Cut the teacher off and listen.
      speaker?.stop();
      listen();
      return;
    }
    if (phase === "idle") void startMic();
  };

  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    soundRef.current = on;
    writeSound(on);
    if (!on) speaker?.stop();
  };

  // The next speed in the list; it applies from the next piece read.
  const cycleSpeed = () => {
    const next = SPEAK_SPEEDS[(SPEAK_SPEEDS.indexOf(speed as (typeof SPEAK_SPEEDS)[number]) + 1) % SPEAK_SPEEDS.length];
    setSpeed(next);
    speedRef.current = next;
    writeSpeed(next);
  };
  const speedLabel = `${speed}×`;

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    speaker?.unlock();
    const text = draft;
    setDraft("");
    void ask(text, false);
  };

  const status = notice ?? (phase === "idle" ? t.idle : t[phase]);
  const micOn = phase !== "idle" && mic;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t.title}
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl bg-[#0f1520] text-white shadow-[0_-20px_60px_-12px_rgba(0,0,0,0.65)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[26rem] sm:rounded-3xl rise-in"
    >
      <div className="flex items-start gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t.title}</p>
          <p className="mt-0.5 truncate text-xs text-white/55">{t.about}</p>
        </div>
        <Tip content={t.speed(speedLabel)}>
          <button
            type="button"
            onClick={cycleSpeed}
            aria-label={t.speed(speedLabel)}
            className="flex h-9 min-w-11 items-center justify-center rounded-full px-2 font-mono text-xs tabular-nums text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
          >
            {speedLabel}
          </button>
        </Tip>
        <Tip content={sound ? t.soundOff : t.soundOn}>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={sound}
            aria-label={sound ? t.soundOff : t.soundOn}
            className="flex size-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
          >
            {sound ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
          </button>
        </Tip>
        <Tip content={t.close}>
          <button
            type="button"
            onClick={() => close(false)}
            aria-label={t.close}
            className="flex size-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </Tip>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-3 [scrollbar-color:rgba(255,255,255,0.25)_transparent]" aria-live="polite">
        {messages.length === 0 ? (
          <p className="text-sm leading-relaxed text-white/60">{t.empty}</p>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={cn("mb-3 flex", message.role === "learner" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "text-sm leading-relaxed",
                  message.role === "learner" ? "max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-white/10 px-3.5 py-2 text-white/90" : "min-w-0 max-w-full text-white/85",
                  message.failed && "text-red-300",
                )}
              >
                <span className="sr-only">{message.role === "learner" ? t.you : t.teacher}: </span>
                {message.role === "learner" || message.failed ? (
                  message.text
                ) : (
                  <div className={REPLY}>
                    <ReactMarkdown allowedElements={["p", "code", "pre", "strong", "em", "ol", "ul", "li"]} unwrapDisallowed>
                      {message.text}
                    </ReactMarkdown>
                  </div>
                )}
                {message.pending && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-signal/80 motion-reduce:animate-none" aria-hidden="true" />}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-white/10 px-5 pb-4 pt-4">
        <button
          type="button"
          onClick={tapOrb}
          aria-label={phase === "speaking" ? t.interrupt : phase === "idle" ? t.micOn : status}
          className="relative size-24 rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40"
        >
          <div ref={orbBox} data-state={phase} className="size-full" />
        </button>
        <p className={cn("min-h-[1.25rem] text-center text-xs", notice ? "text-amber-200" : "text-white/60")} role="status">
          {status}
        </p>
        {heard && <p className="line-clamp-3 text-center text-sm text-white/90">{heard}</p>}

        <form onSubmit={send} className="mt-1 flex w-full items-center gap-2">
          <Tip content={micOn ? t.micOff : t.micOn}>
            <button
              type="button"
              onClick={() => (micOn ? stopMic() : void startMic())}
              aria-pressed={micOn}
              aria-label={micOn ? t.micOff : t.micOn}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70",
                micOn ? "bg-signal/15 text-signal hover:bg-signal/25" : "bg-white/10 text-white/80 hover:bg-white/15",
              )}
            >
              {micOn ? <Mic className="size-4" aria-hidden="true" /> : <MicOff className="size-4" aria-hidden="true" />}
            </button>
          </Tip>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t.placeholder}
            maxLength={2000}
            enterKeyHint="send"
            className="h-10 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-sm text-white placeholder:text-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60"
          />
          <Tip content={t.send}>
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              aria-label={t.send}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-signal text-[#121826] transition-opacity disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40"
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
          </Tip>
        </form>

        {t.resume && (
          <button
            type="button"
            onClick={() => close(true)}
            className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-full border border-white/15 text-sm font-medium text-white/90 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
          >
            <Play className="size-3.5" fill="currentColor" aria-hidden="true" />
            {t.resume}
          </button>
        )}
      </div>
    </div>
  );
}
