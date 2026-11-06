"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Editor } from "@monaco-editor/react";
import { ArrowLeft, ArrowRight, Check, Flame, Layers, Lightbulb, Map as MapIcon, Play, RotateCcw, ScanSearch, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  askPracticeHint,
  getPracticeToday,
  preparePracticeDiscovery,
  runPracticeCode,
  runPracticeDiagnosis,
  submitPracticeAnswer,
  type PracticeTaskView,
  type PracticeToday as Today,
} from "@/actions/practice-learner";
import { PRACTICE_ANSWERED } from "@/components/practice/practice-nav-link";
import { useLanguage } from "@/components/providers/language-provider";
import { Button } from "@/components/ui/button";
import { DotLoader } from "@/components/ui/dot-loader";
import { defineAcademiaTheme } from "@/lib/monaco-theme";
import type { DiscoveryNote } from "@/lib/practice/discovery";
import type { Feedback } from "@/lib/practice/learner";
import { cn } from "@/lib/utils";

// Today's practice (docs/practice.md, "A session"): the day's short set, one task at a time. The learner answers
// (picks, types, predicts, or edits code that runs on the grader), sees right away whether it was right and why, and
// moves on; when the set is done, the page says so and offers a few more. When a skill fails twice in a row, the page
// asks for a diagnosis in the background and adds the check questions it brings to the end of the set
// (docs/practice.md, "Missing prerequisites").

