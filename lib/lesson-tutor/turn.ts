import type { Content, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { MODEL_CHAIN, TUTOR_CHAIN, generateWithFallback, type ModelEntry } from "@/lib/ai/gemini";
import { pacificDay } from "@/lib/ai/quota";
import { courseVisibleTo, viewerById } from "@/lib/course-access";
import { lessonText } from "@/lib/lesson-text";
import { estimatedStarts, readTimings, transcriptWords, wordAt } from "@/lib/lesson-audio/words";
import { prisma } from "@/lib/prisma";

// The lesson tutor (docs/lesson-tutor.md): a learner listening to a lesson's audio pauses it and asks the teacher
// something, out loud or typed. The teacher answers about the lesson, knowing what it had just said when the learner
// stopped it, and the answer is read aloud in the lesson's voice. One model call a turn, streamed; nothing is kept
// between turns but what the browser sends back (the conversation so far).

/** Questions a learner may ask in a day. */
export const TURNS_PER_DAY = 80;
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
  | { ok: true; reply: string; model: string; traceId: string }
  | { ok: false; reason: "invalid" | "not-found" | "limit" | "quota" | "unavailable"; message: string };

export type LessonTurnEvent = { type: "delta"; text: string } | { type: "reset" };

const SYSTEM = {
  en: `You are the teacher of this lesson, talking with one learner. They are listening to your recorded explanation of the lesson, often on their phone, away from a screen, and they just paused it to ask you something.

Your answer is read aloud to them in your voice, so speak; don't write:
- No Markdown at all: no headings, bullet points, numbered lists, bold, tables or code blocks. Say a sequence as "first… then… finally…".
- Code only in words, and only as much as the idea needs ("a function, greet, that takes a name and returns a greeting"). If they need to see code, say it's in the lesson and where.
- Short sentences, the way a good teacher talks. Technical terms in English, as the lesson uses them.

How to teach:
- First the direct answer, in a sentence or two.
- Then why it is so, building on what the lesson had just explained when they paused (you're told what that was): that's usually what they're asking about.
- Then make it concrete: an example, an analogy, or a real scenario from work where it matters (what breaks, what someone does about it, what it looks like when you're the one on call). Real, specific, believable.
- If the question shows a misunderstanding, correct it kindly and say what the right picture is.
- When it helps, end with one short question that checks they've got it or invites them to apply it. Not every time.
- About 100 to 180 words. When they ask you to go deeper, for more examples, or to explain it another way, up to about 350.

Stay with this lesson and its course. A question off the subject gets a short answer and a way back. Never invent facts, commands or numbers; if you aren't sure, say so and say what you'd check. Answer in English.`,
  es: `Eres el profesor de esta lección y hablas con un estudiante. Está escuchando tu explicación grabada de la lección, a menudo en el teléfono, lejos de una pantalla, y acaba de pausarla para preguntarte algo.

Tu respuesta se le lee en voz alta, con tu voz, así que habla; no escribas:
- Nada de Markdown: ni títulos, ni viñetas, ni listas numeradas, ni negritas, ni tablas, ni bloques de código. Una secuencia se dice "primero… luego… al final…".
- El código, solo en palabras y solo lo que la idea necesite ("una función, greet, que recibe un nombre y devuelve un saludo"). Si necesita verlo, dile que está en la lección y dónde.
- Frases cortas, como habla un buen profesor. Los términos técnicos en inglés, como los usa la lección.

Cómo enseñar:
- Primero la respuesta directa, en una o dos frases.
- Luego el porqué, partiendo de lo que la lección acababa de explicar cuando pausó (se te dice qué era): casi siempre es sobre eso que pregunta.
- Luego hazlo concreto: un ejemplo, una analogía o un caso real del trabajo donde importe (qué se rompe, qué hace alguien al respecto, cómo se ve cuando eres tú quien está de guardia). Real, específico, creíble.
- Si la pregunta muestra un malentendido, corrígelo con amabilidad y di cuál es la idea correcta.
- Cuando ayude, termina con una pregunta corta que compruebe que lo entendió o le invite a aplicarlo. No siempre.
- Entre 100 y 180 palabras. Si pide profundizar, más ejemplos u otra explicación, hasta unas 350.

Quédate en esta lección y su curso. Una pregunta fuera del tema recibe una respuesta corta y una vuelta al tema. Nunca inventes datos, comandos ni cifras; si no estás seguro, dilo y di qué comprobarías. Responde en español.`,
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// The lesson as the teacher knows it, kept a few minutes: a learner asks several questions in a row.
const lessons = new Map<string, { at: number; value: Promise<LessonContext | null> }>();
const LESSON_CACHE_MS = 10 * 60_000;

type LessonContext = {
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
      module: { select: { course: { select: { title: true, sourceRepoUrl: true, sourceRef: true } } } },
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
    : `The learner paused your recorded explanation at ${where}. What you had just said:\n"""\n…${before}\n"""\nWhat you were about to say next:\n"""\n${after}…\n"""`;
}

/** Whether the learner may ask another question today. */
async function withinLimit(userId: string): Promise<boolean> {
  const today = await prisma.aiRequest.count({ where: { userId, day: pacificDay(), feature: "lesson-tutor" } });
  return today < TURNS_PER_DAY;
}

/**
 * One question to the teacher about `lessonId`. With `onEvent`, the answer is passed on as it's written: a delta per
 * new piece, a reset when the chain moves to another model after the first had started.
 */
export async function runLessonTurn(userId: string, lessonId: string, input: LessonTurnInput, onEvent?: (event: LessonTurnEvent) => void): Promise<LessonTurnResult> {
  const parsed = LessonTurnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid question." };
  const request = parsed.data;
  // The lesson must still be one this learner may see (a private course's list can change after the pass was given).
  const [visible, allowed] = await Promise.all([
    prisma.lesson.count({ where: { id: lessonId, module: { course: { status: "PUBLISHED", ...courseVisibleTo(await viewerById(userId)) } } } }),
    withinLimit(userId),
  ]);
  if (!visible) return { ok: false, reason: "not-found", message: "This lesson isn't available." };
  if (!allowed) return { ok: false, reason: "limit", message: request.language === "es" ? "Ya hiciste las preguntas de hoy. Vuelve mañana." : "You've asked today's questions. Come back tomorrow." };
  const context = await lessonContext(lessonId);
  if (!context) return { ok: false, reason: "not-found", message: "This lesson isn't available." };

  const language = request.language;
  const lessonBlock = [
    language === "es" ? `Curso: ${context.course}` : `Course: ${context.course}`,
    language === "es" ? `Lección: ${context.title}` : `Lesson: ${context.title}`,
    context.objectives.length ? `${language === "es" ? "Objetivos" : "Objectives"}: ${context.objectives.join("; ")}` : "",
    context.text ? `${language === "es" ? "La lección" : "The lesson"}:\n"""\n${context.text}\n"""` : "",
    aroundMoment(context, request.at, language),
    request.spoken
      ? language === "es"
        ? "Te lo pregunta en voz alta y oirá tu respuesta."
        : "They're asking out loud and will hear your answer."
      : language === "es"
        ? "Te lo pregunta por escrito; tu respuesta se mostrará y también se le podrá leer en voz alta."
        : "They typed the question; your answer is shown and may also be read aloud to them.",
  ]
    .filter(Boolean)
    .join("\n\n");

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
    config: {
      systemInstruction: `${SYSTEM[language]}\n\n${lessonBlock}`,
      thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel },
      maxOutputTokens: 1500,
    },
  });
  if (!result.ok) {
    if (result.reason === "quota") return { ok: false, reason: "quota", message: language === "es" ? "El profesor está ocupado ahora. Inténtalo en un rato." : "The teacher is busy right now. Try again in a while." };
    return { ok: false, reason: "unavailable", message: language === "es" ? "El profesor no pudo responder. Inténtalo de nuevo." : "The teacher couldn't answer. Try again." };
  }
  return { ok: true, reply: result.text.trim(), model: result.model, traceId: result.traceId };
}
