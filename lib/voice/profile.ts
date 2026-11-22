import type { ThinkingLevel } from "@google/genai";
import { generateWithFallback, logAi, type ModelEntry } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { BUDGET, clip, fitSections, type NoteSection, type StoredMessage } from "@/lib/voice/context";

// The learner profile (docs/voice-context.md, "The learner profile"): what the voice teachers know about a learner
// beyond one conversation. A conversation's own note (compaction) is forgotten when the conversation ends; this is
// what carries over: how they like to learn, what they know, what is still shaky, which wrong ideas they had.
//
// Two rows a learner (`learner_profile`): scope "all", how they learn, for every course and both teachers; and one per
// course, what they know there. A model writes both from the conversation as it goes, in the background, after a
// stretch of new turns, and again from what is left when the learner starts another conversation, so a short
// conversation is learned from too. Each section has its own size limit, enforced here, like the conversation's note.

export const PROFILE_SCOPE_ALL = "all";

/** How they learn: true of the learner in every course. Kept from the top: early observations stay unless changed. */
export const GENERAL_SECTIONS: ReadonlyArray<NoteSection> = [
  { en: "HOW THEY LIKE TO LEARN", es: "CÓMO LE GUSTA APRENDER", chars: 640, keep: "oldest" },
  { en: "WHAT WORKS", es: "LO QUE FUNCIONA", chars: 320, keep: "oldest" },
  { en: "WHAT DOESN'T", es: "LO QUE NO FUNCIONA", chars: 320, keep: "oldest" },
  { en: "THEIR GOALS", es: "SUS OBJETIVOS", chars: 240, keep: "oldest" },
];

/** What they know in one course. Kept from the bottom: the newest state of their knowledge matters most. */
export const COURSE_SECTIONS: ReadonlyArray<NoteSection> = [
  { en: "MISCONCEPTIONS", es: "IDEAS EQUIVOCADAS", chars: 420, keep: "newest" },
  { en: "STILL SHAKY", es: "TODAVÍA INSEGURO", chars: 360, keep: "newest" },
  { en: "KNOWS WELL", es: "DOMINA", chars: 360, keep: "newest" },
];

/** New messages in a conversation before the profile learns from them again: three exchanges. */
export const PROFILE_BATCH = 6;
/** A conversation left this long, with anything new in it, is learned from when the learner starts another. */
const LEFT_MS = 10 * 60_000;

const SYSTEM = {
  en: `You keep a teacher's notes on one learner, across every conversation they have with the course's voice teachers. You are given the notes so far (if any) and a new stretch of one conversation. Write the notes again so they include what the new stretch shows. The teachers read these notes before every conversation, so they can teach this person better.

Use exactly these headings, in this order, each on its own line followed by short lines that start with "- ". Write "none" under a heading with nothing to say.

HOW THEY LIKE TO LEARN: how they asked to be taught or plainly prefer: building ideas in conversation or listening, debating, pace, length of answers, kind of examples (for example from their work), depth, theory or practice first.
WHAT WORKS: explanations, examples or ways of checking that clearly landed with them.
WHAT DOESN'T: what frustrated them or didn't land (for example being quizzed when they wanted an answer, long replies, abstract explanations).
THEIR GOALS: what they're learning for, if they said (an interview, a project, a job).
MISCONCEPTIONS: each wrong idea they showed in this course, the right idea, and whether it is now corrected.
STILL SHAKY: what in this course they understand only in part, or keep asking about.
KNOWS WELL: what in this course they clearly showed they understand (by explaining it, applying it or answering well), not just what was explained to them.

Rules:
- Only what the conversation shows about this learner. Never add teaching content, never guess, never record what the teacher said unless it shows something about the learner.
- Keep every line from the notes so far unless the new stretch changes it: then rewrite or remove that line (a misconception they've now corrected says so; something shaky they've now mastered moves to KNOWS WELL).
- Be specific: "prefers AWS examples", not "likes examples"; "thought the TTL is how long the authority keeps a record (corrected)", not "confused about DNS".
- A MISCONCEPTION is a wrong fact or wrong mental model they held. Pushing back, debating or questioning a rule is not one: if it shows how they like to learn, it goes under HOW THEY LIKE TO LEARN.
- Short lines: at most 5 lines a section, each under 20 words. When a section is full, merge lines or drop the least useful one; never drop something they asked for explicitly (how to be taught, their pace, their examples).
- At most 300 words in all. In English.`,
  es: `Llevas las notas de un profesor sobre un estudiante, a lo largo de todas las conversaciones que tiene con los profesores por voz del curso. Recibes las notas hasta ahora (si las hay) y un tramo nuevo de una conversación. Escribe las notas de nuevo para que incluyan lo que muestra el tramo nuevo. Los profesores leen estas notas antes de cada conversación, para enseñarle mejor a esta persona.

Usa exactamente estos encabezados, en este orden, cada uno en su propia línea seguido de líneas cortas que empiezan por "- ". Escribe "nada" bajo un encabezado sin contenido.

CÓMO LE GUSTA APRENDER: cómo pidió que le enseñen o prefiere claramente: construir ideas conversando o escuchar, debatir, ritmo, extensión de las respuestas, tipo de ejemplos (por ejemplo de su trabajo), profundidad, teoría o práctica primero.
LO QUE FUNCIONA: explicaciones, ejemplos o formas de comprobar que claramente le sirvieron.
LO QUE NO FUNCIONA: lo que le frustró o no le sirvió (por ejemplo que le pregunten cuando quería una respuesta, respuestas largas, explicaciones abstractas).
SUS OBJETIVOS: para qué aprende, si lo dijo (una entrevista, un proyecto, un trabajo).
IDEAS EQUIVOCADAS: cada idea equivocada que mostró en este curso, la idea correcta, y si ya está corregida.
TODAVÍA INSEGURO: lo que en este curso entiende solo en parte, o sigue preguntando.
DOMINA: lo que en este curso mostró claramente que entiende (explicándolo, aplicándolo o respondiendo bien), no solo lo que se le explicó.

Reglas:
- Solo lo que la conversación muestra de este estudiante. Nunca añadas contenido de enseñanza, nunca adivines, nunca anotes lo que dijo el profesor salvo que muestre algo del estudiante.
- Conserva cada línea de las notas hasta ahora salvo que el tramo nuevo la cambie: entonces reescríbela o quítala (una idea equivocada que ya corrigió lo dice; algo inseguro que ya domina pasa a DOMINA).
- Sé concreto: "prefiere ejemplos de AWS", no "le gustan los ejemplos"; "creía que el TTL es cuánto guarda el registro la autoridad (corregido)", no "confundido con DNS".
- Una IDEA EQUIVOCADA es un dato o un modelo mental incorrecto que tenía. Llevar la contraria, debatir o cuestionar una regla no lo es: si muestra cómo le gusta aprender, va en CÓMO LE GUSTA APRENDER.
- Líneas cortas: como mucho 5 líneas por sección, cada una de menos de 20 palabras. Cuando una sección esté llena, junta líneas o quita la menos útil; nunca quites algo que pidió explícitamente (cómo enseñarle, su ritmo, sus ejemplos).
- Como mucho 300 palabras en total. En español.`,
};

