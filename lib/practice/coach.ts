import type { Content, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { generateWithFallback } from "@/lib/ai/gemini";
import { pacificDay } from "@/lib/ai/quota";
import { courseVisibleTo, viewerById } from "@/lib/course-access";
import { LESSON_TUTOR_CHAIN, type LessonTurnEvent } from "@/lib/lesson-tutor/turn";
import { prisma } from "@/lib/prisma";
import { latestGraph, type Answer, type Feedback, type SessionItem } from "@/lib/practice/learner";
import type { TaskContent } from "@/lib/practice/tasks";
import { lessonText } from "@/lib/lesson-text";
import { TEACHING } from "@/lib/voice/teaching";
import { runVoiceTurn } from "@/lib/voice/turn";
import type { VoiceLanguage } from "@/lib/voice/deepgram";
import { speakExplainer } from "@/lib/voice/explainer";

// The practice coach (docs/practice.md, "Widgets"): on a course whose practice has the voice widget on, the learner
// talks with an AI about the task in front of them, out loud. It coaches like a fair interviewer (it lets them rehearse,
// says what was strong and what was missing, asks the follow-up an interviewer would) and teaches like a teacher when
// they don't know something (lib/voice/teaching.ts: one concept at a time, what, how, why, in practice, what goes
// wrong), from the lesson the skill comes from. It never gives a task's answer away before it's answered. It runs on the lab's learning service, like the lesson tutor (docs/lesson-tutor.md), with
// a pass for the course; one model call a turn, streamed. The conversation is stored and its context built on the
// server (lib/voice/turn.ts, docs/voice-context.md).

/** Turns a learner may take in a day: a conversation is many short ones. */
export const COACH_TURNS_PER_DAY = 200;
export const CoachTurnSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  /** The practice session on screen, and the task in front of the learner (none on the "done for today" screen). */
  sessionId: z.string().max(60).nullable().default(null),
  taskId: z.string().max(60).nullable().default(null),
  /** The stored conversation this turn continues; null starts one. Absent: a page from before conversations were stored. */
  conversationId: z.string().max(40).nullable().optional(),
  /** The learner cut the previous reply off while it was read aloud. */
  interrupted: z.boolean().default(false),
  history: z
    .array(z.object({ role: z.enum(["learner", "teacher"]), text: z.string().max(4000) }))
    .max(16)
    .default([]),
  spoken: z.boolean().default(false),
  language: z.enum(["es", "en"]).default("es"),
});
export type CoachTurnInput = z.input<typeof CoachTurnSchema>;

export type CoachTurnResult =
  | { ok: true; reply: string; model: string; traceId: string; conversationId?: string }
  | { ok: false; reason: "invalid" | "not-found" | "limit" | "quota" | "unavailable"; message: string; conversationId?: string };

const SYSTEM = {
  en: `You are a teacher, speaking coach and mock interviewer for the course below, talking with one learner who is practising. They want two things: to understand these topics properly, and to explain them well out loud, as they will have to in a technical interview or to a colleague. Your replies are shown to them and read aloud, so write the way you'd talk: short sentences, technical terms as the course uses them.

You work in two ways, and what they just said decides which.

COACHING, when they explained or answered something, or asked to be quizzed:
- 40 to 110 words. They should be talking more than you.
- Say in one sentence what was strong; then the most important thing that was missing, vague or wrong (a wrong fact is corrected plainly, with the right one); then ask one follow-up a fair interviewer would ask, or ask them to say it again, tighter.
- Push like a fair interviewer: "why?", "what would you check first?", "what if that fails?", "how would you know?". Don't accept a term without what it means.
- Notice how they speak as well as what they say: an answer that rambles or buries the point gets "lead with the conclusion"; filler and hedging get named once, kindly.
- When they ask for a question to practise, or there is no task in front of them, ask one about the skills listed, one at a time, and wait for their answer.
- When their answer shows they don't really understand the idea underneath, say so kindly and teach it.

TEACHING, when they ask what something is, how to do it or why, say they don't know or don't follow, or ask you to explain:

${TEACHING.en}

Length when teaching: 120 to 220 words a reply, plus any code. A reply with a procedure in it may run longer.

Stay with this course. Never invent facts, commands or numbers. Answer in English.`,
  es: `Eres profesor, entrenador de expresión oral y entrevistador de práctica para el curso de abajo, y hablas con un estudiante que está practicando. Quiere dos cosas: entender bien estos temas y explicarlos bien en voz alta, como tendrá que hacerlo en una entrevista técnica o ante un colega. Tus respuestas se le muestran y se le leen en voz alta, así que escribe como hablarías: frases cortas, los términos técnicos como los usa el curso.

Trabajas de dos maneras, y lo que acaba de decir decide cuál.

ENTRENAR, cuando explicó o respondió algo, o pidió que le preguntes:
- Entre 40 y 110 palabras. Quien más debe hablar es el estudiante.
- Di en una frase qué estuvo bien; luego lo más importante que faltó, quedó vago o era incorrecto (un dato incorrecto se corrige sin rodeos, con el correcto); luego haz una pregunta de seguimiento como la haría un entrevistador justo, o pídele que lo repita más conciso.
- Insiste como un entrevistador justo: "¿por qué?", "¿qué comprobarías primero?", "¿y si eso falla?", "¿cómo lo sabrías?". No aceptes un término sin lo que significa.
- Fíjate en cómo habla además de en lo que dice: una respuesta que divaga o esconde lo importante recibe un "empieza por la conclusión"; las muletillas y los rodeos se señalan una vez, con amabilidad.
- Cuando pida una pregunta para practicar, o no tenga una tarea delante, hazle una sobre las habilidades de la lista, de una en una, y espera su respuesta.
- Cuando su respuesta muestre que no entiende de verdad la idea de fondo, díselo con amabilidad y enséñasela.

ENSEÑAR, cuando pregunte qué es algo, cómo se hace o por qué, diga que no sabe o que no lo sigue, o te pida que se lo expliques:

${TEACHING.es}

Extensión al enseñar: entre 120 y 220 palabras por respuesta, más el código que haya. Una respuesta con un procedimiento puede alargarse.

Quédate en este curso. Nunca inventes datos, comandos ni cifras. Los términos técnicos en inglés, como los usa el curso. Responde en español.`,
};

