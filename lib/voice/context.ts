import type { Content } from "@google/genai";

// Context management for the voice teachers (docs/voice-context.md): what the model is given each turn, in what order,
// how much of it, and what happens when a conversation outgrows it. Pure functions over plain data, so the strategy can
// be tested and measured without a database or a model (scripts and the report use them as they are); the storage is
// lib/voice/conversations.ts and the turn is lib/voice/turn.ts.
//
// The model's context is five parts, always in this order, from what never changes to what changes every turn:
//
//   1. role       who the model is and how it teaches             the same for everyone (per language)
//   2. grounding  the course and the lesson's text                the same for everyone on that lesson
//   3. memory     this conversation's summary, earlier ones' list changes when a conversation is compacted
//   4. turns      the newest messages, word for word              grows by two messages a turn
//   5. now        the moment in the audio, the task's state,      changes every turn
//                 then the learner's new message
//
// Parts 1 to 3 are the system instruction; 4 and 5 are the messages, with "now" inside the last one, just above what
// the learner said.
//
// Why this order: providers cache a prompt by its beginning, up to the first character that differs from an earlier
// request. Everything that repeats sits first (parts 1 and 2 are about 5,000 tokens of a 7,500-token prompt, read from
// the cache on every turn of every learner on that lesson), and what changes sits last, where changing it re-reads
// nothing. Nothing volatile is ever placed above something stable: the moment in the audio used to sit above the
// turns, and moving the audio would have had every turn after it read again.

export type VoiceRole = "learner" | "teacher";
export type VoiceStatus = "ok" | "interrupted" | "failed";
export type StoredMessage = { seq: number; role: VoiceRole; text: string; status: VoiceStatus };

/** The size of each part of the context: how much the model may be given, in characters (about 4 to a token). */
export const BUDGET = {
  /** Turns kept word for word: at least the newest this many messages. */
  recentMessages: 8,
  /** Compaction folds the older turns into the summary once this many more have piled up beyond them. */
  compactBatch: 6,
  /** The word-for-word turns together; over it, the oldest replies are shortened (never dropped). */
  recentChars: 10_000,
  /** A long reply shortened to this much of its beginning. */
  shortenedChars: 500,
  /** The conversation's summary: the sum of its sections' own limits (SECTIONS), which is what's enforced. */
  summaryChars: 2_600,
  /** The list of earlier conversations on the same lesson or course. */
  digestChars: 600,
  /** One message as stored and as sent. */
  messageChars: 4_000,
} as const;

export const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text);

// --- The turns ------------------------------------------------------------------------------------------------------

/** The messages the summary doesn't cover yet: all of them go to the model word for word. */
export function unsummarised(messages: StoredMessage[], summarySeq: number): StoredMessage[] {
  return messages.filter((message) => message.seq > summarySeq).sort((a, b) => a.seq - b.seq);
}

/**
 * Whether it's time to compact, and up to which message: once the messages outside the summary exceed the recent
 * window by a batch, everything but the recent window is folded in. The cut always lands just before a learner's
 * message, so what stays word for word starts with the learner (models expect the user to speak first).
 */
export function compactionCut(messages: StoredMessage[], summarySeq: number): number | null {
  const open = unsummarised(messages, summarySeq);
  if (open.length < BUDGET.recentMessages + BUDGET.compactBatch) return null;
  let keepFrom = open.length - BUDGET.recentMessages;
  while (keepFrom < open.length && open[keepFrom].role !== "learner") keepFrom += 1;
  if (keepFrom <= 0 || keepFrom >= open.length) return null;
  return open[keepFrom - 1].seq;
}

/** What a stored message says to the model: a reply that was cut off says so, since the learner didn't hear its end. */
function spokenText(message: StoredMessage, language: "es" | "en"): string {
  const text = clip(message.text, BUDGET.messageChars);
  if (message.role === "teacher" && message.status === "interrupted") {
    return `${text}\n${language === "es" ? "[El estudiante te interrumpió aquí: puede que no oyera el final.]" : "[The learner cut you off here: they may not have heard the end.]"}`;
  }
  return text;
}

