import type { Content, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { MODEL_CHAIN, TUTOR_CHAIN, generateWithFallback, type ModelEntry } from "@/lib/ai/gemini";
import { pacificDay } from "@/lib/ai/quota";
import { courseVisibleTo, viewerById } from "@/lib/course-access";
import { lessonText } from "@/lib/lesson-text";
import { estimatedStarts, readTimings, transcriptWords, wordAt } from "@/lib/lesson-audio/words";
import { prisma } from "@/lib/prisma";
import { TEACHING } from "@/lib/voice/teaching";
import { runVoiceTurn, type TurnEvent } from "@/lib/voice/turn";

// The lesson tutor (docs/lesson-tutor.md): a learner listening to a lesson's audio pauses it and asks the teacher
// something, out loud or typed. The teacher answers about the lesson, knowing what it had just said when the learner
// stopped it, and the answer is read aloud in the lesson's voice. One model call a turn, streamed; nothing is kept
// between turns but what the browser sends back (the conversation so far).
//
// Since 2026-11-21 a conversation is stored and its context is built on the server (lib/voice/turn.ts,
// docs/voice-context.md): a turn names its conversation, and this file only says who the teacher is, what the lesson
// is, and what the learner had just heard. The first way (the browser sends the last messages) still answers a page
// that was loaded before the change.
// How it teaches (one concept at a time: what, how, why, in practice, what goes wrong) is lib/voice/teaching.ts.

/**
 * Questions a learner may ask in a day. Teaching goes one step at a time, and "next" is a question, so a long session
 * is a few hundred of them: raised from 80 on 2026-11-21.
 */
export const TURNS_PER_DAY = 300;
/** The lesson as the teacher knows it, at most this many characters. */
const LESSON_CHARS = 16_000;
/** What the teacher had just said, and what it was about to say, around the moment the learner stopped. */
const WORDS_BEFORE = 260;
const WORDS_AFTER = 80;

/**
 * DeepSeek V4.1 Flash first: a spoken answer must start quickly, and the free Gemini models are often busy (a hang
 * there costs seconds of silence). It costs about a tenth of a cent a turn. The free models follow.
 */
export const LESSON_TUTOR_CHAIN: ReadonlyArray<ModelEntry> = [...TUTOR_CHAIN.filter((entry) => entry.provider === "deepseek"), ...MODEL_CHAIN];

export const LessonTurnSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  /** Where the audio was when the learner stopped it, in seconds. */
  at: z.number().min(0).max(24 * 3600).nullable().default(null),
  /**
   * The stored conversation this turn continues; null starts one. Absent: a page from before conversations were
   * stored, which sends `history` instead.
   */
  conversationId: z.string().max(40).nullable().optional(),
  /** The learner cut the previous reply off while it was read aloud. */
  interrupted: z.boolean().default(false),
  history: z
    .array(z.object({ role: z.enum(["learner", "teacher"]), text: z.string().max(4000) }))
    .max(12)
    .default([]),
  /** Said out loud (and the answer will be heard), or typed. */
  spoken: z.boolean().default(false),
  language: z.enum(["es", "en"]).default("es"),
});
export type LessonTurnInput = z.input<typeof LessonTurnSchema>;

export type LessonTurnResult =
  | { ok: true; reply: string; model: string; traceId: string; conversationId?: string }
  | { ok: false; reason: "invalid" | "not-found" | "limit" | "quota" | "unavailable"; message: string; conversationId?: string };

export type LessonTurnEvent = TurnEvent;