const COPY = {
  es: {
    eyebrow: "Práctica de hoy",
    back: "Volver al curso",
    loading: "Preparando tu práctica…",
    notReady: "La práctica de este curso aún no está lista. Vuelve pronto.",
    nothing: "No hay nada que practicar todavía. Completa una lección y sus habilidades aparecerán aquí.",
    progress: (done: number, total: number) => `${done} de ${total}`,
    newSkill: "Nueva",
    stage: { recognise: "Reconocer", recall: "Recordar", produce: "Producir", apply: "Aplicar", example: "Ejemplo", complete: "Completar", write: "Escribir", transfer: "Transferir" } as Record<string, string>,
    form: { choice: "Elige una", fill: "Completa", predict: "¿Qué imprime?", code: "Escribe el código", debug: "Corrige el error" } as Record<string, string>,
    check: "Comprobar",
    run: "Ejecutar las pruebas",
    checking: "Comprobando…",
    running: "Ejecutando…",
    reset: "Volver al código inicial",
    runAgain: "Ejecutar de nuevo",
    giveUp: "Rendirme y ver la explicación",
    fixAndRun: "Corrige el código y vuelve a ejecutar. Cuenta como acierto cuando pasen todas las pruebas.",
    fillPlaceholder: "Tu respuesta",
    predictPlaceholder: "Escribe exactamente lo que imprime",
    right: "¡Correcto!",
    wrong: "No del todo",
    partly: (passed: number, total: number) => `${passed} de ${total} pruebas pasan`,
    answerWas: "La respuesta",
    accepted: "Respuestas válidas",
    itPrints: "Imprime",
    output: "Salida",
    why: "Por qué",
    next: "Siguiente",
    finish: "Terminar",
    doneTitle: "Listo por hoy",
    doneBody: (right: number, total: number) => `Acertaste ${right} de ${total}. Lo que fallaste volverá antes; lo que dominas, más tarde.`,
    more: "Unos cuantos más",
    noMore: "No hay más por hoy. ¡Buen trabajo!",
    error: "No pudimos cargar tu práctica. Inténtalo de nuevo.",
    streak: (days: number) => (days === 1 ? "1 día seguido" : `${days} días seguidos`),
    noStreak: "Empieza tu racha hoy",
    map: "Ver mi mapa",
    probe: "Comprobación",
    found: "Base",
    probeHint: "Una comprobación rápida: nos dice si te falta algo de base. No cuenta para tu progreso.",
    searching: "Este tema te está costando. Estamos viendo si te falta algo de base…",
    checksAdded: (count: number) => (count === 1 ? "Añadimos una pregunta de comprobación al final de tu práctica." : `Añadimos ${count} preguntas de comprobación al final de tu práctica.`),
    foundAdded: (count: number) => (count === 1 ? "Añadimos una tarea de base al final de tu práctica." : `Añadimos ${count} tareas de base al final de tu práctica.`),
    confirmed: (skill: string, forSkill: string) => `Encontramos algo de base que repasar: «${skill}». Lo practicarás antes de volver a «${forSkill}».`,
    refuted: (skill: string) => `«${skill}» lo dominas: no era eso lo que faltaba.`,
    previous: "Anterior",
    steps: "Tareas de hoy",
    step: (number: number, state: string) => `Tarea ${number}: ${state}`,
    stepState: { right: "correcta", wrong: "por mejorar", current: "la actual", later: "más adelante" } as Record<string, string>,
    hint: "Pista",
    hintLoading: "Pensando una pista…",
    hintNumber: (number: number) => `Pista ${number}`,
    noMoreHints: "No quedan más pistas para esta tarea",
    hintsUsed: (count: number) => (count === 1 ? "Usaste 1 pista: un acierto con pista cuenta un poco menos." : `Usaste ${count} pistas: un acierto con pistas cuenta un poco menos.`),
  },
  en: {
    eyebrow: "Today's practice",
    back: "Back to the course",
    loading: "Getting your practice ready…",
    notReady: "Practice for this course isn't ready yet. Check back soon.",
    nothing: "Nothing to practise yet. Complete a lesson and its skills will show up here.",
    progress: (done: number, total: number) => `${done} of ${total}`,
    newSkill: "New",
    stage: { recognise: "Recognise", recall: "Recall", produce: "Produce", apply: "Apply", example: "Example", complete: "Complete", write: "Write", transfer: "Transfer" } as Record<string, string>,
    form: { choice: "Pick one", fill: "Fill the blank", predict: "What does it print?", code: "Write the code", debug: "Fix the bug" } as Record<string, string>,
    check: "Check",
    run: "Run the tests",
    checking: "Checking…",
    running: "Running…",
    reset: "Back to the starter code",
    runAgain: "Run again",
    giveUp: "Give up and see the explanation",
    fixAndRun: "Fix the code and run again. It counts as right once every test passes.",
    fillPlaceholder: "Your answer",
    predictPlaceholder: "Type exactly what it prints",
    right: "Right!",
    wrong: "Not quite",
    partly: (passed: number, total: number) => `${passed} of ${total} tests pass`,
    answerWas: "The answer",
    accepted: "Accepted answers",
    itPrints: "It prints",
    output: "Output",
    why: "Why",
    next: "Next",
    finish: "Finish",
    doneTitle: "Done for today",
    doneBody: (right: number, total: number) => `You got ${right} of ${total} right. What you missed comes back sooner; what you know, later.`,
    more: "A few more",
    noMore: "Nothing more for today. Well done!",
    error: "We couldn't load your practice. Try again.",
    streak: (days: number) => (days === 1 ? "1 day in a row" : `${days} days in a row`),
    noStreak: "Start your streak today",
    map: "See my map",
    probe: "Check",
    found: "Groundwork",
    probeHint: "A quick check: it tells us whether something underneath is missing. It doesn't count towards your progress.",
    searching: "This one is giving you trouble. We're looking at whether something underneath is missing…",
    checksAdded: (count: number) => (count === 1 ? "We added a check question at the end of today's practice." : `We added ${count} check questions at the end of today's practice.`),
    foundAdded: (count: number) => (count === 1 ? "We added a groundwork task at the end of today's practice." : `We added ${count} groundwork tasks at the end of today's practice.`),
    confirmed: (skill: string, forSkill: string) => `Found something underneath to go over: “${skill}”. You'll practise it before going back to “${forSkill}”.`,
    refuted: (skill: string) => `You know “${skill}”: that wasn't what was missing.`,
    previous: "Previous",
    steps: "Today's tasks",
    step: (number: number, state: string) => `Task ${number}: ${state}`,
    stepState: { right: "right", wrong: "to improve", current: "the current one", later: "later" } as Record<string, string>,
    hint: "Hint",
    hintLoading: "Thinking of a hint…",
    hintNumber: (number: number) => `Hint ${number}`,
    noMoreHints: "No hints left for this task",
    hintsUsed: (count: number) => (count === 1 ? "You used 1 hint: a right answer with a hint counts a little less." : `You used ${count} hints: a right answer with hints counts a little less.`),
  },
};

