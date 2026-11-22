"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AudioLines } from "lucide-react";
import { getPracticeCoachPass } from "@/actions/lesson-tutor";
import { VoiceTutor, type VoiceTutorCopy } from "@/components/voice/voice-tutor";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tip";
import { markWidget, onOtherWidgetOpened } from "@/components/practice/widgets";

// The practice coach (docs/practice.md, "Widgets"): on a course whose practice has the voice widget on, a button
// beside the practice opens the voice sheet (components/voice/voice-tutor.tsx) to talk the task through out loud. The
// coach knows the task in front of the learner and whether they've answered it (lib/practice/coach.ts): before, it
// lets them rehearse and pushes with questions without giving the answer away; after, it discusses the answer and
// asks follow-ups; with no task, it asks questions on today's skills like a mock interview.

/** Sent by an explain task's Dictate button: two microphones at once would have the coach answer the dictation. */
export const DICTATION_STARTED = "adc:practice-dictation";

const COPY = {
  es: {
    open: "Háblalo",
    title: "Háblalo con el entrenador",
    aboutTask: "Sobre la tarea que tienes delante",
    aboutFree: "Práctica en voz alta",
    listening: "Te escucho. Di tu respuesta, o pregunta.",
    placeholder: "O escribe…",
    teacher: "Entrenador",
    empty: "Di tu respuesta en voz alta y te digo cómo suena y qué preguntaría un entrevistador. O pídeme que te haga preguntas sobre lo de hoy.",
    failed: "El entrenador no pudo responder. Inténtalo de nuevo.",
  },
  en: {
    open: "Talk it through",
    title: "Talk it through with the coach",
    aboutTask: "About the task in front of you",
    aboutFree: "Practice out loud",
    listening: "I'm listening. Say your answer, or ask.",
    placeholder: "Or type…",
    teacher: "Coach",
    empty: "Say your answer out loud and I'll tell you how it sounds and what an interviewer would ask next. Or ask me to quiz you on today's skills.",
    failed: "The coach couldn't answer. Try again.",
  },
};

/** The room the open sheet takes on a computer, so the practice moves left instead of sitting under it. */
const SHEET_ROOM = "28rem";
/** The sheet's height on a phone (VoiceTutor's "practice" placement): the task scrolls above it, like the scratchbook's. */
const PHONE_SHEET = "62svh";

export function PracticeCoach({
  courseSlug,
  sessionId,
  taskId,
  language,
  raised,
}: {
  courseSlug: string;
  sessionId: string | null;
  /** The task on screen; none on the "done for today" screen. */
  taskId: string | null;
  language: "es" | "en";
  /** Another widget's button (the Python scratchbook) already sits in the corner: this one goes above it. */
  raised: boolean;
}) {
  const t = COPY[language];
  const [open, setOpen] = useState(false);

  const getPass = useCallback(() => getPracticeCoachPass(courseSlug), [courseSlug]);
  const turnContext = useCallback(() => ({ sessionId, taskId }), [sessionId, taskId]);
  const scope = useMemo(() => ({ kind: "practice" as const, courseSlug }), [courseSlug]);
  const copy = useMemo<VoiceTutorCopy>(
    () => ({ title: t.title, about: taskId ? t.aboutTask : t.aboutFree, listening: t.listening, placeholder: t.placeholder, teacher: t.teacher, empty: t.empty, failed: t.failed }),
    [t, taskId],
  );

  // The practice makes room for the sheet: beside it on a computer (--coach-width), above it on a phone (--coach-sheet),
  // as it does for the scratchbook (practice-today.tsx). One widget is open at a time (components/practice/widgets.ts).
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--coach-width", open ? SHEET_ROOM : "0px");
    root.setProperty("--coach-sheet", open ? PHONE_SHEET : "0px");
    markWidget("coach", open);
    return () => {
      root.removeProperty("--coach-width");
      root.removeProperty("--coach-sheet");
      markWidget("coach", false);
    };
  }, [open]);

  // Dictating an answer into the task closes the conversation: one microphone at a time. Opening the scratchbook does
  // too: the conversation is kept, and opening the coach again picks it up.
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(DICTATION_STARTED, close);
    const stopListening = onOtherWidgetOpened("coach", close);
    return () => {
      window.removeEventListener(DICTATION_STARTED, close);
      stopListening();
    };
  }, []);

  if (open) return <VoiceTutor language={language} getPass={getPass} turnContext={turnContext} copy={copy} scope={scope} placement="practice" onClose={() => setOpen(false)} />;
  return (
    <Tip content={t.open} side="left">
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-label={t.open}
      // Its place in the corner, above the scratchbook's button when both are there (app/globals.css).
      data-widget="coach"
      data-stack={raised ? "2" : "1"}
      className={cn(
        "practice-widget-button rise-in z-40 inline-flex h-11 items-center gap-2 rounded-full bg-[#0f1520] px-4 text-sm font-medium text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.55)] ring-1 ring-white/15 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
      )}
    >
      <AudioLines className="size-4 text-signal" aria-hidden="true" />
      <span className="practice-widget-label">{t.open}</span>
    </button>
    </Tip>
  );
}