/**
 * The turns as the model gets them: the messages outside the summary, then the new message. Failed replies are left
 * out; two messages in a row from the same side become one (a question whose reply failed, then the next question);
 * the first one is always the learner's. Over the budget, the oldest replies are shortened to their beginning: the
 * newest turns matter most, and the summary and the lesson still hold the substance.
 */
export function turnsFor(messages: StoredMessage[], summarySeq: number, question: string, language: "es" | "en", situation = ""): { contents: Content[]; chars: number; situationChars: number; shortened: number } {
  const open = unsummarised(messages, summarySeq).filter((message) => message.status !== "failed" && message.text.trim());
  const texts = open.map((message) => ({ role: message.role, text: spokenText(message, language) }));
  let total = texts.reduce((sum, entry) => sum + entry.text.length, 0);
  let shortened = 0;
  for (const entry of texts) {
    if (total <= BUDGET.recentChars) break;
    if (entry.role !== "teacher" || entry.text.length <= BUDGET.shortenedChars + 80) continue;
    const cut = `${entry.text.slice(0, BUDGET.shortenedChars).trimEnd()}… ${language === "es" ? "[respuesta acortada]" : "[reply shortened]"}`;
    total -= entry.text.length - cut.length;
    entry.text = cut;
    shortened += 1;
  }
  const merged: { role: VoiceRole; text: string }[] = [];
  for (const entry of [...texts, { role: "learner" as const, text: clip(question, BUDGET.messageChars) }]) {
    const last = merged.at(-1);
    if (last && last.role === entry.role) last.text = `${last.text}\n\n${entry.text}`;
    else merged.push({ ...entry });
  }
  while (merged.length > 1 && merged[0].role !== "learner") merged.shift();
  const chars = merged.reduce((sum, entry) => sum + entry.text.length, 0);
  // What is happening right now goes in the last message, above what the learner said: it changes every turn, so it
  // sits where nothing comes after it but the question. It is marked as the platform's, not the learner's words.
  const h = HEADINGS[language];
  const now = situation.trim() ? `${h.situation}\n${situation.trim()}\n\n${h.said}\n` : "";
  const last = merged[merged.length - 1];
  last.text = `${now}${last.text}`;
  return {
    contents: merged.map((entry) => ({ role: entry.role === "learner" ? "user" : "model", parts: [{ text: entry.text }] })),
    chars,
    situationChars: now.length,
    shortened,
  };
}

// --- The layers -----------------------------------------------------------------------------------------------------

export type Layers = {
  /** Who the model is and how it teaches. */
  role: string;
  /** The course and the lesson: what it teaches from. */
  grounding: string;
  /** The conversation's summary, or none before the first compaction. */
  summary: string | null;
  /** Earlier conversations on the same lesson or course, one line each. */
  digest: string[];
};

const HEADINGS = {
  en: {
    summary: "# THIS CONVERSATION SO FAR (your own notes; the latest turns follow word for word)",
    digest: "# EARLIER CONVERSATIONS WITH THIS LEARNER HERE (titles only; they may not remember them, and you don't have their text)",
    situation: "# RIGHT NOW (from the platform, not said by the learner)",
    said: "# THE LEARNER SAYS",
  },
  es: {
    summary: "# ESTA CONVERSACIÓN HASTA AHORA (tus propias notas; los últimos turnos van después, palabra por palabra)",
    digest: "# CONVERSACIONES ANTERIORES CON ESTE ESTUDIANTE AQUÍ (solo títulos; puede que no las recuerde, y no tienes su texto)",
    situation: "# AHORA MISMO (lo dice la plataforma, no el estudiante)",
    said: "# EL ESTUDIANTE DICE",
  },
};

export type ContextSizes = { role: number; grounding: number; memory: number; situation: number; turns: number; total: number };

/** The system instruction: role, grounding and memory in their fixed order, with the size of each. */
export function assemble(layers: Layers, language: "es" | "en"): { system: string; sizes: Pick<ContextSizes, "role" | "grounding" | "memory"> } {
  const h = HEADINGS[language];
  const memoryParts = [
    layers.summary ? `${h.summary}\n${fitSummary(layers.summary, language)}` : "",
    layers.digest.length ? `${h.digest}\n${clip(layers.digest.map((line) => `- ${line}`).join("\n"), BUDGET.digestChars)}` : "",
  ].filter(Boolean);
  const memory = memoryParts.join("\n\n");
  return {
    system: [layers.role, layers.grounding, memory].filter(Boolean).join("\n\n"),
    sizes: { role: layers.role.length, grounding: layers.grounding.length, memory: memory.length },
  };
}