type Copy = (typeof COPY)["es"];
type Answered = NonNullable<PracticeTaskView["answer"]>;
/** What an answer brought besides its feedback: a diagnosis to run, or a hypothesis it settled. */
type AnswerExtras = { diagnosisId: string | null; discovery: DiscoveryNote | null };
type Notice = { kind: "working" | "info"; text: string } | null;

const MARKDOWN =
  "text-base leading-relaxed [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.88em] [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-code-panel [&_pre]:p-4 [&_pre]:text-sm [&_pre]:text-code-foreground [&_pre_code]:bg-transparent [&_pre_code]:p-0";

export function PracticeToday({ courseSlug, courseTitle }: { courseSlug: string; courseTitle: string }) {
  const { language } = useLanguage();
  const t = COPY[language];
  const [today, setToday] = useState<Today | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not-ready" | "error">("loading");
  const [index, setIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const preparing = useRef(false);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const fetchToday = useCallback((extra: boolean) => getPracticeToday(courseSlug, timeZone, extra).catch(() => null), [courseSlug, timeZone]);
  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchToday>>) => {
      if (!result || !result.success) {
        if (result && !result.success) toast.error(result.error);
        setState("error");
        return;
      }
      if (!result.ready) {
        setState("not-ready");
        return;
      }
      setToday(result);
      // Resume at the first task not answered yet.
      const firstOpen = result.items.findIndex((item) => !item.answer);
      setIndex(firstOpen === -1 ? result.items.length : firstOpen);
      setState("ready");
    },
    [],
  );
  /**
   * Asks the server to add what the learner's hypotheses need to today's set (probes, groundwork), a few calls at most:
   * each may write one missing task. The items come back and join the end of the list.
   */
  const prepare = useCallback(
    async (sessionId: string) => {
      if (preparing.current) return { probes: 0, found: 0 };
      preparing.current = true;
      let probes = 0;
      let found = 0;
      try {
        for (let call = 0; call < 4; call++) {
          const result = await preparePracticeDiscovery(courseSlug, sessionId).catch(() => null);
          if (!result || !result.success) break;
          if (result.items.length) {
            probes += result.items.filter((item) => item.isProbe).length;
            found += result.items.filter((item) => !item.isProbe).length;
            setToday((current) => {
              if (!current || current.sessionId !== sessionId) return current;
              const have = new Set(current.items.map((item) => item.id));
              return { ...current, items: [...current.items, ...result.items.filter((item) => !have.has(item.id))] };
            });
            window.dispatchEvent(new Event(PRACTICE_ANSWERED));
          }
          if (!result.more) break;
        }
      } finally {
        preparing.current = false;
      }
      return { probes, found };
    },
    [courseSlug],
  );
  const added = useCallback(
    ({ probes, found }: { probes: number; found: number }) => {
      if (probes) setNotice({ kind: "info", text: t.checksAdded(probes) });
      else if (found) setNotice({ kind: "info", text: t.foundAdded(found) });
    },
    [t],
  );

  useEffect(() => {
    let current = true;
    void fetchToday(false).then((result) => {
      if (!current) return;
      apply(result);
      // Hypotheses from another day, or tasks written since: their probes and groundwork join today's set.
      if (result?.success && result.ready && result.discoveryWaiting) void prepare(result.sessionId).then((counts) => current && added(counts));
    });
    return () => {
      current = false;
    };
  }, [fetchToday, apply, prepare, added]);

  const hinted = (taskId: string, hint: string) =>
    setToday((current) => current && { ...current, items: current.items.map((item) => (item.id === taskId ? { ...item, hints: [...item.hints, hint] } : item)) });

  const answered = (taskId: string, answer: Answered, extras?: AnswerExtras) => {
    setToday((current) => current && { ...current, items: current.items.map((item) => (item.id === taskId ? { ...item, answer } : item)) });
    window.dispatchEvent(new Event(PRACTICE_ANSWERED));
    if (!today || !extras) return;
    const sessionId = today.sessionId;
    const es = language === "es";
    if (extras.discovery) {
      const { verdict, skill, forSkill } = extras.discovery;
      setNotice({ kind: "info", text: verdict === "confirmed" ? t.confirmed(es ? skill.es : skill.en, es ? forSkill.es : forSkill.en) : t.refuted(es ? skill.es : skill.en) });
      if (verdict === "confirmed") void prepare(sessionId);
    }
    if (extras.diagnosisId) {
      const diagnosisId = extras.diagnosisId;
      setNotice({ kind: "working", text: t.searching });
      void (async () => {
        const result = await runPracticeDiagnosis(courseSlug, diagnosisId).catch(() => null);
        if (!result || !result.success || !result.opened) {
          setNotice(null);
          return;
        }
        const counts = await prepare(sessionId);
        if (counts.probes || counts.found) added(counts);
        else setNotice(null);
      })();
    }
  };

  const more = async () => {
    setLoadingMore(true);
    apply(await fetchToday(true));
    setLoadingMore(false);
  };

  const items = today?.items ?? [];
  const done = items.filter((item) => item.answer).length;
  const finished = state === "ready" && index >= items.length;
  // The learner can go back to any task they've answered, and forward to the first one still open.
  const firstOpen = items.findIndex((item) => !item.answer);
  const reachable = (at: number) => Boolean(items[at]?.answer) || at === firstOpen;
  // The streak was counted when the page loaded; finishing today's set here adds today to it.
  const streak = today ? today.streak.days + (finished && items.length > 0 && !today.extra && !today.streak.doneToday ? 1 : 0) : 0;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 md:py-14">
      <Link href={`/courses/${courseSlug}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> {t.back}
      </Link>
      <header className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{t.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-light tracking-tight text-balance md:text-4xl">{courseTitle}</h1>
          {state === "ready" && today && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className={cn("inline-flex items-center gap-1.5", streak > 0 ? "text-foreground" : "text-muted-foreground")}>
                <Flame className={cn("size-4", streak > 0 && "text-ring")} aria-hidden="true" />
                {streak > 0 ? t.streak(streak) : t.noStreak}
              </span>
              <Link href={`/practice/${courseSlug}/map`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline">
                <MapIcon className="size-4" aria-hidden="true" /> {t.map}
              </Link>
            </div>
          )}
        </div>
        {state === "ready" && items.length > 0 && (
          <div className="w-full sm:w-auto sm:min-w-40 sm:text-right">
            <p className="font-mono text-xs text-muted-foreground">{t.progress(done, items.length)}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(done / items.length) * 100}%` }} />
            </div>
          </div>
        )}
      </header>

      <div className="mt-8">
        {state === "loading" && (
          <div className="flex items-center gap-3 rounded-3xl border border-border bg-card p-8 text-muted-foreground shadow-[var(--shadow-tile)]">
            <DotLoader /> {t.loading}
          </div>
        )}
        {state === "error" && <Notice text={t.error} />}
        {state === "not-ready" && <Notice text={t.notReady} />}
        {notice && (
          <p
            role="status"
            className={cn(
              "mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
              notice.kind === "working" ? "border-border bg-muted/50 text-muted-foreground" : "border-ring/30 bg-ring/10 text-foreground",
            )}
          >
            {notice.kind === "working" ? <DotLoader className="mt-0.5 shrink-0" /> : <ScanSearch className="mt-0.5 size-4 shrink-0 text-ring" aria-hidden="true" />}
            <span className="flex-1">{notice.text}</span>
            {notice.kind === "info" && (
              <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="OK">
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </p>
        )}
        {state === "ready" && items.length === 0 && <Notice text={t.nothing} />}
        {state === "ready" && items.length > 1 && (
          <nav aria-label={t.steps} className="mb-4">
            <ol className="flex flex-wrap gap-1.5">
              {items.map((item, at) => {
                const stepState = item.answer ? (item.answer.feedback.passed ? "right" : "wrong") : at === firstOpen ? "current" : "later";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setIndex(at)}
                      disabled={!reachable(at)}
                      aria-current={at === index ? "step" : undefined}
                      aria-label={t.step(at + 1, t.stepState[stepState])}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full font-mono text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        stepState === "right" && "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300",
                        stepState === "wrong" && "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200",
                        stepState === "current" && "border border-foreground/40 text-foreground hover:bg-muted",
                        stepState === "later" && "border border-dashed border-border text-muted-foreground/60",
                        at === index && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                      )}
                    >
                      {item.isProbe ? <ScanSearch className="size-3.5" aria-hidden="true" /> : at + 1}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        {state === "ready" && today && items.length > 0 && !finished && (
          <TaskCard
            key={items[index].id}
            item={items[index]}
            t={t}
            language={language}
            courseSlug={courseSlug}
            sessionId={today.sessionId}
            last={index === items.length - 1}
            onAnswered={answered}
            onHint={hinted}
            onNext={() => setIndex(index + 1)}
            onPrevious={index > 0 ? () => setIndex(index - 1) : undefined}
          />
        )}
        {finished && items.length > 0 && today && (
          <section className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-tile)]">
            <div className="flex size-12 items-center justify-center rounded-full bg-ring/15 text-ring">
              <Check className="size-6" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">{t.doneTitle}</h2>
            <p className="mt-2 max-w-prose text-muted-foreground">{t.doneBody(today.today.right, today.today.answered)}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => void more()} disabled={loadingMore}>
                {loadingMore ? <DotLoader className="mr-2" /> : <Sparkles className="mr-2 size-4" />} {t.more}
              </Button>
              <Button variant="ghost" asChild>
                <Link href={`/courses/${courseSlug}`}>{t.back}</Link>
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="rounded-3xl border border-border bg-card p-8 text-muted-foreground shadow-[var(--shadow-tile)]">{text}</p>;
}

function TaskCard({
  item,
  t,
  language,
  courseSlug,
  sessionId,
  last,
  onAnswered,
  onHint,
  onNext,
  onPrevious,
}: {
  item: PracticeTaskView;
  t: Copy;
  language: "es" | "en";
  courseSlug: string;
  sessionId: string;
  last: boolean;
  onAnswered: (taskId: string, answer: Answered, extras?: AnswerExtras) => void;
  onHint: (taskId: string, hint: string) => void;
  onNext: () => void;
  onPrevious?: () => void;
}) {
  const es = language === "es";
  // When the task appeared, for the answer's duration (set after render: reading the clock while rendering isn't pure).
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [code, setCode] = useState(item.starter ?? "");
  const [sending, setSending] = useState(false);
  // Code tasks: test runs not recorded yet, and the latest one's results.
  const [runs, setRuns] = useState(0);
  const [trial, setTrial] = useState<Feedback | null>(null);
  const answer = item.answer;
  const options = (es ? item.optionsEs : item.optionsEn) ?? [];
  const isCode = item.form === "code" || item.form === "debug";
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (answer) nextRef.current?.focus();
  }, [answer]);

  const ready = item.form === "choice" ? choice !== null : isCode ? code.trim().length > 0 : text.trim().length > 0;

  // Hints (lib/practice/hints.ts): written for the attempt so far, at most item.maxHints, before answering.
  const [hinting, setHinting] = useState(false);
  const askHint = async () => {
    if (hinting || answer || item.hints.length >= item.maxHints) return;
    setHinting(true);
    const attempt = item.form === "choice" ? (choice === null ? {} : { index: choice }) : isCode ? { code } : { text };
    const result = await askPracticeHint(courseSlug, sessionId, item.id, attempt, language).catch(() => null);
    setHinting(false);
    if (!result || !result.success) {
      toast.error(result && !result.success ? result.error : t.error);
      return;
    }
    onHint(item.id, result.text);
  };
  const previousButton = onPrevious && (
    <Button variant="ghost" onClick={onPrevious} className="mr-auto">
      <ArrowLeft className="mr-2 size-4" /> {t.previous}
    </Button>
  );
  const record = async (given: { index?: number; text?: string; code?: string }, attempts: number) => {
    const result = await submitPracticeAnswer(courseSlug, sessionId, item.id, given, Date.now() - shownAt.current, attempts).catch(() => null);
    if (!result || !result.success) {
      toast.error(result && !result.success ? result.error : t.error);
      return;
    }
    onAnswered(item.id, { given, feedback: result.feedback, explanationEs: result.explanationEs, explanationEn: result.explanationEn }, { diagnosisId: result.diagnosisId, discovery: result.discovery });
  };

  // A code task runs as often as the learner likes; the answer is recorded once every test passes (with the number of
  // runs it took), or when they give up.
  const runCode = async () => {
    if (!ready || sending || answer) return;
    setSending(true);
    const run = await runPracticeCode(courseSlug, sessionId, item.id, code).catch(() => null);
    if (!run || !run.success) {
      setSending(false);
      toast.error(run && !run.success ? run.error : t.error);
      return;
    }
    if (run.feedback.passed) await record({ code }, runs + 1);
    else {
      setRuns(runs + 1);
      setTrial(run.feedback);
    }
    setSending(false);
  };
  const giveUp = async () => {
    if (sending || answer) return;
    setSending(true);
    await record({ code }, Math.max(runs, 1));
    setSending(false);
  };

  const submit = async () => {
    if (isCode) return runCode();
    if (!ready || sending || answer) return;
    setSending(true);
    const given = item.form === "choice" ? { index: choice! } : { text };
    const result = await submitPracticeAnswer(courseSlug, sessionId, item.id, given, Date.now() - shownAt.current).catch(() => null);
    setSending(false);
    if (!result || !result.success) {
      toast.error(result && !result.success ? result.error : t.error);
      return;
    }
    onAnswered(item.id, { given, feedback: result.feedback, explanationEs: result.explanationEs, explanationEn: result.explanationEn }, { diagnosisId: result.diagnosisId, discovery: result.discovery });
  };

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-tile)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 pt-6 md:px-8 md:pt-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t.form[item.form] ?? item.form}</span>
        <span className="text-muted-foreground/50" aria-hidden="true">·</span>
        <span className="text-sm text-muted-foreground">{es ? item.skill.es : item.skill.en}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t.stage[item.stage] ?? item.stage}</span>
        {item.isNew && <span className="rounded-full bg-ring/15 px-2 py-0.5 text-xs font-medium text-ring">{t.newSkill}</span>}
        {item.isProbe && (
          <span className="inline-flex items-center gap-1 rounded-full bg-ring/15 px-2 py-0.5 text-xs font-medium text-ring">
            <ScanSearch className="size-3" aria-hidden="true" /> {t.probe}
          </span>
        )}
        {item.isFound && (
          <span className="inline-flex items-center gap-1 rounded-full bg-ring/15 px-2 py-0.5 text-xs font-medium text-ring">
            <Layers className="size-3" aria-hidden="true" /> {t.found}
          </span>
        )}
      </header>
      {item.isProbe && !answer && <p className="px-6 pt-2 text-sm text-muted-foreground md:px-8">{t.probeHint}</p>}

      <div className={cn("px-6 pt-4 md:px-8", MARKDOWN)}>
        <ReactMarkdown>{es ? item.promptEs : item.promptEn}</ReactMarkdown>
      </div>

      <div className="px-6 pb-6 pt-4 md:px-8 md:pb-8">
        {item.form === "choice" && (
          <div role="radiogroup" className="grid gap-2">
            {options.map((option, index) => {
              const picked = (answer ? answer.given.index : choice) === index;
              const isKey = answer?.feedback.correctIndex === index;
              return (
                <button
                  key={index}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  disabled={Boolean(answer) || sending}
                  onClick={() => setChoice(index)}
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                    !answer && (picked ? "border-foreground/60 bg-muted" : "border-border hover:bg-muted/60"),
                    answer && isKey && "border-emerald-500/60 bg-emerald-500/10",
                    answer && picked && !isKey && "border-destructive/60 bg-destructive/10",
                    answer && !picked && !isKey && "border-border opacity-60",
                  )}
                >
                  <span className="mt-0.5 font-mono text-xs text-muted-foreground">{String.fromCharCode(65 + index)}</span>
                  <span className="flex-1">{option}</span>
                  {answer && isKey && <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                  {answer && picked && !isKey && <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}

        {(item.form === "fill" || item.form === "predict") && (
          <textarea
            value={answer ? (answer.given.text ?? "") : text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (item.form === "fill" || event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={Boolean(answer) || sending}
            rows={item.form === "fill" ? 1 : 4}
            placeholder={item.form === "fill" ? t.fillPlaceholder : t.predictPlaceholder}
            className={cn(
              "w-full resize-y rounded-2xl border border-input bg-background px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              item.form === "predict" && "font-mono text-sm",
            )}
            autoFocus
          />
        )}

        {isCode && (
          <div className="overflow-hidden rounded-2xl border border-code-border">
            <div className="h-72 bg-code-panel md:h-80">
              <Editor
                height="100%"
                defaultLanguage="python"
                beforeMount={defineAcademiaTheme}
                theme="academia-dark"
                loading={<DotLoader className="text-code-foreground" />}
                value={answer ? (answer.given.code ?? "") : code}
                onChange={(value) => setCode(value ?? "")}
                options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: "on", scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", readOnly: Boolean(answer) || sending }}
              />
            </div>
            {!answer && (
              <div className="flex justify-end border-t border-code-border bg-code-panel px-3 py-2">
                <button type="button" onClick={() => setCode(item.starter ?? "")} className="inline-flex items-center gap-1.5 text-xs text-code-foreground/70 hover:text-code-foreground">
                  <RotateCcw className="size-3.5" aria-hidden="true" /> {t.reset}
                </button>
              </div>
            )}
          </div>
        )}

        {!answer && trial && <TrialResults feedback={trial} t={t} />}

        {item.hints.length > 0 && (
          <ol aria-live="polite" className="mt-4 space-y-2">
            {item.hints.map((hint, at) => (
              <li key={at} className="practice-feedback flex gap-3 rounded-2xl border border-ring/25 bg-ring/8 px-4 py-3 text-sm">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-ring" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-muted-foreground">{t.hintNumber(at + 1)}</span>
                  <span className="[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.88em] [&_p]:inline">
                    <ReactMarkdown allowedElements={["p", "code", "em", "strong"]} unwrapDisallowed>
                      {hint}
                    </ReactMarkdown>
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {!answer && (
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {previousButton}
            {item.hints.length < item.maxHints ? (
              <Button variant="outline" onClick={() => void askHint()} disabled={hinting || sending}>
                {hinting ? <DotLoader className="mr-2" /> : <Lightbulb className="mr-2 size-4" />}
                {hinting ? t.hintLoading : t.hint}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">{t.noMoreHints}</span>
            )}
            {isCode && runs > 0 && (
              <Button variant="ghost" onClick={() => void giveUp()} disabled={sending}>
                {t.giveUp}
              </Button>
            )}
            <Button onClick={() => void submit()} disabled={!ready || sending}>
              {sending ? <DotLoader className="mr-2" /> : isCode ? <Play className="mr-2 size-4" /> : <Check className="mr-2 size-4" />}
              {sending ? (isCode ? t.running : t.checking) : isCode ? (runs > 0 ? t.runAgain : t.run) : t.check}
            </Button>
          </div>
        )}

        {answer && <FeedbackPanel answer={answer} form={item.form} t={t} es={es} />}
        {answer && item.hints.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{t.hintsUsed(item.hints.length)}</p>}

        {answer && (
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {previousButton}
            <Button ref={nextRef} onClick={onNext}>
              {last ? t.finish : t.next} <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

/** A code task's latest test run, before the answer is recorded: what failed, and that it can be fixed. */
function TrialResults({ feedback, t }: { feedback: Feedback; t: Copy }) {
  const tests = feedback.tests ?? [];
  const passed = tests.filter((test) => test.passed).length;
  return (
    <div role="status" className="mt-4 rounded-2xl bg-amber-500/10 p-4">
      <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200">
        <X className="size-4" aria-hidden="true" />
        {tests.length ? t.partly(passed, tests.length) : t.wrong}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t.fixAndRun}</p>
      {tests.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {tests.map((test) => (
            <li key={test.name} className="flex gap-2">
              {test.passed ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />}
              <span>
                <code className="font-mono text-xs">{test.name}</code>
                {!test.passed && test.message && <span className="block whitespace-pre-wrap text-muted-foreground">{test.message.split("\n").slice(-3).join("\n")}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {feedback.error && !tests.length && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-code-panel p-3 font-mono text-xs text-code-foreground">{feedback.error.message}</pre>}
      {feedback.stdout && <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-code-panel p-3 font-mono text-xs text-code-foreground">{feedback.stdout}</pre>}
    </div>
  );
}

function FeedbackPanel({ answer, form, t, es }: { answer: Answered; form: string; t: Copy; es: boolean }) {
  const feedback: Feedback = answer.feedback;
  const tests = feedback.tests ?? [];
  const passedTests = tests.filter((test) => test.passed).length;
  return (
    <div
      role="status"
      className={cn("practice-feedback mt-5 rounded-2xl p-5", feedback.passed ? "bg-emerald-500/10" : "bg-amber-500/10")}
    >
      <p className={cn("flex items-center gap-2 text-lg font-semibold", feedback.passed ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-200")}>
        {feedback.passed ? <Check className="size-5" aria-hidden="true" /> : <X className="size-5" aria-hidden="true" />}
        {feedback.passed ? t.right : tests.length ? t.partly(passedTests, tests.length) : t.wrong}
      </p>

      {!feedback.passed && form === "fill" && feedback.accepted && (
        <p className="mt-3 text-sm">
          {t.accepted}: {feedback.accepted.map((value) => <code key={value} className="mr-2 rounded bg-background px-1.5 py-0.5 font-mono">{value}</code>)}
        </p>
      )}
      {!feedback.passed && form === "predict" && feedback.expectedOutput !== undefined && (
        <div className="mt-3">
          <p className="text-sm font-medium">{t.itPrints}</p>
          <pre className="mt-1 overflow-x-auto rounded-xl bg-code-panel p-3 font-mono text-sm text-code-foreground">{feedback.expectedOutput}</pre>
        </div>
      )}
      {tests.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {tests.map((test) => (
            <li key={test.name} className="flex gap-2">
              {test.passed ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />}
              <span>
                <code className="font-mono text-xs">{test.name}</code>
                {!test.passed && test.message && <span className="block whitespace-pre-wrap text-muted-foreground">{test.message}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {feedback.error && !tests.length && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-code-panel p-3 font-mono text-xs text-code-foreground">{feedback.error.message}</pre>}
      {feedback.stdout && (form === "code" || form === "debug") && (
        <div className="mt-3">
          <p className="text-sm font-medium">{t.output}</p>
          <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-code-panel p-3 font-mono text-xs text-code-foreground">{feedback.stdout}</pre>
        </div>
      )}

      <div className={cn("mt-4 border-t border-foreground/10 pt-4", MARKDOWN, "text-sm")}>
        <p className="font-medium">{t.why}</p>
        <ReactMarkdown>{es ? answer.explanationEs : answer.explanationEn}</ReactMarkdown>
      </div>
    </div>
  );
}
