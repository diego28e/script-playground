import { validateGraph, type SkillGraph } from "@intellectif/lk-practice";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Publishing the practice skill graph (docs/practice.md): the approved lessons' skills and the prerequisites between
// them become an lk-practice SkillGraph, checked with validateGraph and stored as a new SkillGraphVersion. Learners'
// practice is planned against the latest version; their history is replayed when a new one appears.

/**
 * The task forms a skill's stages accept (lk-practice's `forms`), from its ladder and whether code can practise it
 * offline. choice: multiple choice; fill: fill in the blank; predict: say what a snippet prints; code: write a small
 * piece of code; debug: fix a broken snippet. A skill that only makes sense against a live service gets questions.
 */
export function skillForms(knowledge: "DECLARATIVE" | "PROCEDURAL", runnable: boolean): Record<string, string[]> {
  if (knowledge === "DECLARATIVE") {
    return {
      recognise: ["choice"],
      recall: ["fill"],
      produce: runnable ? ["predict", "code"] : ["fill"],
      apply: runnable ? ["code", "debug"] : ["choice"],
    };
  }
  return {
    example: runnable ? ["predict"] : ["choice"],
    complete: runnable ? ["fill", "debug"] : ["fill"],
    write: runnable ? ["code"] : ["fill"],
    transfer: runnable ? ["code", "debug"] : ["choice"],
  };
}

/**
 * The forms of a skill made from a tutor's request (lib/practice/tutor-requests.ts): code first, as the learner asked
 * for code practice. Writing and fixing code wherever the stage allows it, predicting output now and then; multiple
 * choice only where a stage is about telling things apart. Not runnable: the course's usual forms.
 */
export function tutorSkillForms(knowledge: "DECLARATIVE" | "PROCEDURAL", runnable: boolean): Record<string, string[]> {
  if (!runnable) return skillForms(knowledge, runnable);
  if (knowledge === "DECLARATIVE") return { recognise: ["choice"], recall: ["predict"], produce: ["code", "predict"], apply: ["code", "debug"] };
  return { example: ["code", "predict"], complete: ["debug", "code"], write: ["code"], transfer: ["code", "debug"] };
}

/** What a version stores: the graph lk-practice reads, and what the platform shows of each skill. */
export type PublishedGraph = {
  graph: SkillGraph;
  skills: Record<string, { labelEs: string; labelEn: string; descriptionEs: string; descriptionEn: string; lessonId: string; runnable: boolean }>;
};

export type PublishResult =
  | { ok: true; version: number; skills: number; edges: number; warnings: string[] }
  | { ok: false; error: string; issues?: string[] };

export async function publishGraph(courseId: string, userId: string): Promise<PublishResult> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { slug: true } });
  if (!course) return { ok: false, error: "Course not found." };

  const skills = await prisma.practiceSkill.findMany({
    where: { courseId, lesson: { practiceDraft: { status: "APPROVED" } } },
    orderBy: [{ lesson: { module: { position: "asc" } } }, { lesson: { position: "asc" } }, { position: "asc" }],
    select: {
      id: true,
      key: true,
      labelEs: true,
      labelEn: true,
      descriptionEs: true,
      descriptionEn: true,
      knowledge: true,
      runnable: true,
      criteriaHint: true,
      lessonId: true,
      lesson: { select: { code: true } },
      requires: { select: { strength: true, from: { select: { id: true, key: true, lesson: { select: { practiceDraft: { select: { status: true } } } } } } } },
    },
  });
  if (!skills.length) return { ok: false, error: "No approved lessons yet: approve at least one lesson's skills first." };

  const included = new Set(skills.map((skill) => skill.id));
  const warnings: string[] = [];
  const edges: SkillGraph["edges"][number][] = [];
  for (const skill of skills) {
    for (const edge of skill.requires) {
      if (!included.has(edge.from.id)) {
        // A prerequisite in a lesson not approved yet: left out, so the skill isn't locked behind a skill nobody sees.
        warnings.push(`${skill.key} needs ${edge.from.key}, whose lesson isn't approved: left out of this version.`);
        continue;
      }
      edges.push({ kind: "prerequisite", from: edge.from.key, to: skill.key, strength: edge.strength === "HARD" ? "hard" : "soft" });
    }
  }

  const latest = await prisma.skillGraphVersion.findFirst({ where: { courseId }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (latest?.version ?? 0) + 1;
  const graph: SkillGraph = {
    version: `${course.slug}@${version}`,
    skills: skills.map((skill) => ({
      id: skill.key,
      knowledge: skill.knowledge === "PROCEDURAL" ? "procedural" : "declarative",
      label: skill.labelEn,
      description: skill.descriptionEn,
      ...(skill.criteriaHint ? { criteriaHint: skill.criteriaHint } : {}),
      forms: skillForms(skill.knowledge, skill.runnable),
      tags: skill.lesson.code ? [`lesson:${skill.lesson.code}`] : [],
    })),
    edges,
  };

  const checked = validateGraph(graph);
  if (!checked.ok) {
    return { ok: false, error: "The graph didn't pass lk-practice's checks.", issues: checked.issues.map((issue) => `${issue.code}: ${issue.message}`) };
  }
  warnings.push(...checked.warnings.map((issue) => `${issue.code}: ${issue.message}`));

  const published: PublishedGraph = {
    graph: checked.graph,
    skills: Object.fromEntries(
      skills.map((skill) => [
        skill.key,
        { labelEs: skill.labelEs, labelEn: skill.labelEn, descriptionEs: skill.descriptionEs, descriptionEn: skill.descriptionEn, lessonId: skill.lessonId, runnable: skill.runnable },
      ]),
    ),
  };
  await prisma.skillGraphVersion.create({
    data: {
      courseId,
      version,
      graph: published as unknown as Prisma.InputJsonObject,
      skillCount: skills.length,
      edgeCount: edges.length,
      publishedById: userId,
    },
  });
  return { ok: true, version, skills: skills.length, edges: edges.length, warnings };
}