// --- Compaction -----------------------------------------------------------------------------------------------------

/**
 * The summary is a note with fixed sections, not prose: each section is something the teacher needs to carry on (how
 * this learner wants to be taught and what they got wrong, where the explanation stands, the exact commands already
 * given, what was promised). A free summary keeps the story and loses these.
 *
 * Each section has its own size limit, enforced in code (fitSummary), and they are written in order of how long they
 * stay true: what is known about the learner first, the list of concepts covered last. One limit on the whole note cut
 * whatever came last, and in a measured 21-turn conversation that was the learner's own preferences and mistakes, lost
 * at the third compaction (docs/voice-context.md, "What the measurement caught"). With a limit per section, a long
 * list of concepts can only ever push out its own oldest lines.
 */
export const SECTIONS = [
  { en: "THE LEARNER", es: "EL ESTUDIANTE", chars: 520, keep: "oldest" },
  { en: "TOPIC NOW", es: "TEMA ACTUAL", chars: 160, keep: "oldest" },
  { en: "STEP REACHED", es: "PASO ALCANZADO", chars: 260, keep: "oldest" },
  { en: "OPEN", es: "PENDIENTE", chars: 260, keep: "oldest" },
  { en: "EXACT THINGS GIVEN", es: "LO EXACTO QUE SE DIO", chars: 760, keep: "newest" },
  { en: "COVERED", es: "CUBIERTO", chars: 640, keep: "newest" },
] as const;

/** The lines of a section that fit its limit: from the top for what stays true, from the bottom for what piles up. */
function fitLines(body: string, limit: number, keep: "oldest" | "newest"): string {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ordered = keep === "oldest" ? lines : [...lines].reverse();
  const kept: string[] = [];
  let used = 0;
  for (const line of ordered) {
    const room = limit - used;
    if (room < 40 && kept.length) break;
    const fitted = clip(line, Math.max(room, 40));
    kept.push(fitted);
    used += fitted.length + 1;
    if (fitted !== line) break;
  }
  return (keep === "oldest" ? kept : kept.reverse()).join("\n");
}

/**
 * The summariser's note made to fit: read section by section, each cut to its own limit, and written back in the fixed
 * order under the fixed headings. A model asked for "at most N words" goes over; this is what holds the budget. A note
 * with none of the headings (a model that ignored the format) is kept as it is, cut to the whole budget.
 */
export function fitSummary(text: string, language: "es" | "en"): string {
  const marks = SECTIONS.flatMap((section) => {
    // A heading starts a line, in capitals, and ends in a colon or stands alone on its line: the same model writes it
    // both ways from one compaction to the next, with "#", "-" or "**" around it.
    const found = new RegExp(`^[#*\\-\\s]*${section[language]}\\**(?:[ \\t]*:\\**[ \\t]*|[ \\t]*$)`, "m").exec(text);
    return found ? [{ section, at: found.index, bodyAt: found.index + found[0].length }] : [];
  }).sort((a, b) => a.at - b.at);
  if (!marks.length) return clip(text.trim(), BUDGET.summaryChars);
  return SECTIONS.map((section) => {
    const index = marks.findIndex((mark) => mark.section === section);
    const body = index < 0 ? "" : text.slice(marks[index].bodyAt, marks[index + 1]?.at ?? text.length);
    return `${section[language]}:\n${fitLines(body, section.chars, section.keep) || (language === "es" ? "nada" : "none")}`;
  }).join("\n\n");
}

