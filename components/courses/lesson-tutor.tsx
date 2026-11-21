"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { getLessonTutorPass } from "@/actions/lesson-tutor";
import { clock } from "@/components/courses/video-player/player-state";
import { VoiceTutor, type VoiceTutorCopy } from "@/components/voice/voice-tutor";

// The lesson tutor (docs/lesson-tutor.md): while listening to a lesson, the learner taps "Ask" and talks to the
// teacher about what they just heard. The lesson pauses; the voice sheet (components/voice/voice-tutor.tsx) listens,
// sends each question to the lab's learning service with the moment the lesson was paused at, and reads the answer
// aloud in the lesson's own voice; then it listens again, until they go back to the lesson, which picks up a moment
// before where it stopped.

const COPY = {
  es: {
    title: "Pregúntale al profesor",
    about: (at: string) => `Sobre lo que escuchabas en ${at}`,
    aboutLesson: "Sobre esta lección",
    listening: "Te escucho. Pregunta lo que quieras.",
    placeholder: "O escribe tu pregunta…",
    resume: "Volver a la lección",
    teacher: "Profesor",
    empty: "Pregunta por algo que no te quedó claro, pide un ejemplo o un caso real, o que te lo explique de otra forma.",
    failed: "No se pudo responder. Inténtalo de nuevo.",
  },
  en: {
    title: "Ask the teacher",
    about: (at: string) => `About what you were hearing at ${at}`,
    aboutLesson: "About this lesson",
    listening: "I'm listening. Ask anything.",
    placeholder: "Or type your question…",
    resume: "Back to the lesson",
    teacher: "Teacher",
    empty: "Ask about something that wasn't clear, for an example or a real scenario, or to hear it explained another way.",
    failed: "The teacher couldn't answer. Try again.",
  },
};

type Props = {
  lessonId: string;
  language: "es" | "en";
  /** The lesson's audio: paused while the learner asks. */
  audioRef: RefObject<HTMLAudioElement | null>;
  /** Where the lesson is (the player's position, the saved one before it has loaded), in seconds. */
  at: number;
  /** Closed; with a moment to play the lesson from, when the learner went back to it. */
  onClose: (resumeAt: number | null) => void;
};

export function LessonTutor({ lessonId, language, audioRef, at: startAt, onClose }: Props) {
  const t = COPY[language];
  // Where the lesson was when the learner asked: every question in this conversation is about that moment.
  const [at] = useState<number | null>(() => (startAt > 1 ? startAt : null));
  // The lesson pauses while they talk.
  useEffect(() => {
    audioRef.current?.pause();
  }, [audioRef]);

  const getPass = useCallback(() => getLessonTutorPass(lessonId), [lessonId]);
  const turnContext = useCallback(() => ({ at }), [at]);
  const copy = useMemo<VoiceTutorCopy>(() => ({ ...t, about: at !== null ? t.about(clock(at)) : t.aboutLesson }), [t, at]);

  return (
    <VoiceTutor
      language={language}
      getPass={getPass}
      turnContext={turnContext}
      copy={copy}
      // Back to the lesson: a moment before where it stopped, to pick the thread up again.
      onClose={(resume) => onClose(resume ? Math.max(0, (at ?? 0) - 3) : null)}
    />
  );
}