type Language = "es" | "en";
const pick = (language: Language, es: string | undefined, en: string | undefined) => (language === "es" ? es || en : en || es) ?? "";

/** The task's key, for the coach only: what it must not give away before the task is answered, and may discuss after. */
function keyOf(content: TaskContent): string {
  switch (content.form) {
    case "choice":
      return `Right option: ${content.optionsEn?.[content.answerIndex ?? -1] ?? "(unknown)"}`;
    case "fill":
      return `Accepted answers: ${(content.answers ?? []).join(" | ")}`;
    case "predict":
      return `It prints: ${content.expectedOutput ?? ""}`;
    case "explain":
      return `Points a good answer makes:\n${(content.pointsEn ?? []).map((point, index) => `${index + 1}. ${point}`).join("\n")}\nMisconceptions to watch for:\n${(content.misconceptionsEn ?? []).map((wrong) => `- ${wrong}`).join("\n")}`;
    case "code":
    case "debug":
      return "A code task, graded by tests. Talk about the approach in words; never dictate the code.";
  }
}

function answerOf(content: TaskContent, answer: Answer, feedback: Feedback, language: Language): string {
  const lines: string[] = [];
  if (content.form === "choice") lines.push(`They picked: ${content.optionsEn?.[answer.index ?? -1] ?? "(nothing)"}`);
  else if (content.form === "code" || content.form === "debug") lines.push(`Their code:\n${(answer.code ?? "").slice(0, 2500)}`);
  else lines.push(`Their answer${answer.spoken ? " (spoken)" : ""}:\n${(answer.text ?? "").slice(0, 3000)}`);
  lines.push(`Graded: ${feedback.passed ? "passed" : "not passed"} (${Math.round(feedback.score * 100)}%).`);
  if (feedback.rubric?.length) lines.push(`Point by point:\n${feedback.rubric.map((point) => `- ${point.made}: ${point.en}${point.note ? ` (${point.note})` : ""}`).join("\n")}`);
  const wrong = [...(feedback.misconceptions ?? []).map((entry) => entry.en), ...(feedback.otherErrors ?? [])];
  if (wrong.length) lines.push(`What they said that isn't so: ${wrong.join("; ")}`);
  const failing = (feedback.tests ?? []).filter((test) => !test.passed).map((test) => test.name);
  if (failing.length) lines.push(`Failing tests: ${failing.join(", ")}`);
  if (content.form === "explain" && content.modelAnswerEn) lines.push(`A good answer, for reference:\n${pick(language, content.modelAnswerEs, content.modelAnswerEn)}`);
  lines.push(`Why: ${pick(language, content.explanationEs, content.explanationEn)}`);
  return lines.join("\n");
}

/** The lesson as the coach knows it, at most this many characters: where its commands and settings come from. */
const LESSON_CHARS = 12_000;
const lessons = new Map<string, { at: number; value: Promise<string | null> }>();

