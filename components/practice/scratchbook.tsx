"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Editor, type OnMount } from "@monaco-editor/react";
import { Eraser, Lightbulb, Loader2, Play, Send, Sparkles, SquareTerminal, X } from "lucide-react";
import { toast } from "sonner";
import { askScratch, runScratch, type ScratchRun } from "@/actions/practice-scratch";
import { getPublishedConcepts } from "@/actions/compass-guide";
import { EVERYWHERE } from "@/lib/compass/everywhere";
import { Tip } from "@/components/ui/tip";
import { DotLoader } from "@/components/ui/dot-loader";
import { defineAcademiaTheme } from "@/lib/monaco-theme";
import { cn } from "@/lib/utils";

// The practice scratchbook (docs/practice.md, "Scratchbook"): Python beside every task, to calculate, try a line or
// prove an idea instead of reaching for a calculator or an IDE. On a computer it docks on the right and the practice
// moves left, so the question stays in view; on a phone it's a sheet over the lower part of the page. The code is
// kept per course in this browser; each run shows what it printed, the last line's value (like a Python prompt) or
// the error and its line, highlighted in the editor; and an AI explains the code and its errors, never the task.

const COPY = {
  es: {
    open: "Scratchbook de Python",
    title: "Scratchbook",
    run: "Ejecutar",
    runKey: "Ctrl + Enter",
    clear: "Limpiar la consola",
    close: "Cerrar el scratchbook",
    tips: [
      "Úsalo como calculadora: la última línea muestra su valor, como en la consola de Python.",
      "Prueba una idea línea por línea antes de responder.",
      "print() muestra valores intermedios.",
      "Si algo falla, pregúntale a la IA por qué: te explica tu código, nunca la respuesta.",
    ],
    tipsLabel: "Consejos",
    empty: "Escribe Python y ejecútalo: aquí verás lo que imprime, el valor de la última línea o el error.",
    starter: "# Tu borrador de Python: calcula, prueba una línea, comprueba una idea.\n# La última línea muestra su valor, como en la consola de Python.\n6000 // 400\n",
    noOutput: "(sin salida)",
    line: (line: number) => `línea ${line}`,
    ask: "Pregunta sobre tu código…",
    send: "Preguntar a la IA",
    explain: "Explica mi código",
    why: "¿Por qué falló?",
    ai: "IA",
    you: "Tú",
    running: "Ejecutando…",
    thinking: "Pensando…",
    error: "No se pudo. Inténtalo de nuevo.",
  },
  en: {
    open: "Python scratchbook",
    title: "Scratchbook",
    run: "Run",
    runKey: "Ctrl + Enter",
    clear: "Clear the console",
    close: "Close the scratchbook",
    tips: [
      "Use it as a calculator: the last line shows its value, like a Python prompt.",
      "Try an idea one line at a time before you answer.",
      "print() shows values along the way.",
      "If something fails, ask the AI why: it explains your code, never the answer.",
    ],
    tipsLabel: "Tips",
    empty: "Write Python and run it: what it prints, the last line's value or the error shows here.",
    starter: "# Your Python scratchpad: calculate, try a line, test an idea.\n# The last line shows its value, like a Python prompt.\n6000 // 400\n",
    noOutput: "(no output)",
    line: (line: number) => `line ${line}`,
    ask: "Ask about your code…",
    send: "Ask the AI",
    explain: "Explain my code",
    why: "Why did it fail?",
    ai: "AI",
    you: "You",
    running: "Running…",
    thinking: "Thinking…",
    error: "That didn't work. Try again.",
  },
};

type NewEntry = { kind: "run"; run: ScratchRun | null } | { kind: "question"; text: string } | { kind: "answer"; text: string | null };
type Entry = NewEntry & { id: number };

const STORE = (course: string) => `adc.scratchbook.${course}`;
const OPEN_KEY = "adc.scratchbook.open";
const WIDTH_KEY = "adc.scratchbook.width";
const WIDTH = { min: 340, max: 720, initial: 460 };

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage refused (a private window): the scratchbook still works for this visit.
  }
}

/** What a run showed, as text for the AI. */
function describe(run: ScratchRun | null): string {
  if (!run) return "";
  return [run.stdout, run.value !== null ? `=> ${run.value}` : "", run.error ? `${run.error.type}: ${run.error.message}${run.error.line ? ` (line ${run.error.line})` : ""}` : ""].filter(Boolean).join("\n");
}

