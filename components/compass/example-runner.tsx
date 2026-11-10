"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { runScratch, type ScratchRun } from "@/actions/practice-scratch";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

// A card's example the learner can change and run (docs/compass.md, "The guide"): the code as the card shows it,
// editable, run in the scratchbook's sandbox (the grader: the course's Python 3.12). Until it runs, it shows what the
// card proved it prints; after, what it really printed, the last line's value, or the error and its line.

const COPY = {
  es: { run: "Ejecutar", reset: "Volver al ejemplo", prints: "Imprime", printed: "Imprimió", value: "Valor", nothing: "(nada)", signIn: "Entra para ejecutarlo", edited: "Editado: pruébalo", line: (line: number) => `línea ${line}` },
  en: { run: "Run", reset: "Back to the example", prints: "Prints", printed: "Printed", value: "Value", nothing: "(nothing)", signIn: "Sign in to run it", edited: "Edited: try it", line: (line: number) => `line ${line}` },
};

export function ExampleRunner({ code, output, language, signedIn }: { code: string; output: string; language: "es" | "en"; signedIn: boolean }) {
  const t = COPY[language];
  const [source, setSource] = useState(code);
  const [run, setRun] = useState<ScratchRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const edited = source !== code;
  const rows = Math.max(2, source.split("\n").length);

  const execute = async () => {
    if (!signedIn || running || !source.trim()) return;
    setRunning(true);
    setError(null);
    const result = await runScratch(source, "guide").catch(() => null);
    setRunning(false);
    if (!result?.success) return setError(result?.error ?? (language === "es" ? "No se pudo ejecutar. Inténtalo de nuevo." : "It couldn't run. Try again."));
    setRun(result.run);
  };

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-code-border">
      <div className="relative bg-code">
        <textarea
          ref={area}
          value={source}
          rows={rows}
          spellCheck={false}
          aria-label={language === "es" ? "Código del ejemplo" : "Example code"}
          onChange={(event) => {
            setSource(event.target.value);
            setRun(null);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void execute();
            } else if (event.key === "Tab" && !event.shiftKey) {
              // Four spaces, as Python is written; Shift+Tab still leaves the field.
              event.preventDefault();
              const target = event.currentTarget;
              const { selectionStart, selectionEnd } = target;
              const next = `${source.slice(0, selectionStart)}    ${source.slice(selectionEnd)}`;
              setSource(next);
              requestAnimationFrame(() => target.setSelectionRange(selectionStart + 4, selectionStart + 4));
            }
          }}
          className="block w-full resize-none bg-transparent p-3.5 pr-28 font-mono text-[13px] leading-relaxed text-code-foreground focus-visible:outline-none"
        />
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {edited && (
            <Tip content={t.reset}>
              <button
                type="button"
                onClick={() => {
                  setSource(code);
                  setRun(null);
                }}
                aria-label={t.reset}
                className="flex size-7 items-center justify-center rounded-md text-code-foreground/55 hover:bg-white/10 hover:text-code-foreground"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </Tip>
          )}
          {signedIn ? (
            <Tip content="Ctrl + Enter">
              <button
                type="button"
                onClick={() => void execute()}
                disabled={running}
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-signal px-3 text-xs font-semibold text-[#121826] transition-colors hover:bg-signal/90 disabled:opacity-60"
              >
                {running ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Play className="size-3" fill="currentColor" aria-hidden="true" />}
                {t.run}
              </button>
            </Tip>
          ) : (
            <Link href="/login" className="rounded-full bg-white/10 px-3 py-1 text-xs text-code-foreground hover:bg-white/15">
              {t.signIn}
            </Link>
          )}
        </div>
      </div>
      <div className="space-y-1 border-t border-code-border bg-code-panel px-3.5 py-2.5 font-mono text-[13px] text-code-foreground" aria-live="polite">
        {error ? (
          <p className="font-sans text-xs text-red-300">{error}</p>
        ) : run ? (
          <>
            <div className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.14em] text-code-muted">{t.printed}</span>
              <span className="whitespace-pre-wrap">{run.stdout || (run.value === null && !run.error ? t.nothing : "")}</span>
            </div>
            {run.value !== null && (
              <p className="whitespace-pre-wrap text-signal">
                <span className="select-none text-code-muted">→ </span>
                {run.value}
              </p>
            )}
            {run.error && (
              <p className="rounded-md bg-red-500/10 px-2 py-1 text-red-300">
                <span className="font-semibold">{run.error.type}</span>: {run.error.message}
                {run.error.line ? <span className="text-red-300/70"> · {t.line(run.error.line)}</span> : null}
              </p>
            )}
          </>
        ) : (
          <div className="flex gap-2">
            <span className={cn("mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.14em]", edited ? "text-signal" : "text-code-muted")}>{edited ? t.edited : t.prints}</span>
            {!edited && <span className="whitespace-pre-wrap text-signal">{output || t.nothing}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
