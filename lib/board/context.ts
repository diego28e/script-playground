import type { PracticeState } from "@intellectif/lk-practice";
import { prisma } from "@/lib/prisma";
import { lessonText } from "@/lib/lesson-text";
import { readProfile } from "@/lib/voice/profile";

// What the whiteboard teacher is told about a session (docs/whiteboard-contract.md, "The context"): the skill, the part
// of the lesson that teaches it, its prerequisites and what comes next with the learner's state in each, the learner's
// profile, their recent practice on the skill, and what earlier whiteboard sessions on it found.

const LESSON_CHARS = 12_000;
const PROFILE_CHARS = 4_000;
const RECENT_ANSWERS = 5;
const EARLIER_SESSIONS = 3;
const FIELD_CHARS = 600;

export type SkillStateName = "new" | "learning" | "reviewing" | "secure";

export type BoardSummary = { taught: string[]; learnerDid: string[]; struggles: string[]; readyToPractise: boolean; profileNotes: string[] };

export type BoardContext = {
  session: { id: string; kind: "skill" | "lesson"; language: "es" | "en"; resume: boolean };
  course: { title: string; code: string };
  lesson: { code: string | null; title: string; objectives: string[]; text: string };
  skill: {
    key: string;
    label: string;
    description: string;
    criteriaHint: string | null;
    knowledge: "declarative" | "procedural";
    state: SkillStateName;
    prerequisites: { key: string; label: string; state: SkillStateName }[];
    next: { key: string; label: string }[];
  } | null;
  learner: { name: string; profile: string };
  practice: { recent: { when: string; task: string; answer: string; expected: string; correct: boolean }[] };
  earlier: string[];
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** lk-practice's state for one skill, as the teacher reads it. */
export function stateName(state: PracticeState | null, key: string): SkillStateName {
  const skill = state?.skills?.[key];
  if (!skill || !skill.evidenceCount) return "new";
  if (skill.mastered) return "secure";
  return skill.top.successes > 0 ? "reviewing" : "learning";
}

/** A practice task's prompt, in the session's language, with its code when it has some. */
function taskText(content: unknown, language: "es" | "en"): { task: string; expected: string } {
  const task = (content ?? {}) as Record<string, unknown>;
  const pick = (es: string, en: string) => (typeof task[language === "es" ? es : en] === "string" ? (task[language === "es" ? es : en] as string) : "");
  const options = task[language === "es" ? "optionsEs" : "optionsEn"];
  const code = typeof task.code === "string" ? `\n${task.code}` : "";
  const expected =
    Array.isArray(options) && typeof task.answerIndex === "number"
      ? String(options[task.answerIndex] ?? "")
      : Array.isArray(task.answers)
        ? String(task.answers[0] ?? "")
        : typeof task.expectedOutput === "string"
          ? task.expectedOutput
          : typeof task.solution === "string"
            ? task.solution
            : "";
  return { task: clip(`${pick("promptEs", "promptEn")}${code}`, FIELD_CHARS), expected: clip(expected, FIELD_CHARS) };
}

/** What the learner answered, as text. */
function answerText(answer: unknown): string {
  if (typeof answer === "string") return clip(answer, FIELD_CHARS);
  const value = answer as Record<string, unknown> | null;
  for (const key of ["code", "text", "value", "choice"]) if (value && typeof value[key] === "string") return clip(value[key] as string, FIELD_CHARS);
  return clip(JSON.stringify(answer ?? ""), FIELD_CHARS);
}

/** The summaries of earlier sessions as lines the teacher can read. */
export function summaryText(summary: unknown, language: "es" | "en"): string | null {
  const value = summary as Partial<BoardSummary> | null;
  if (!value || typeof value !== "object") return null;
  const es = language === "es";
  const part = (label: string, lines: unknown) => (Array.isArray(lines) && lines.length ? `${label}: ${lines.map(String).join("; ")}` : null);
  const text = [
    part(es ? "Se enseñó" : "Taught", value.taught),
    part(es ? "Mostró" : "Showed", value.learnerDid),
    part(es ? "Le costó" : "Struggled with", value.struggles),
    value.readyToPractise ? (es ? "Listo para practicar" : "Ready to practise") : null,
  ]
    .filter(Boolean)
    .join(". ");
  return text ? clip(`${text}.`, 1_500) : null;
}

/** The context for one session, or null when it doesn't exist. */
export async function boardContext(sid: string): Promise<{ context: BoardContext; closed: boolean } | null> {
  const session = await prisma.boardSession.findUnique({
    where: { id: sid },
    select: {
      id: true,
      userId: true,
      courseId: true,
      lessonId: true,
      skillKey: true,
      language: true,
      status: true,
      didactraSession: true,
      user: { select: { name: true } },
      course: { select: { title: true, practiceLanguage: true, sourceRepoUrl: true, sourceRef: true } },
      lesson: { select: { code: true, title: true, objectives: true, body: true, sourcePath: true } },
    },
  });
  if (!session) return null;
  const language = session.language === "es" ? "es" : "en";

  const [text, profile, learner, skill, earlier] = await Promise.all([
    lessonText(session.course, session.lesson, LESSON_CHARS),
    readProfile(session.userId, session.courseId, language),
    prisma.practiceLearner.findFirst({ where: { userId: session.userId, courseId: session.courseId }, select: { id: true, state: true } }),
    session.skillKey
      ? prisma.practiceSkill.findUnique({
          where: { courseId_key: { courseId: session.courseId, key: session.skillKey } },
          select: {
            key: true,
            labelEs: true,
            labelEn: true,
            descriptionEs: true,
            descriptionEn: true,
            criteriaHint: true,
            knowledge: true,
            requires: { select: { from: { select: { key: true, labelEs: true, labelEn: true } } } },
            requiredBy: { select: { to: { select: { key: true, labelEs: true, labelEn: true } } } },
          },
        })
      : null,
    prisma.boardSession.findMany({
      where: { userId: session.userId, lessonId: session.lessonId, skillKey: session.skillKey, status: "ENDED", id: { not: session.id } },
      orderBy: { endedAt: "desc" },
      take: EARLIER_SESSIONS,
      select: { summary: true },
    }),
  ]);
  const state = (learner?.state ?? null) as PracticeState | null;
  const label = (entry: { labelEs: string; labelEn: string }) => (language === "es" ? entry.labelEs : entry.labelEn);

  const recent =
    learner && session.skillKey
      ? await prisma.practiceAnswer.findMany({
          where: { session: { learnerId: learner.id }, task: { skillKey: session.skillKey } },
          orderBy: { createdAt: "desc" },
          take: RECENT_ANSWERS,
          select: { createdAt: true, answer: true, passed: true, task: { select: { content: true } } },
        })
      : [];

  return {
    closed: session.status === "ENDED",
    context: {
      session: { id: session.id, kind: session.skillKey ? "skill" : "lesson", language, resume: Boolean(session.didactraSession) },
      course: { title: session.course.title, code: session.course.practiceLanguage },
      lesson: { code: session.lesson.code, title: session.lesson.title, objectives: session.lesson.objectives, text: text ?? "" },
      skill: skill
        ? {
            key: skill.key,
            label: label(skill),
            description: language === "es" ? skill.descriptionEs : skill.descriptionEn,
            criteriaHint: skill.criteriaHint,
            knowledge: skill.knowledge === "PROCEDURAL" ? "procedural" : "declarative",
            state: stateName(state, skill.key),
            prerequisites: skill.requires.map(({ from }) => ({ key: from.key, label: label(from), state: stateName(state, from.key) })),
            next: skill.requiredBy.map(({ to }) => ({ key: to.key, label: label(to) })),
          }
        : null,
      learner: { name: (session.user.name ?? "").trim().split(/\s+/)[0] ?? "", profile: clip(profile ?? "", PROFILE_CHARS) },
      practice: {
        recent: recent.map((row) => {
          const { task, expected } = taskText(row.task.content, language);
          return { when: row.createdAt.toISOString().slice(0, 10), task, answer: answerText(row.answer), expected, correct: row.passed };
        }),
      },
      earlier: earlier.map((row) => summaryText(row.summary, language)).filter((line): line is string => Boolean(line)),
    },
  };
}