export const SUMMARY_SYSTEM = {
  en: `You keep a teacher's notes on one conversation with a learner. You are given the notes so far (if any) and the next stretch of the conversation. Write the notes again so they cover both. They replace the turns they cover: the teacher will read them instead, then go on teaching, so keep what the teacher needs to go on and nothing else.

Use exactly these headings, in this order, each on its own line followed by short lines that start with "- ". Write "none" under a heading with nothing to say.

THE LEARNER: how they asked to be taught (pace, kind of examples, depth), in their own terms; each mistake or wrong idea they had, what the right idea is, and whether they got it; what they found hard. Only what is true of the learner: what was explained goes under COVERED. At most six lines, the earliest first. This section is never shortened for space: carry every line over from the notes so far, and only change a line when the conversation changed it.
TOPIC NOW: the concept being taught or discussed when this stretch ends, in one line.
STEP REACHED: which of these the explanation of that concept has reached: what it is, how it works, why it is that way, in practice, what goes wrong. And what comes next.
OPEN: questions the learner asked that weren't answered yet; the one check question the teacher asked last, if the learner hasn't answered it (not the earlier ones); anything the teacher promised to come back to. At most three lines.
EXACT THINGS GIVEN: each command, file name, setting and number the teacher gave, word for word in backticks, with two or three words on what it is for, oldest first, so they are never contradicted later.
COVERED: every concept explained so far, oldest first, one line each. Keep the ones from the notes so far: when space is short, an older concept shrinks to a few words, it is not removed.

At most 300 words in all. Facts only, from the conversation: never add an explanation of your own. In English.`,
  es: `Llevas las notas de un profesor sobre una conversación con un estudiante. Recibes las notas hasta ahora (si las hay) y el siguiente tramo de la conversación. Escribe las notas de nuevo para que cubran ambos. Sustituyen a los turnos que cubren: el profesor las leerá en su lugar y seguirá enseñando, así que guarda lo que necesita para seguir y nada más.

Usa exactamente estos encabezados, en este orden, cada uno en su propia línea seguido de líneas cortas que empiezan por "- ". Escribe "nada" bajo un encabezado sin contenido.

EL ESTUDIANTE: cómo pidió que le enseñen (ritmo, tipo de ejemplos, profundidad), con sus palabras; cada error o idea equivocada que tuvo, cuál es la idea correcta y si la entendió; qué le costó. Solo lo que es cierto del estudiante: lo explicado va en CUBIERTO. Como mucho seis líneas, la más antigua primero. Esta sección nunca se acorta por espacio: conserva cada línea de las notas hasta ahora, y cambia una línea solo si la conversación la cambió.
TEMA ACTUAL: el concepto que se estaba enseñando o comentando al acabar este tramo, en una línea.
PASO ALCANZADO: a cuál de estos ha llegado la explicación de ese concepto: qué es, cómo funciona, por qué es así, en la práctica, qué sale mal. Y qué viene después.
PENDIENTE: preguntas del estudiante aún sin responder; la última pregunta de comprobación del profesor, si el estudiante no la ha respondido (no las anteriores); lo que el profesor prometió retomar. Como mucho tres líneas.
LO EXACTO QUE SE DIO: cada comando, nombre de archivo, ajuste y cifra que dio el profesor, palabra por palabra entre acentos graves, con dos o tres palabras sobre para qué sirve, del más antiguo al más reciente, para no contradecirlos después.
CUBIERTO: cada concepto explicado hasta ahora, del más antiguo al más reciente, una línea cada uno. Conserva los de las notas hasta ahora: cuando falte espacio, un concepto antiguo se reduce a unas pocas palabras, no se quita.

Como mucho 300 palabras en total. Solo hechos, de la conversación: nunca añadas una explicación tuya. En español.`,
};

/** What the summariser is given: the notes so far and the turns to fold into them. */
export function summaryRequest(previous: string | null, messages: StoredMessage[], language: "es" | "en"): string {
  const es = language === "es";
  const lines = messages
    .filter((message) => message.status !== "failed" && message.text.trim())
    .map((message) => `${message.role === "learner" ? (es ? "ESTUDIANTE" : "LEARNER") : es ? "PROFESOR" : "TEACHER"}: ${clip(message.text, BUDGET.messageChars)}`);
  return [`# ${es ? "NOTAS HASTA AHORA" : "NOTES SO FAR"}\n${previous?.trim() || (es ? "(ninguna: es el principio de la conversación)" : "(none: this is the start of the conversation)")}`, `# ${es ? "EL SIGUIENTE TRAMO" : "THE NEXT STRETCH"}\n${lines.join("\n\n")}`].join("\n\n");
}

// --- Measuring ------------------------------------------------------------------------------------------------------

/** A conversation's title: what the learner first asked, on one line. */
export const titleOf = (question: string) => clip(question.replace(/\s+/g, " ").trim(), 90);
