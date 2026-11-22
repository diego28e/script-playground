// Imports a course from its repository into the database: the course, its modules and their lessons.
//
//   pnpm course:import --repo <path to the course repository> [--publish] [--private] [--dry-run]
//
// --private makes the course private (docs/private-courses.md): only the people on its access list (Admin → Courses)
// and admins see it. Pass it on the first import of a course that must never be public, before or with --publish. An
// import never makes a course public again: that is only done from Admin → Courses.
//
// The repository layout is the LangChain course's: README.md (course title and tagline), modules/NN-slug/ with a
// README.md (module title, part, goals, estimated time), lesson notebooks NN-MM-slug.ipynb, guides NN-MM-slug.md,
// and project notebooks under project/ (solutions/ is skipped).
//
// A lesson video is a sidecar file, NN-MM-slug.video.json, in lk-core's format (lib/lesson-video.ts): beside a
// notebook or guide of the same name it is that lesson's repository video, the first of its videos
// (docs/lesson-videos.md); on its own it is a video lesson. Its files are referred to as /media/<key> and uploaded to
// the media bucket separately (infra/media/README.md). A sidecar that fails lk-core's checks stops the import with
// every problem listed. Videos uploaded from the admin page (/admin/videos) are never touched by an import.
//
// Re-running is safe: the course, modules and lessons are matched by slug and updated in place. Nothing is
// deleted; lessons that disappeared from the repository are reported, because deleting them would delete
// students' progress. --dry-run parses and prints without touching the database.
import "./load-env";

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseArgs } from "node:util";
import type { LessonKind, Prisma } from "@prisma/client";
import { lessonFingerprint } from "@/lib/lesson-content";
import { parseLessonVideo } from "@/lib/lesson-video";

type ParsedLesson = {
  slug: string;
  code: string | null;
  title: string;
  kind: LessonKind;
  estimatedTime: string | null;
  estimatedMinutes: number | null;
  prerequisites: string | null;
  objectives: string[];
  sourcePath: string | null;
  body: string | null;
  // What the lesson says, as a fingerprint (lib/lesson-content.ts); null for a video lesson.
  contentHash: string | null;
  // The sidecar's JSON, checked; undefined leaves the lesson's video as it is.
  video: Prisma.InputJsonValue | undefined;
};

type ParsedModule = {
  slug: string;
  position: number;
  title: string;
  part: string | null;
  goals: string | null;
  estimatedTime: string | null;
  lessons: ParsedLesson[];
};

type ParsedCourse = {
  slug: string;
  title: string;
  summary: string | null;
  sourceRepoUrl: string | null;
  sourceRef: string;
  modules: ParsedModule[];
  // The language of its code practice, from its lessons (detectLanguage); set on a course's first import only.
  language: { practice: "python" | "typescript"; python: number; typescript: number };
};

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    slug: { type: "string" },
    publish: { type: "boolean", default: false },
    private: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

/** A git command in the course repository. `quiet` keeps git's own error message off the screen, for a question whose
 * failure is an answer (a folder with no GitHub remote has no repository link). */
function git(repo: string, args: string[], { quiet = false } = {}) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", quiet ? "ignore" : "inherit"] }).trim();
}

/** "90–120 min" → 120, "2–3 h" → 180, "4–6 hours" → 360: the upper bound, in minutes. */
export function upperMinutes(text: string | null): number | null {
  const match = text?.match(/(\d+(?:\.\d+)?)\s*(?:[–-]\s*(\d+(?:\.\d+)?))?\s*(minutes?|min|hours?|h)\b/i);
  if (!match) return null;
  const value = Number(match[2] ?? match[1]);
  return Math.round(match[3].toLowerCase().startsWith("h") ? value * 60 : value);
}

/** Splits a lesson heading into its code and title: "01.04 · Structured output" → ["01.04", "Structured output"]. */
function splitHeading(heading: string): [string | null, string] {
  const cleaned = heading.replace(/\s*\((Starter notebook|guide)\)/gi, "").trim();
  const parts = cleaned.split(" · ");
  if (parts.length < 2) return [null, cleaned];
  const [code, ...rest] = parts;
  return /^\d{2}\.\d{2}$/.test(code) ? [code, rest.join(" · ")] : [null, cleaned];
}

