// Imports a course from its repository into the database: the course, its modules and their lessons.
//
//   pnpm course:import --repo <path to the course repository> [--publish] [--dry-run]
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
};

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    slug: { type: "string" },
    publish: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
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
    video: undefined,
  };
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
    objectives: [],
    sourcePath: relative(repo, path).replaceAll("\\", "/"),
    body,
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
      return git(repo, "remote", "get-url", "origin").replace(/\.git$/, "");
    } catch {
      return null;
    }
  })();
  const folders = readdirSync(join(repo, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return {
    slug: slug ?? basename(remote ?? repo),
    title: readme.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(repo),
    summary: readme.match(/^>\s+(.+)$/m)?.[1]?.trim() ?? null,
    sourceRepoUrl: remote,
    sourceRef: git(repo, "rev-parse", "HEAD"),
    modules: folders.map((folder) => parseModule(repo, folder)),
  };
}

function printSummary(course: ParsedCourse) {
  const lessons = course.modules.flatMap((module) => module.lessons);
  const byKind = Object.fromEntries(["NOTEBOOK", "READING", "PROJECT", "VIDEO"].map((kind) => [kind, lessons.filter((lesson) => lesson.kind === kind).length]));
  console.log(`${course.title} (${course.slug}) @ ${course.sourceRef.slice(0, 7)}`);
  console.log(`  ${course.modules.length} modules, ${lessons.length} lessons ${JSON.stringify(byKind)}`);
  const withVideo = lessons.filter((lesson) => lesson.video !== undefined).map((lesson) => lesson.slug);
  if (withVideo.length) console.log(`  with a video from the repository: ${withVideo.join(", ")}`);
  const missing = lessons.filter((lesson) => lesson.kind !== "READING" && lesson.kind !== "VIDEO" && lesson.objectives.length === 0).map((lesson) => lesson.slug);
  if (missing.length) console.log(`  without objectives or requirements: ${missing.join(", ")}`);
  const untimed = lessons.filter((lesson) => lesson.estimatedMinutes === null).map((lesson) => lesson.slug);
  if (untimed.length) console.log(`  without an estimated time: ${untimed.join(", ")}`);
}

async function save(course: ParsedCourse, publish: boolean) {
  const { prisma } = await import("@/lib/prisma");
  const target = new URL(process.env.DATABASE_URL ?? "").host;
  console.log(`  writing to ${target}`);
  try {
    const removed = await prisma.$transaction(
      async (tx) => {
        const saved = await tx.course.upsert({
          where: { slug: course.slug },
          create: { slug: course.slug, title: course.title, summary: course.summary, sourceRepoUrl: course.sourceRepoUrl, sourceRef: course.sourceRef, importedAt: new Date(), status: publish ? "PUBLISHED" : "DRAFT" },
          update: { title: course.title, summary: course.summary, sourceRepoUrl: course.sourceRepoUrl, sourceRef: course.sourceRef, importedAt: new Date(), ...(publish ? { status: "PUBLISHED" as const } : {}) },
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
            const data = { ...lesson, position: index + 1 };
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
        return tx.lesson.findMany({
          where: { module: { courseId: saved.id }, id: { notIn: [...kept] } },
          select: { slug: true, module: { select: { slug: true } } },
        });
      },
      { timeout: 60_000 },
    );
    if (removed.length) {
      console.log(`  no longer in the repository (kept, with any progress): ${removed.map((lesson) => `${lesson.module.slug}/${lesson.slug}`).join(", ")}`);
    }
    console.log(`  saved${publish ? " and published" : " (status unchanged; --publish shows a draft in the catalog)"}`);
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
  await save(course, values.publish);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
