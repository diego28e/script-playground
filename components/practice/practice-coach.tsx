"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AudioLines } from "lucide-react";
import { getPracticeCoachPass } from "@/actions/lesson-tutor";
import { VoiceTutor, type VoiceTutorCopy } from "@/components/voice/voice-tutor";
import { cn } from "@/lib/utils";

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
  const copy = useMemo<VoiceTutorCopy>(
    () => ({ title: t.title, about: taskId ? t.aboutTask : t.aboutFree, listening: t.listening, placeholder: t.placeholder, teacher: t.teacher, empty: t.empty, failed: t.failed }),
    [t, taskId],
  );

  // The practice makes room for the sheet on a computer (practice-today.tsx reads --coach-width).
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--coach-width", open ? SHEET_ROOM : "0px");
    return () => {
      root.removeProperty("--coach-width");
    };
  }, [open]);

  // Dictating an answer into the task closes the conversation: one microphone at a time.
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(DICTATION_STARTED, close);
    return () => window.removeEventListener(DICTATION_STARTED, close);
  }, []);

  if (open) return <VoiceTutor language={language} getPass={getPass} turnContext={turnContext} copy={copy} onClose={() => setOpen(false)} />;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      className={cn(
        "rise-in fixed right-5 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-[#0f1520] px-4 text-sm font-medium text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.55)] ring-1 ring-white/15 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
        raised ? "bottom-[4.75rem]" : "bottom-5",
      )}
    >
      <AudioLines className="size-4 text-signal" aria-hidden="true" />
      {t.open}
    </button>
  );
}