function tableValue(markdown: string, label: string): string | null {
  const match = markdown.match(new RegExp(`${label}\\s*\\|\\s*([^|\\n]+?)\\s*\\|`, "i"));
  return match ? match[1].trim() : null;
}

function readNotebook(path: string): string[] {
  const notebook = JSON.parse(readFileSync(path, "utf8")) as { cells: { cell_type: string; source: string[] | string }[] };
  return notebook.cells
    .filter((cell) => cell.cell_type === "markdown")
    .map((cell) => (Array.isArray(cell.source) ? cell.source.join("") : cell.source));
}

/** Every cell of a notebook, markdown and code, in order: what the lesson says, for its fingerprint. */
function notebookText(path: string): string {
  const notebook = JSON.parse(readFileSync(path, "utf8")) as { cells: { cell_type: string; source: string[] | string }[] };
  return notebook.cells.map((cell) => `${cell.cell_type}\n${Array.isArray(cell.source) ? cell.source.join("") : cell.source}`).join("\n\n");
}

function parseNotebook(repo: string, path: string, kind: LessonKind): ParsedLesson {
  const markdown = readNotebook(path);
  const titleCell = markdown[0] ?? "";
  const [code, title] = splitHeading(titleCell.match(/^#\s+(.+)$/m)?.[1] ?? basename(path, ".ipynb"));
  // Lessons list their objectives in the cell after the title; projects list their requirements there.
  const listCell = markdown.slice(1, 4).find((cell) => /^##\s+(Learning objectives|Requirements)/im.test(cell)) ?? "";
  const objectives = [...listCell.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((match) => match[1].trim());
  const estimatedTime = tableValue(titleCell, "Estimated time");
  return {
    slug: basename(path, ".ipynb"),
    code,
    title,
    kind,
    estimatedTime,
    estimatedMinutes: upperMinutes(estimatedTime),
    prerequisites: tableValue(titleCell, "Prerequisites"),
    objectives,
    sourcePath: relative(repo, path).replaceAll("\\", "/"),
    body: null,
    contentHash: lessonFingerprint(title, objectives, notebookText(path)),
    video: undefined,
  };
}

/**
 * A guide's objectives: the numbered list under its "## Learning objectives" heading, up to the next heading or rule
 * (the TypeScript course's lessons have one). A guide without that heading has none, as before.
 */
function guideObjectives(body: string): string[] {
  const section = body.replace(/\r/g, "").match(/^##\s+Learning objectives\s*\n([\s\S]*?)(?=^#{1,6}\s|^---\s*$|^>\s|(?![\s\S]))/m)?.[1] ?? "";
  return [...section.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((match) => match[1].trim());
}

function parseGuide(repo: string, path: string): ParsedLesson {
  const body = readFileSync(path, "utf8");
  const [code, title] = splitHeading(body.match(/^#\s+(.+)$/m)?.[1] ?? basename(path, ".md"));
  const estimatedTime = body.match(/\*\*Time:\*\*\s*(\d+\s*[–-]\s*\d+\s*(?:minutes|min|hours|h))/i)?.[1] ?? null;
  return {
    slug: basename(path, ".md"),
    code,
    title,
    kind: "READING",
    estimatedTime,
    estimatedMinutes: upperMinutes(estimatedTime),
    prerequisites: null,
    objectives: guideObjectives(body),
    sourcePath: relative(repo, path).replaceAll("\\", "/"),
    body,
    contentHash: lessonFingerprint(title, guideObjectives(body), body),
    video: undefined,
  };
}

/** Reads a NN-MM-slug.video.json sidecar; throws with the file name and every problem lk-core found. */
function readVideo(repo: string, path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  try {
    return { raw: raw as Prisma.InputJsonValue, video: parseLessonVideo(raw) };
  } catch (error) {
    throw new Error(`${relative(repo, path)} is not a valid lesson video:\n${(error as Error).message}`);
  }
}

/** A sidecar with no notebook or guide of its name is a lesson of its own. */
function parseVideoLesson(repo: string, path: string): ParsedLesson {
  const slug = basename(path, ".video.json");
  const { raw, video } = readVideo(repo, path);
  const heading = video.kind === "interactive" ? (video.group.title ?? slug) : (video.media.alt ?? slug);
  const [, title] = splitHeading(heading);
  return {
    slug,
    code: `${slug.slice(0, 2)}.${slug.slice(3, 5)}`,
    title,
    kind: "VIDEO",
    estimatedTime: null,
    estimatedMinutes: null,
    prerequisites: null,
    objectives: [],
    sourcePath: null,
    body: null,
    contentHash: null,
    video: raw,
  };
}

function parseModule(repo: string, folder: string): ParsedModule {
  const dir = join(repo, "modules", folder);
  const readme = existsSync(join(dir, "README.md")) ? readFileSync(join(dir, "README.md"), "utf8") : "";
  const heading = readme.match(/^#\s+(.+)$/m)?.[1] ?? folder;
  const files = readdirSync(dir).filter((file) => /^\d{2}-\d{2}-.+\.(ipynb|md)$/.test(file));
  // A notebook comes before a guide that shares its lesson number (the 00.02 guide follows its notebook).
  files.sort((a, b) => a.slice(0, 5).localeCompare(b.slice(0, 5)) || (a.endsWith(".md") ? 1 : 0) - (b.endsWith(".md") ? 1 : 0) || a.localeCompare(b));
  const lessons = files.map((file) =>
    file.endsWith(".md") ? parseGuide(repo, join(dir, file)) : parseNotebook(repo, join(dir, file), "NOTEBOOK"),
  );
  // Videos: attached to the lesson of the same name (the first, when a notebook and a guide share it), or their own.
  for (const file of readdirSync(dir).filter((name) => /^\d{2}-\d{2}-.+\.video\.json$/.test(name)).sort()) {
    const slug = basename(file, ".video.json");
    const owner = lessons.find((lesson) => lesson.slug === slug);
    if (owner) {
      owner.video = readVideo(repo, join(dir, file)).raw;
    } else {
      const lesson = parseVideoLesson(repo, join(dir, file));
      const at = lessons.findIndex((other) => other.slug.slice(0, 5) > slug.slice(0, 5));
      lessons.splice(at === -1 ? lessons.length : at, 0, lesson);
    }
  }
  const projectDir = join(dir, "project");
  if (existsSync(projectDir)) {
    for (const file of readdirSync(projectDir).filter((name) => name.endsWith(".ipynb")).sort()) {
      lessons.push(parseNotebook(repo, join(projectDir, file), "PROJECT"));
    }
  }
  return {
    slug: folder,
    position: Number(folder.slice(0, 2)),
    title: heading.replace(/^Module\s+\d+\s+—\s+/, ""),
    part: readme.match(/^>\s*\*\*(Part \d+ — [^(*]+?)\s*(?:\([^)]*\))?\*\*/m)?.[1]?.trim() ?? null,
    goals: readme.match(/^\*\*Goals:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null,
    estimatedTime: readme.match(/^\*\*Estimated time:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null,
    lessons,
  };
}

function parseCourse(repo: string, slug?: string): ParsedCourse {
  const readme = readFileSync(join(repo, "README.md"), "utf8");
  const remote = (() => {
    try {
      return git(repo, ["remote", "get-url", "origin"], { quiet: true }).replace(/\.git$/, "");
    } catch {
      return null;
    }
  })();
  const folders = readdirSync(join(repo, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const modules = folders.map((folder) => parseModule(repo, folder));
  return {
    slug: slug ?? basename(remote ?? repo),
    title: readme.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(repo),
    summary: readme.match(/^>\s+(.+)$/m)?.[1]?.trim() ?? null,
    sourceRepoUrl: remote,
    sourceRef: git(repo, ["rev-parse", "HEAD"]),
    modules,
    language: detectLanguage(repo, modules),
  };
}

/**
 * The language of a course's code practice (docs/practice.md, "Languages"), from what its lessons have the learner
 * write: Python code cells in notebooks and ```python blocks in guides, against ```ts / ```typescript blocks. Whichever
 * there is more of wins; a course with neither (the SRE course: shell and prose) is Python, the platform's default, and
 * its skills get no code tasks anyway. The lessons, not files like tsconfig.json or package.json, because those can sit
 * in a repository for other reasons, while the lessons are exactly what the practice drills.
 */
function detectLanguage(repo: string, modules: ParsedModule[]): ParsedCourse["language"] {
  let python = 0;
  let typescript = 0;
  for (const lesson of modules.flatMap((courseModule) => courseModule.lessons)) {
    if (lesson.body) {
      python += lesson.body.match(/^\s*```(?:python|py)\s*$/gm)?.length ?? 0;
      typescript += lesson.body.match(/^\s*```(?:ts|typescript|tsx)\s*$/gm)?.length ?? 0;
    } else if (lesson.sourcePath?.endsWith(".ipynb")) {
      try {
        const notebook = JSON.parse(readFileSync(join(repo, lesson.sourcePath), "utf8")) as { cells?: { cell_type: string }[] };
        python += (notebook.cells ?? []).filter((cell) => cell.cell_type === "code").length;
      } catch {
        // An unreadable notebook says nothing about the language.
      }
    }
  }
  return { practice: typescript > python ? "typescript" : "python", python, typescript };
}

function printSummary(course: ParsedCourse) {
  const lessons = course.modules.flatMap((module) => module.lessons);
  const byKind = Object.fromEntries(["NOTEBOOK", "READING", "PROJECT", "VIDEO"].map((kind) => [kind, lessons.filter((lesson) => lesson.kind === kind).length]));
  console.log(`${course.title} (${course.slug}) @ ${course.sourceRef.slice(0, 7)}`);
  console.log(`  ${course.modules.length} modules, ${lessons.length} lessons ${JSON.stringify(byKind)}`);
  console.log(`  code practice: ${course.language.practice === "typescript" ? "TypeScript" : "Python"} (${course.language.typescript} TypeScript and ${course.language.python} Python code blocks in its lessons; set on its first import only)`);
  const withVideo = lessons.filter((lesson) => lesson.video !== undefined).map((lesson) => lesson.slug);
  if (withVideo.length) console.log(`  with a video from the repository: ${withVideo.join(", ")}`);
  const missing = lessons.filter((lesson) => lesson.kind !== "READING" && lesson.kind !== "VIDEO" && lesson.objectives.length === 0).map((lesson) => lesson.slug);
  const readingObjectives = lessons.filter((lesson) => lesson.kind === "READING" && lesson.objectives.length > 0).length;
  if (readingObjectives) console.log(`  guides with learning objectives: ${readingObjectives}`);
  if (missing.length) console.log(`  without objectives or requirements: ${missing.join(", ")}`);
  const untimed = lessons.filter((lesson) => lesson.estimatedMinutes === null).map((lesson) => lesson.slug);
  if (untimed.length) console.log(`  without an estimated time: ${untimed.join(", ")}`);
}

async function save(course: ParsedCourse, publish: boolean, makePrivate: boolean) {
  const { prisma } = await import("@/lib/prisma");
  const target = new URL(process.env.DATABASE_URL ?? "").host;
  console.log(`  writing to ${target}`);
  const changedLessons: string[] = [];
  try {
    const removed = await prisma.$transaction(
      async (tx) => {
        const saved = await tx.course.upsert({
          where: { slug: course.slug },
          create: { slug: course.slug, title: course.title, summary: course.summary, sourceRepoUrl: course.sourceRepoUrl, sourceRef: course.sourceRef, importedAt: new Date(), status: publish ? "PUBLISHED" : "DRAFT", visibility: makePrivate ? "PRIVATE" : "PUBLIC", practiceLanguage: course.language.practice },
          update: { title: course.title, summary: course.summary, sourceRepoUrl: course.sourceRepoUrl, sourceRef: course.sourceRef, importedAt: new Date(), ...(publish ? { status: "PUBLISHED" as const } : {}), ...(makePrivate ? { visibility: "PRIVATE" as const } : {}) },
        });
        const kept = new Set<string>();
        for (const courseModule of course.modules) {
          const { lessons, ...fields } = courseModule;
          const savedModule = await tx.courseModule.upsert({
            where: { courseId_slug: { courseId: saved.id, slug: courseModule.slug } },
            create: { ...fields, courseId: saved.id },
            update: fields,
          });
          for (const [index, { video, ...lesson }] of lessons.entries()) {
            // A lesson whose text changed since the last import is marked, so the practice skills drafted from the old
            // text can be found (docs/practice.md, "When a lesson changes"). A row from before fingerprints has none:
            // a guide's is worked out from its stored text; a notebook's can't be, and it starts being tracked now.
            const before = await tx.lesson.findUnique({
              where: { moduleId_slug: { moduleId: savedModule.id, slug: lesson.slug } },
              select: { contentHash: true, title: true, objectives: true, body: true },
            });
            const previous = before?.contentHash ?? (before?.body != null ? lessonFingerprint(before.title, before.objectives, before.body) : null);
            const changed = Boolean(previous && lesson.contentHash && previous !== lesson.contentHash);
            if (changed) changedLessons.push(`${courseModule.slug}/${lesson.slug}`);
            const data = { ...lesson, position: index + 1, missingSince: null, ...(changed ? { contentChangedAt: new Date() } : {}) };
            const savedLesson = await tx.lesson.upsert({
              where: { moduleId_slug: { moduleId: savedModule.id, slug: lesson.slug } },
              create: { ...data, moduleId: savedModule.id },
              update: data,
            });
            kept.add(savedLesson.id);
            // The sidecar is the lesson's repository video, first in its list; uploaded videos are left as they are.
            if (video !== undefined) {
              const current = await tx.lessonVideoPart.findFirst({ where: { lessonId: savedLesson.id, source: "REPOSITORY" }, select: { id: true } });
              if (current) {
                await tx.lessonVideoPart.update({ where: { id: current.id }, data: { video } });
              } else {
                const first = await tx.lessonVideoPart.findFirst({ where: { lessonId: savedLesson.id }, orderBy: { position: "asc" }, select: { position: true } });
                await tx.lessonVideoPart.create({ data: { lessonId: savedLesson.id, position: (first?.position ?? 1) - 1, video, source: "REPOSITORY" } });
              }
            }
          }
        }
        const gone = await tx.lesson.findMany({
          where: { module: { courseId: saved.id }, id: { notIn: [...kept] } },
          select: { id: true, slug: true, missingSince: true, module: { select: { slug: true } } },
        });
        // Kept, with learners' progress, and marked: Admin → Practice shows them so their skills can be retired.
        await tx.lesson.updateMany({ where: { id: { in: gone.filter((lesson) => !lesson.missingSince).map((lesson) => lesson.id) } }, data: { missingSince: new Date() } });
        return gone;
      },
      { timeout: 60_000 },
    );
    if (changedLessons.length) {
      console.log(`  changed since the last import (their practice skills may need redrafting, Admin → Practice): ${changedLessons.length}: ${changedLessons.join(", ")}`);
    }
    if (removed.length) {
      console.log(`  no longer in the repository (kept, with any progress): ${removed.map((lesson) => `${lesson.module.slug}/${lesson.slug}`).join(", ")}`);
    }
    console.log(`  saved${publish ? " and published" : " (status unchanged; --publish shows a draft in the catalog)"}`);
    const { visibility, practiceLanguage } = await prisma.course.findUniqueOrThrow({ where: { slug: course.slug }, select: { visibility: true, practiceLanguage: true } });
    console.log(visibility === "PRIVATE" ? "  private: only the people on its list (Admin → Courses) and admins see it" : "  public: everyone sees it once published (--private keeps it to a list)");
    // An existing course keeps its language (an admin may have chosen it): say so when it isn't what was detected.
    if (practiceLanguage !== course.language.practice) console.log(`  code practice stays ${practiceLanguage === "typescript" ? "TypeScript" : "Python"}, as set before (change it in Admin → Courses)`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const repo = values.repo ?? process.env.COURSE_REPO_PATH;
  if (!repo || !existsSync(join(repo, "modules"))) {
    console.error("Pass --repo <path to the course repository> (a folder with README.md and modules/).");
    process.exit(1);
  }
  const course = parseCourse(repo, values.slug);
  printSummary(course);
  if (values["dry-run"]) {
    // Show the database a real run would write to, so a dry run also checks which env file is in effect.
    console.log(`  dry run: nothing written (a real run writes to ${new URL(process.env.DATABASE_URL ?? "").host})`);
    return;
  }
  await save(course, values.publish, values.private);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