/**
 * Under a run, the Python Compass cards for the constructs in the code (docs/compass.md, "Code lens"), in the order they
 * appear; after an error, the card for the construct on the failing line first. Only constructs with a published card.
 */
function CodeConcepts({ run, cards, language }: { run: ScratchRun; cards: Record<string, { es: string; en: string }>; language: "es" | "en" }) {
  const found = Object.entries(run.concepts ?? {})
    .filter(([key]) => cards[key])
    .sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]));
  if (!found.length) return null;
  const errorLine = run.error?.line ?? null;
  // The most specific construct on the failing line: not one of those on nearly every line.
  const onErrorLine = errorLine ? found.find(([key, lines]) => lines.includes(errorLine) && !EVERYWHERE.has(key))?.[0] : undefined;
  const chip = (key: string, emphasis = false) => (
    <a
      key={key}
      href={`/python/${encodeURIComponent(key)}`}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-sans text-[11px] transition-colors",
        emphasis ? "bg-red-500/15 text-red-200 hover:bg-red-500/25" : "bg-white/[0.06] text-code-foreground/75 hover:bg-white/[0.12] hover:text-code-foreground",
      )}
    >
      {cards[key][language]}
    </a>
  );
  return (
    <div className="space-y-1 pt-1">
      {onErrorLine && (
        <p className="flex flex-wrap items-center gap-1.5 font-sans text-[11px] text-code-foreground/50">
          {language === "es" ? "Sobre este error:" : "About this error:"} {chip(onErrorLine, true)}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-1.5 font-sans text-[11px] text-code-foreground/50">
        {language === "es" ? "En tu código:" : "In your code:"}
        {found.slice(0, 8).map(([key]) => chip(key))}
      </p>
    </div>
  );
}

export function Scratchbook({ courseSlug, taskId, language }: { courseSlug: string; taskId: string | null; language: "es" | "en" }) {
  const t = COPY[language];
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(WIDTH.initial);
  const [code, setCode] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const nextId = useRef(1);
  const consoleRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorations = useRef<string[]>([]);
  const runRef = useRef<() => void>(() => undefined);
  // The Python Compass's published cards, by concept: a run links the constructs in the code to them.
  const [cards, setCards] = useState<Record<string, { es: string; en: string }>>({});
  useEffect(() => {
    if (!open || Object.keys(cards).length) return;
    void getPublishedConcepts()
      .then(setCards)
      .catch(() => undefined);
  }, [open, cards]);

  // What this browser kept: open or not, the width, and this course's code. Read after mount (the server has none).
  useEffect(() => {
    const restore = setTimeout(() => {
      setOpen(readStore(OPEN_KEY) === "1");
      const stored = Number(readStore(WIDTH_KEY));
      if (stored >= WIDTH.min && stored <= WIDTH.max) setWidth(stored);
      setCode(readStore(STORE(courseSlug)) ?? t.starter);
    }, 0);
    return () => clearTimeout(restore);
  }, [courseSlug, t.starter]);
  useEffect(() => {
    const save = setTimeout(() => code && writeStore(STORE(courseSlug), code), 400);
    return () => clearTimeout(save);
  }, [code, courseSlug]);

  // The practice moves left to make room on a computer (practice-today.tsx reads --scratchbook-width).
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--scratchbook-width", open ? `${width}px` : "0px");
    // On a phone the sheet covers the lower part: the page gets room to scroll the task above it.
    root.setProperty("--scratchbook-sheet", open ? "62svh" : "0px");
    return () => {
      root.removeProperty("--scratchbook-width");
      root.removeProperty("--scratchbook-sheet");
    };
  }, [open, width]);

  const toggle = (next: boolean) => {
    setOpen(next);
    writeStore(OPEN_KEY, next ? "1" : "0");
    if (next) setTimeout(() => editorRef.current?.focus(), 50);
  };

  const add = useCallback((entry: NewEntry) => {
    const id = nextId.current++;
    setEntries((list) => [...list, { ...entry, id }]);
    return id;
  }, []);
  const replace = useCallback((id: number, change: { run?: ScratchRun | null; text?: string | null }) => setEntries((list) => list.map((entry) => (entry.id === id ? ({ ...entry, ...change } as Entry) : entry))), []);

  // New output scrolls into view.
  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  const markError = (line: number | null) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    decorations.current = editor.deltaDecorations(
      decorations.current,
      line ? [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "scratch-error-line", glyphMarginClassName: "scratch-error-glyph" } }] : [],
    );
  };

  const run = async () => {
    if (running || !code.trim()) return;
    setRunning(true);
    markError(null);
    const id = add({ kind: "run", run: null });
    const result = await runScratch(code).catch(() => null);
    setRunning(false);
    if (!result?.success) {
      setEntries((list) => list.filter((entry) => entry.id !== id));
      toast.error(result?.error ?? t.error);
      return;
    }
    replace(id, { run: result.run });
    markError(result.run.error?.line ?? null);
  };
  useEffect(() => {
    runRef.current = () => void run();
  });

  const lastRun = [...entries].reverse().find((entry): entry is Extract<Entry, { kind: "run" }> => entry.kind === "run")?.run ?? null;

  const ask = async (text: string) => {
    if (asking) return;
    setAsking(true);
    add({ kind: "question", text });
    const id = add({ kind: "answer", text: null });
    setQuestion("");
    const result = await askScratch({ taskId, code, output: describe(lastRun), question: text, language }).catch(() => null);
    setAsking(false);
    if (!result?.success) {
      replace(id, { text: `_${result?.error ?? t.error}_` });
      return;
    }
    replace(id, { text: result.text });
  };

  // Dragging the panel's left edge resizes it.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: PointerEvent) => setWidth(Math.min(WIDTH.max, Math.max(WIDTH.min, startWidth + (startX - move.clientX))));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setWidth((current) => {
        writeStore(WIDTH_KEY, String(current));
        return current;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!open) {
    return (
      <Tip content={t.open} side="left">
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label={t.open}
          className="rise-in fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-code px-4 text-sm font-medium text-code-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,0.55)] ring-1 ring-code-border transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          <SquareTerminal className="size-4 text-signal" aria-hidden="true" />
          Python
        </button>
      </Tip>
    );
  }

  return (
    <aside
      aria-label={t.open}
      className={cn(
        "rise-in fixed z-40 flex flex-col overflow-hidden border-code-border bg-code text-code-foreground shadow-2xl",
        // A sheet on a phone, a docked panel on a computer.
        "inset-x-0 bottom-0 h-[62svh] rounded-t-2xl border-t lg:inset-x-auto lg:bottom-0 lg:right-0 lg:top-16 lg:h-auto lg:w-[var(--scratchbook-width)] lg:rounded-none lg:border-l lg:border-t-0",
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize"
        onPointerDown={startResize}
        className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-signal/40 lg:block"
      />

      <header className="flex items-center gap-2 border-b border-code-border px-3 py-2">
        <SquareTerminal className="size-4 text-signal" aria-hidden="true" />
        <h2 className="text-sm font-medium">{t.title}</h2>
        <Tip
          content={
            <ul className="max-w-64 list-disc space-y-1 pl-4 text-left">
              {t.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          }
        >
          <button type="button" aria-label={t.tipsLabel} className="flex size-7 items-center justify-center rounded-md text-code-foreground/60 hover:bg-white/10 hover:text-code-foreground">
            <Lightbulb className="size-4" />
          </button>
        </Tip>
        <span className="flex-1" />
        <Tip content={t.runKey}>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || !code.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-signal px-3.5 text-xs font-semibold text-[#121826] transition-colors hover:bg-signal/90 disabled:opacity-60"
          >
            {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" fill="currentColor" aria-hidden="true" />}
            {t.run}
          </button>
        </Tip>
        <Tip content={t.clear}>
          <button type="button" onClick={() => setEntries([])} aria-label={t.clear} className="flex size-8 items-center justify-center rounded-md text-code-foreground/60 hover:bg-white/10 hover:text-code-foreground">
            <Eraser className="size-4" />
          </button>
        </Tip>
        <Tip content={t.close}>
          <button type="button" onClick={() => toggle(false)} aria-label={t.close} className="flex size-8 items-center justify-center rounded-md text-code-foreground/60 hover:bg-white/10 hover:text-code-foreground">
            <X className="size-4" />
          </button>
        </Tip>
      </header>

      {/* The editor and the console share the height. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-[9rem] flex-[1.1] border-b border-code-border">
          <Editor
            height="100%"
            defaultLanguage="python"
            beforeMount={defineAcademiaTheme}
            theme="academia-dark"
            loading={<DotLoader className="text-code-foreground" />}
            value={code}
            onChange={(value) => {
              setCode(value ?? "");
              markError(null);
            }}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              monacoRef.current = monaco;
              // Ctrl/Cmd + Enter runs, from anywhere in the editor.
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
            }}
            options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: "on", glyphMargin: true, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", padding: { top: 10 } }}
          />
        </div>

        <div ref={consoleRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed" aria-live="polite">
          {entries.length === 0 && <p className="font-sans text-xs text-code-foreground/50">{t.empty}</p>}
          <ol className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.id} className="rise-in">
                {entry.kind === "run" &&
                  (entry.run === null ? (
                    <p className="flex items-center gap-2 text-code-foreground/60">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {t.running}
                    </p>
                  ) : (
                    <div className="space-y-1 border-l-2 border-code-border pl-3">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-code-foreground/40">
                        {t.run} · {(entry.run.ms / 1000).toFixed(1)} s
                      </p>
                      {entry.run.stdout && <pre className="whitespace-pre-wrap break-words text-code-foreground">{entry.run.stdout}</pre>}
                      {entry.run.value !== null && (
                        <pre className="whitespace-pre-wrap break-words text-signal">
                          <span className="select-none text-code-foreground/40">→ </span>
                          {entry.run.value}
                        </pre>
                      )}
                      {entry.run.error && (
                        <p className="rounded-md bg-red-500/10 px-2 py-1 text-red-300">
                          <span className="font-semibold">{entry.run.error.type}</span>: {entry.run.error.message}
                          {entry.run.error.line ? <span className="text-red-300/70"> · {t.line(entry.run.error.line)}</span> : null}
                        </p>
                      )}
                      {!entry.run.stdout && entry.run.value === null && !entry.run.error && <p className="text-code-foreground/40">{t.noOutput}</p>}
                      <CodeConcepts run={entry.run} cards={cards} language={language} />
                    </div>
                  ))}
                {entry.kind === "question" && (
                  <p className="font-sans text-xs text-code-foreground/60">
                    <span className="font-medium text-code-foreground/80">{t.you}:</span> {entry.text}
                  </p>
                )}
                {entry.kind === "answer" && (
                  <div className="rounded-xl bg-white/[0.04] p-3 font-sans text-[13px] leading-relaxed ring-1 ring-code-border">
                    <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-signal">
                      <Sparkles className="size-3" aria-hidden="true" /> {t.ai}
                    </p>
                    {entry.text === null ? (
                      <p className="flex items-center gap-2 text-code-foreground/60">
                        <DotLoader className="text-code-foreground" /> {t.thinking}
                      </p>
                    ) : (
                      <div className="[&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/30 [&_pre]:p-2.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
                        <ReactMarkdown>{entry.text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* The AI: quick questions, or the learner's own. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) void ask(question.trim());
        }}
        className="space-y-2 border-t border-code-border p-3"
      >
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={asking || !code.trim()} onClick={() => void ask(t.explain)} className="rounded-full border border-code-border px-2.5 py-1 text-xs text-code-foreground/80 transition-colors hover:border-signal/50 hover:text-code-foreground disabled:opacity-50">
            {t.explain}
          </button>
          {lastRun?.error && (
            <button type="button" disabled={asking} onClick={() => void ask(t.why)} className="rise-in rounded-full border border-red-400/40 px-2.5 py-1 text-xs text-red-200 transition-colors hover:border-red-300 disabled:opacity-50">
              {t.why}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t.ask}
            aria-label={t.ask}
            maxLength={2000}
            className="h-9 min-w-0 flex-1 rounded-lg border border-code-border bg-black/20 px-3 text-sm text-code-foreground placeholder:text-code-foreground/40 focus:border-signal/60 focus:outline-none"
          />
          <Tip content={t.send}>
            <button type="submit" disabled={asking || !question.trim()} aria-label={t.send} className="flex size-9 items-center justify-center rounded-lg bg-white/10 text-code-foreground transition-colors hover:bg-white/15 disabled:opacity-40">
              {asking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            </button>
          </Tip>
        </div>
      </form>
    </aside>
  );
}