/** The learner's profile for a course, as the teachers read it: how they learn, then what they know there. */
export async function readProfile(userId: string, courseId: string, language: "es" | "en"): Promise<string | null> {
  const rows = await prisma.learnerProfile.findMany({ where: { userId, scope: { in: [PROFILE_SCOPE_ALL, courseId] } }, select: { scope: true, notes: true } });
  const general = rows.find((row) => row.scope === PROFILE_SCOPE_ALL)?.notes;
  const course = rows.find((row) => row.scope === courseId)?.notes;
  const text = [general ? fitSections(general, GENERAL_SECTIONS, language, 1_400) : "", course ? fitSections(course, COURSE_SECTIONS, language, 1_140) : ""].filter(Boolean).join("\n\n");
  return text.trim() ? clip(text, BUDGET.profileChars) : null;
}

/** What the summariser of the profile is given: the notes so far, and the new stretch of conversation. */
function profileRequest(previous: string, course: string, messages: StoredMessage[], language: "es" | "en"): string {
  const es = language === "es";
  const lines = messages
    .filter((message) => message.status !== "failed" && message.text.trim())
    .map((message) => `${message.role === "learner" ? (es ? "ESTUDIANTE" : "LEARNER") : es ? "PROFESOR" : "TEACHER"}: ${clip(message.text, message.role === "learner" ? BUDGET.messageChars : 1_200)}`);
  return [
    `# ${es ? "CURSO" : "COURSE"}\n${course}`,
    `# ${es ? "NOTAS HASTA AHORA" : "NOTES SO FAR"}\n${previous.trim() || (es ? "(ninguna: primera vez)" : "(none: the first time)")}`,
    `# ${es ? "EL TRAMO NUEVO" : "THE NEW STRETCH"}\n${lines.join("\n\n")}`,
  ].join("\n\n");
}

/** Splits the model's note into its two rows: the general sections, and the course's. */
export function splitNote(text: string, language: "es" | "en"): { general: string; course: string } {
  const all = fitSections(text, [...GENERAL_SECTIONS, ...COURSE_SECTIONS], language, 2_600);
  const firstCourse = all.indexOf(`${COURSE_SECTIONS[0][language]}:`);
  return firstCourse < 0 ? { general: all, course: "" } : { general: all.slice(0, firstCourse).trim(), course: all.slice(firstCourse).trim() };
}

/**
 * Learns from a conversation's messages since the profile last did: rewrites both rows and moves the conversation's
 * mark. With `force`, from any new messages (a conversation the learner has left); otherwise only once PROFILE_BATCH
 * have piled up. Never throws; a failure only means the next turn tries again.
 */