/** A lesson's title and text, kept ten minutes: a conversation is many turns about the same lesson. */
function lessonBlock(lessonId: string): Promise<string | null> {
  const hit = lessons.get(lessonId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const value = (async () => {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { code: true, title: true, body: true, sourcePath: true, module: { select: { course: { select: { title: true, sourceRepoUrl: true, sourceRef: true } } } } },
    });
    if (!lesson) return null;
    const text = await lessonText(lesson.module.course, lesson, LESSON_CHARS).catch(() => null);
    return text ? `# The lesson this comes from: ${lesson.code ?? ""} ${lesson.title.replaceAll("`", "")}\nTeach from it: its commands, settings and explanations are the course's own.\n"""\n${text}\n"""` : null;
  })();
  lessons.set(lessonId, { at: Date.now(), value });
  value.catch(() => lessons.delete(lessonId));
  if (lessons.size > 100) lessons.delete(lessons.keys().next().value as string);
  return value;
}

/**
 * What the coach is told about where the learner is, as two layers of its context (lib/voice/context.ts): `grounding`,
 * the course and the lesson the task comes from, which stays the same while the learner is on that task; and `now`,
 * today's set, the task on screen and whether it's answered, which changes from one turn to the next.
 */
async function situation(userId: string, courseId: string, sessionId: string | null, taskId: string | null, language: Language): Promise<{ grounding: string; now: string } | null> {
  const viewer = await viewerById(userId);
  const course = await prisma.course.findFirst({ where: { id: courseId, status: "PUBLISHED", practiceVoice: true, ...courseVisibleTo(viewer) }, select: { title: true, summary: true } });
  if (!course) return null;
  const enrolled = viewer?.role === "ADMIN" || Boolean(await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { userId: true } }));
  if (!enrolled) return null;

  const stable = [`# The course\n${course.title}${course.summary ? `\n${course.summary}` : ""}`];
  const blocks: string[] = [];
  const session = sessionId
    ? await prisma.practiceSession.findUnique({
        where: { id: sessionId },
        select: { items: true, learner: { select: { userId: true, courseId: true } }, answers: { select: { taskId: true, passed: true, answer: true, result: true } } },
      })
    : null;
  const mine = session && session.learner.userId === userId && session.learner.courseId === courseId ? session : null;
  const items = mine ? (mine.items as unknown as SessionItem[]) : [];
  const graph = await latestGraph(courseId);
  const label = (skillKey: string) => {
    const meta = graph?.published.skills[skillKey];
    return meta ? pick(language, meta.labelEs, meta.labelEn) : skillKey;
  };

  if (items.length) {
    const lines = items.map((item) => {
      const answered = mine!.answers.find((answer) => answer.taskId === item.taskId);
      return `- ${label(item.skillKey)} (${item.stage}): ${answered ? (answered.passed ? "answered, right" : "answered, not right yet") : "not answered yet"}`;
    });
    blocks.push(`# Today's practice (the skills to ask about)\n${[...new Set(lines)].join("\n")}`);
  } else if (graph) {
    const some = Object.values(graph.published.skills).slice(0, 25).map((meta) => `- ${pick(language, meta.labelEs, meta.labelEn)}`);
    if (some.length) blocks.push(`# Skills of the course (to ask about)\n${some.join("\n")}`);
  }

  const item = taskId ? items.find((entry) => entry.taskId === taskId) : undefined;
  const task = item ? await prisma.practiceTask.findUnique({ where: { id: item.taskId }, select: { content: true } }) : null;
  const content = task?.content as unknown as TaskContent | undefined;
  if (item && content) {
    const answered = mine!.answers.find((answer) => answer.taskId === item.taskId);
    const options = content.form === "choice" ? `\nOptions:\n${((language === "es" ? content.optionsEs : content.optionsEn) ?? []).map((option) => `- ${option}`).join("\n")}` : "";
    const lessonId = graph?.published.skills[item.skillKey]?.lessonId;
    const lesson = lessonId ? await lessonBlock(lessonId) : null;
    if (lesson) stable.push(lesson);
    blocks.push(`# The task in front of them (${content.form}; skill: ${label(item.skillKey)})\n${pick(language, content.promptEs, content.promptEn)}${options}`);
    if (answered) {
      blocks.push(
        `# They have answered it\n${answerOf(content, answered.answer as unknown as Answer, answered.result as unknown as Feedback, language)}\n\nDiscuss it freely. What they missed or got wrong, teach properly, one point at a time (TEACHING). Then have them say a better version out loud, and ask the follow-ups an interviewer would.`,
      );
    } else {
      blocks.push(
        `# The task on their screen is NOT answered yet (for you only)
${keyOf(content)}

Only the answer to THIS task's question is protected, because it is graded. So:
- When they ask about anything else (another topic of the course, a tool, a term, something this task doesn't ask): teach it right away and fully. Don't mention the task, and don't ask them to answer it first.
- When they rehearse their answer to this task: tell them whether it is clear and how it is organised, say that an area deserves more ("say more about the order things happen in") without stating the point, and push with questions. Never give the right option, the value or the points a good answer makes, not even reworded. When they seem ready, tell them to give their answer in the task.
- When they ask you to explain or teach what THIS task asks: ask for their best answer in the task first, even a short or unsure one (a miss only brings the skill back sooner), and promise the full explanation right after.`,
      );
    }
  } else {
    blocks.push("# No task in front of them\nThey finished the set, or are between tasks. Offer to ask them questions on today's skills, one at a time, like a mock interview.");
  }
  return { grounding: stable.join("\n\n"), now: blocks.join("\n\n") };
}

/** One turn of the conversation with the practice coach of `courseId`. With `onEvent`, the reply is passed on as it's written. */
export async function runCoachTurn(
  userId: string,
  courseId: string,
  input: CoachTurnInput,
  onEvent?: (event: LessonTurnEvent) => void,
  clientGone?: () => boolean,
): Promise<CoachTurnResult> {
  const parsed = CoachTurnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid message." };
  const request = parsed.data;
  const language = request.language;
  const es = language === "es";
  const [context, today] = await Promise.all([
    situation(userId, courseId, request.sessionId, request.taskId, language),
    prisma.aiRequest.count({ where: { userId, day: pacificDay(), feature: "practice-coach" } }),
  ]);
  if (!context) return { ok: false, reason: "not-found", message: es ? "El entrenador no está disponible en este curso." : "The coach isn't available for this course." };
  if (today >= COACH_TURNS_PER_DAY) return { ok: false, reason: "limit", message: es ? "Por hoy ya hablaste bastante con el entrenador. Vuelve mañana." : "That's today's time with the coach. Come back tomorrow." };

  const how = request.spoken
    ? es
      ? "Te habla en voz alta (lo que ves es lo que entendió el micrófono: ignora los fallos de transcripción) y oirá tu respuesta."
      : "They are speaking out loud (what you see is what the microphone heard: ignore transcription slips) and will hear your reply."
    : es
      ? "Lo escribió; tu respuesta se muestra y puede leerse en voz alta."
      : "They typed this; your reply is shown and may be read aloud.";
  const busy = es ? "El entrenador está ocupado ahora. Inténtalo en un rato." : "The coach is busy right now. Try again in a while.";
  const failed = es ? "El entrenador no pudo responder. Inténtalo de nuevo." : "The coach couldn't answer. Try again.";

  if (request.conversationId !== undefined) {
    const result = await runVoiceTurn({
      scope: { userId, kind: "practice", courseId, lessonId: null },
      conversationId: request.conversationId,
      question: request.question,
      language,
      role: SYSTEM[language],
      grounding: context.grounding,
      situation: `${context.now}\n\n${how}`,
      learnerMeta: { spoken: request.spoken, ...(request.taskId ? { taskId: request.taskId } : {}) },
      interruptedPrevious: request.interrupted,
      feature: "practice-coach",
      models: LESSON_TUTOR_CHAIN,
      maxOutputTokens: 2000,
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
  // The conversation must start with the learner: an earlier reply without what it answered is dropped.
  while (contents.length > 1 && contents[0].role !== "user") contents.shift();

  let attemptShown = -1;
  let shown = "";
  const result = await generateWithFallback({
    feature: "practice-coach",
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
    config: { systemInstruction: `${SYSTEM[language]}\n\n${context.grounding}\n\n${context.now}\n\n${how}`, thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: 2000 },
  });
  if (!result.ok) return { ok: false, reason: result.reason === "quota" ? "quota" : "unavailable", message: result.reason === "quota" ? busy : failed };
  return { ok: true, reply: result.text.trim(), model: result.model, traceId: result.traceId };
}

/** Reads a piece of the coach's reply aloud, in the explainers' voice (lib/voice/explainer.ts). */
export function speakCoach(text: string, language: VoiceLanguage, signal: AbortSignal, context: { userId: string; courseId: string; speed?: number }): Promise<ReadableStream<Uint8Array>> {
  return speakExplainer(text, language, signal, { workload: "practice-coach.speak", speed: context.speed, userId: context.userId, courseId: context.courseId });
}