const SYSTEM = {
  en: `You are the teacher of this lesson, talking with one learner. They are listening to your recorded explanation of the lesson, often on their phone, away from a screen, and they just paused it to ask you something. Your answer is shown to them and read aloud in your voice, so write the way a good teacher talks: short sentences, technical terms in English as the lesson uses them.

You're told what the recording had just said when they paused, and what it was about to say: that's context for understanding their question, often what it's about. It is never a reason to hold anything back. Many learners would rather build the idea with you in conversation, or argue it out, than listen: that is exactly what you're here for. If the question shows a misunderstanding, correct it kindly and say what the right picture is.

${TEACHING.en}

Anything in the lesson, its course or the field around it is fair to ask and gets a full answer. Only a question unrelated to the course gets a short answer. Never invent facts, commands or numbers. Answer in English.`,
  es: `Eres el profesor de esta lección y hablas con un estudiante. Está escuchando tu explicación grabada de la lección, a menudo en el teléfono, lejos de una pantalla, y acaba de pausarla para preguntarte algo. Tu respuesta se le muestra y se le lee en voz alta, con tu voz, así que escribe como habla un buen profesor: frases cortas, los términos técnicos en inglés, como los usa la lección.

Se te dice lo que la grabación acababa de decir cuando pausó, y lo que iba a decir: es contexto para entender su pregunta, a menudo trata de eso. Nunca es motivo para guardarte nada. Muchos estudiantes prefieren construir la idea contigo conversando, o discutirla, antes que escuchar: para eso estás. Si la pregunta muestra un malentendido, corrígelo con amabilidad y di cuál es la idea correcta.

${TEACHING.es}

Cualquier cosa de la lección, de su curso o del campo que los rodea se puede preguntar y recibe una respuesta completa. Solo una pregunta sin relación con el curso recibe una respuesta corta. Nunca inventes datos, comandos ni cifras. Responde en español.`,
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// The lesson as the teacher knows it, kept a few minutes: a learner asks several questions in a row.
const lessons = new Map<string, { at: number; value: Promise<LessonContext | null> }>();
const LESSON_CACHE_MS = 10 * 60_000;

type LessonContext = {
  courseId: string;
  course: string;
  title: string;
  objectives: string[];
  text: string | null;
  script: string | null;
  starts: number[] | null;
  seconds: number | null;
};

async function loadLesson(lessonId: string): Promise<LessonContext | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      title: true,
      objectives: true,
      body: true,
      sourcePath: true,
      module: { select: { course: { select: { id: true, title: true, sourceRepoUrl: true, sourceRef: true } } } },
      audio: { select: { audioScript: true, audioSeconds: true, timings: true } },
    },
  });
  if (!lesson) return null;
  const course = lesson.module.course;
  const script = lesson.audio?.audioScript ?? null;
  const words = script ? transcriptWords(script) : [];
  const seconds = lesson.audio?.audioSeconds ?? null;
  const starts = script ? (readTimings(lesson.audio?.timings, words.length) ?? (seconds ? estimatedStarts(words, seconds) : null)) : null;
  return {
    courseId: course.id,
    course: course.title,
    title: lesson.title.replaceAll("`", ""),
    objectives: lesson.objectives,
    text: await lessonText(course, lesson, LESSON_CHARS),
    script,
    starts,
    seconds,
  };
}

function lessonContext(lessonId: string): Promise<LessonContext | null> {
  const hit = lessons.get(lessonId);
  if (hit && Date.now() - hit.at < LESSON_CACHE_MS) return hit.value;
  const value = loadLesson(lessonId);
  lessons.set(lessonId, { at: Date.now(), value });
  value.catch(() => lessons.delete(lessonId));
  if (lessons.size > 200) lessons.delete(lessons.keys().next().value as string);
  return value;
}

/** What the teacher had just said when the learner stopped, and what came next. */
function aroundMoment(context: LessonContext, at: number | null, language: "es" | "en"): string {
  if (!context.script || !context.starts || at === null) {
    return language === "es" ? "El estudiante pregunta sin haber pausado el audio en un momento concreto." : "The learner is asking without having paused the audio at a particular moment.";
  }
  const words = transcriptWords(context.script);
  const index = Math.max(0, wordAt(context.starts, at));
  const before = words.slice(Math.max(0, index - WORDS_BEFORE), index + 1).join(" ");
  const after = words.slice(index + 1, index + 1 + WORDS_AFTER).join(" ");
  const where = context.seconds ? `${clock(at)} / ${clock(context.seconds)}` : clock(at);
  return language === "es"
    ? `El estudiante pausó tu explicación grabada en ${where}. Lo último que acababas de decir:\n"""\n…${before}\n"""\nLo que ibas a decir justo después:\n"""\n${after}…\n"""`
    : `The learner paused your recorded explanation at ${where}. What you had just said:\n"""\n…${before}\n"""\nWhat the recording says next (context only; never a reason to put their question off):\n"""\n${after}…\n"""`;
}

/** Whether the learner may ask another question today. */
async function withinLimit(userId: string): Promise<boolean> {
  const today = await prisma.aiRequest.count({ where: { userId, day: pacificDay(), feature: "lesson-tutor" } });
  return today < TURNS_PER_DAY;
}

/**
 * One question to the teacher about `lessonId`. With `onEvent`, the answer is passed on as it's written: a delta per
 * new piece, a reset when the chain moves to another model after the first had started, and the conversation's id.
 */