export async function learnFromConversation(conversationId: string, language: "es" | "en", models: ReadonlyArray<ModelEntry>, force = false): Promise<boolean> {
  try {
    const conversation = await prisma.voiceConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, courseId: true, profileSeq: true, messageCount: true },
    });
    if (!conversation) return false;
    const fresh = conversation.messageCount - conversation.profileSeq;
    if (fresh < (force ? 2 : PROFILE_BATCH)) return false;
    const rows = await prisma.voiceMessage.findMany({ where: { conversationId, seq: { gt: conversation.profileSeq } }, orderBy: { seq: "asc" }, select: { seq: true, role: true, text: true, status: true } });
    if (!rows.some((row) => row.role === "learner")) return false;
    const upTo = rows.at(-1)?.seq ?? conversation.profileSeq;
    const messages: StoredMessage[] = rows.map((row) => ({ seq: row.seq, role: row.role === "teacher" ? "teacher" : "learner", text: row.text, status: row.status === "failed" ? "failed" : row.status === "interrupted" ? "interrupted" : "ok" }));
    const [previous, courseTitle] = await Promise.all([
      readProfile(conversation.userId, conversation.courseId, language).then((text) => text ?? ""),
      prisma.course.findUnique({ where: { id: conversation.courseId }, select: { title: true } }).then((row) => row?.title ?? ""),
    ]);
    const result = await generateWithFallback({
      // Its own feature in the AI ledger, so it never counts against the learner's turns for the day.
      feature: "voice-profile",
      pool: "TUTOR",
      models,
      userId: conversation.userId,
      contents: [{ role: "user", parts: [{ text: profileRequest(previous, courseTitle, messages, language) }] }],
      config: { systemInstruction: SYSTEM[language], thinkingConfig: { thinkingLevel: "LOW" as ThinkingLevel }, maxOutputTokens: 1100, temperature: 0.2 },
    });
    if (!result.ok || !result.text.trim()) return false;
    // The mark moves first and only forward: two runs over the same messages can't both write.
    const { count } = await prisma.voiceConversation.updateMany({ where: { id: conversationId, profileSeq: conversation.profileSeq }, data: { profileSeq: upTo } });
    if (!count) return false;
    const { general, course } = splitNote(result.text, language);
    const save = (scope: string, notes: string) =>
      notes.trim()
        ? prisma.learnerProfile.upsert({
            where: { userId_scope: { userId: conversation.userId, scope } },
            create: { userId: conversation.userId, scope, notes, updates: 1 },
            update: { notes, updates: { increment: 1 } },
          })
        : null;
    await Promise.all([save(PROFILE_SCOPE_ALL, general), save(conversation.courseId, course)]);
    logAi("info", { event: "voice.profile", conversationId, upTo, learned: messages.length, generalChars: general.length, courseChars: course.length, model: result.model });
    return true;
  } catch (error) {
    logAi("warn", { event: "voice.profile_failed", conversationId, error: String(error).slice(0, 300) });
    return false;
  }
}

/**
 * When a learner starts a new conversation: the ones they left with something the profile hasn't learned from yet (a
 * short conversation never reaches PROFILE_BATCH) are learned from now, at most three, oldest first.
 */
export async function learnFromLeftConversations(userId: string, exceptId: string, language: "es" | "en", models: ReadonlyArray<ModelEntry>): Promise<void> {
  const left = await prisma.voiceConversation.findMany({
    where: { userId, id: { not: exceptId }, updatedAt: { lt: new Date(Date.now() - LEFT_MS) } },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, profileSeq: true, messageCount: true, updatedAt: true },
  });
  const pending = left.filter((row) => row.messageCount - row.profileSeq >= 2).slice(0, 3).reverse();
  for (const row of pending) await learnFromConversation(row.id, language, models, true);
}

/** The learner's own view of what is kept about them, for a course: both parts, as written. */
export async function profileFor(userId: string, courseId: string): Promise<{ general: string | null; course: string | null; updatedAt: string | null }> {
  const rows = await prisma.learnerProfile.findMany({ where: { userId, scope: { in: [PROFILE_SCOPE_ALL, courseId] } }, select: { scope: true, notes: true, updatedAt: true } });
  const latest = rows.reduce<Date | null>((at, row) => (!at || row.updatedAt > at ? row.updatedAt : at), null);
  return {
    general: rows.find((row) => row.scope === PROFILE_SCOPE_ALL)?.notes ?? null,
    course: rows.find((row) => row.scope === courseId)?.notes ?? null,
    updatedAt: latest?.toISOString() ?? null,
  };
}

/** Forgets what is kept about the learner: how they learn, and what they know in this course. */
export async function forgetProfile(userId: string, courseId: string): Promise<void> {
  await prisma.learnerProfile.deleteMany({ where: { userId, scope: { in: [PROFILE_SCOPE_ALL, courseId] } } });
}
