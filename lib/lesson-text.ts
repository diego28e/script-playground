// A lesson's own text, for the AI work that reads a lesson: drafting its practice skills (lib/practice/draft.ts), writing
// its audio narration (lib/lesson-audio/script.ts), and the teachers that talk about it. A reading's body is in the
// database; a notebook is read from the course repository at the commit the course was imported from.

/** Cuts text that runs past `max`, saying how much was left out. */
export const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text);

/** The notebook as text: Markdown cells whole, code cells shortened, outputs left out. */
export function notebookText(raw: string): string {
  const cells = (JSON.parse(raw) as { cells?: { cell_type: string; source: string | string[] }[] }).cells ?? [];
  return cells
    .map((cell) => {
      const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
      return cell.cell_type === "code" ? `\`\`\`python\n${clipText(source, 1500)}\n\`\`\`` : source;
    })
    .join("\n\n");
}

/** The lesson's own text, whole: the reading's body, or its notebook from the course repository. */
export async function lessonSource(
  course: { sourceRepoUrl: string | null; sourceRef: string | null },
  lesson: { body: string | null; sourcePath: string | null },
): Promise<string | null> {
  if (lesson.body) return lesson.body;
  const repo = course.sourceRepoUrl?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];
  if (!repo || !course.sourceRef || !lesson.sourcePath) return null;
  const url = `https://raw.githubusercontent.com/${repo}/${course.sourceRef}/${lesson.sourcePath.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  const raw = await response.text();
  try {
    return lesson.sourcePath.endsWith(".ipynb") ? notebookText(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * The lesson's own text, at most `limit` characters, cut from its start. An interview-challenge lesson is better read
 * in parts: lessonTextFor (lib/lesson-sections.ts).
 */
export async function lessonText(
  course: { sourceRepoUrl: string | null; sourceRef: string | null },
  lesson: { body: string | null; sourcePath: string | null },
  limit: number,
): Promise<string | null> {
  const text = await lessonSource(course, lesson);
  return text === null ? null : clipText(text, limit);
}