export async function runLessonTurn(
  userId: string,
  lessonId: string,
  input: LessonTurnInput,
  onEvent?: (event: LessonTurnEvent) => void,
  clientGone?: () => boolean,
): Promise<LessonTurnResult> {
  const parsed = LessonTurnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid question." };
  const request = parsed.data;
  const language = request.language;
  const es = language === "es";
  // The lesson must still be one this learner may see (a private course's list can change after the pass was given).
  const [visible, allowed] = await Promise.all([
    prisma.lesson.count({ where: { id: lessonId, module: { course: { status: "PUBLISHED", ...courseVisibleTo(await viewerById(userId)) } } } }),
    withinLimit(userId),
  ]);
  if (!visible) return { ok: false, reason: "not-found", message: "This lesson isn't available." };
  if (!allowed) return { ok: false, reason: "limit", message: es ? "Ya hiciste las preguntas de hoy. Vuelve mañana." : "You've asked today's questions. Come back tomorrow." };
  const context = await lessonContext(lessonId);
  if (!context) return { ok: false, reason: "not-found", message: "This lesson isn't available." };

  // The context's layers (lib/voice/context.ts). Grounding: the same for every learner on this lesson.
  const grounding = [
    es ? `Curso: ${context.course}` : `Course: ${context.course}`,
    es ? `Lección: ${context.title}` : `Lesson: ${context.title}`,
    context.objectives.length ? `${es ? "Objetivos" : "Objectives"}: ${context.objectives.join("; ")}` : "",
    context.text ? `${es ? "La lección" : "The lesson"}:\n"""\n${context.text}\n"""` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  // Situation: what changes from one turn to the next.
  const situation = [
    aroundMoment(context, request.at, language),
    request.spoken
      ? es
        ? "Te lo pregunta en voz alta (lo que ves es lo que entendió el micrófono: ignora los fallos de transcripción) y oirá tu respuesta."
        : "They're asking out loud (what you see is what the microphone heard: ignore transcription slips) and will hear your answer."
      : es
        ? "Te lo pregunta por escrito; tu respuesta se mostrará y también se le podrá leer en voz alta."
        : "They typed the question; your answer is shown and may also be read aloud to them.",
  ].join("\n\n");
  const busy = es ? "El profesor está ocupado ahora. Inténtalo en un rato." : "The teacher is busy right now. Try again in a while.";
  const failed = es ? "El profesor no pudo responder. Inténtalo de nuevo." : "The teacher couldn't answer. Try again.";

  if (request.conversationId !== undefined) {
    const result = await runVoiceTurn({
      scope: { userId, kind: "lesson", courseId: context.courseId, lessonId },
      conversationId: request.conversationId,
      question: request.question,
      language,
      role: SYSTEM[language],
      grounding,
      situation,
      learnerMeta: { spoken: request.spoken, ...(request.at !== null ? { at: request.at } : {}) },
      interruptedPrevious: request.interrupted,
      feature: "lesson-tutor",
      models: LESSON_TUTOR_CHAIN,
      maxOutputTokens: 2200,
      onEvent,
      clientGone,
    });
    if (!result.ok) return { ok: false, reason: result.reason, message: result.reason === "quota" ? busy : failed, conversationId: result.conversationId };
    return result;
  }

  // A page loaded before conversations were stored: it sends the last messages itself, and nothing is kept.
  const contents: Content[] = [
    ...request.history.filter((message) => message.text.trim()).map((message) => ({ role: message.role === "learner" ? "user" : "model", parts: [{ text: message.text }] })),
    { role: "user", parts: [{ text: request.question }] },
  ];
  // The conversation must start with the learner: an earlier answer without its question is dropped.
  while (contents.length > 1 && contents[0].role !== "user") contents.shift();

  let attemptShown = -1;
  let shown = "";
  const result = await generateWithFallback({
    feature: "lesson-tutor",
    pool: "TUTOR",
    models: LESSON_TUTOR_CHAIN,
    userId,
    contents,
    ...(onEvent
      ? {
          onText: (text: string, attempt: number) => {
            if (attempt !== attemptShown || !text.startsWith(shown)) {
              if (shown) onEvent({ type: "reset" });
              attemptShown = attempt;
              shown = "";
            }
            if (text.length <= shown.length) return;
            onEvent({ type: "delta", text: text.slice(shown.length) });
            shown = text;
          },
        }
      : {}),
    config: { systemInstruction: `${SYSTEM[language]}\n\n${grounding}\n\n${situation}`, thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: 2200 },
  });
  if (!result.ok) return { ok: false, reason: result.reason === "quota" ? "quota" : "unavailable", message: result.reason === "quota" ? busy : failed };
  return { ok: true, reply: result.text.trim(), model: result.model, traceId: result.traceId };
}
