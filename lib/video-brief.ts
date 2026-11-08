import { prisma } from "@/lib/prisma";

// A lesson's video brief (docs/lesson-videos.md): everything the platform knows about one lesson, in one Markdown file
// for the session that makes its video (with the studio's TEACHING-VIDEO-GUIDE.md). The lesson and its place in the
// course; its skills from the skill graph, in teaching order, with what each builds on and what shows it was learned;
// where learners actually stumble (prerequisites practice found missing, what they asked the tutor to practise, the
// misconceptions and struggles the tutor noted, the skills they fail most in practice), aggregated, never naming
// anyone; and the notebook itself with its real outputs, and the reference solution, from the course repository at
// the commit the platform imported.

const OUTPUT_LIMIT = 2_000;
const NOTEBOOK_LIMIT = 120_000;
const MAX_NOTES = 25;

type NotebookCell = {
  cell_type: string;
  source: string | string[];
  execution_count?: number | null;
  outputs?: { output_type: string; name?: string; text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string }[];
};

const join = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join("") : (value ?? ""));
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text);
const plain = (text: string) => text.replaceAll("`", "");

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return groups;
}

/** A notebook as Markdown: markdown cells as they are, code cells fenced with their run number, then their outputs. */
function notebookMarkdown(raw: string): string {
  const cells = (JSON.parse(raw) as { cells?: NotebookCell[] }).cells ?? [];
  const parts = cells.map((cell, index) => {
    const source = join(cell.source).trimEnd();
    if (cell.cell_type !== "code") return `<!-- cell ${index + 1} · markdown -->\n${source}`;
    const outputs = (cell.outputs ?? [])
      .map((output) => {
        if (output.output_type === "stream") return join(output.text);
        if (output.output_type === "error") return `${output.ename}: ${output.evalue}`;
        const data = output.data ?? {};
        if (data["text/plain"]) return join(data["text/plain"]);
        if (Object.keys(data).some((type) => type.startsWith("image/"))) return "(an image: a chart or picture)";
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trimEnd();
    const run = cell.execution_count ? `[${cell.execution_count}]` : "[ ]";
    return `<!-- cell ${index + 1} · code ${run} -->\n\`\`\`python\n${source}\n\`\`\`${outputs ? `\n\nOutput:\n\n\`\`\`text\n${clip(outputs, OUTPUT_LIMIT)}\n\`\`\`` : ""}`;
  });
  return clip(parts.join("\n\n"), NOTEBOOK_LIMIT);
}

/** A file of the course repository at the imported commit, or null. */
async function repoFile(course: { sourceRepoUrl: string | null; sourceRef: string | null }, path: string): Promise<string | null> {
  const repo = course.sourceRepoUrl?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];
  if (!repo || !course.sourceRef) return null;
  const url = `https://raw.githubusercontent.com/${repo}/${course.sourceRef}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" }).catch(() => null);
  return response?.ok ? response.text() : null;
}

export type LessonBrief = {
  markdown: string;
  filename: string;
  lesson: { id: string; code: string | null; title: string };
  counts: { skills: number; notebookCells: number; solution: boolean; stumbling: number; practiceAnswers: number; tutorSessions: number };
};

export async function buildLessonBrief(lessonId: string): Promise<LessonBrief | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      code: true,
      slug: true,
      title: true,
      kind: true,
      estimatedTime: true,
      prerequisites: true,
      objectives: true,
      sourcePath: true,
      body: true,
      practiceDraft: { select: { status: true } },
      module: {
        select: {
          position: true,
          title: true,
          course: {
            select: {
              id: true,
              title: true,
              sourceRepoUrl: true,
              sourceRef: true,
              modules: { orderBy: { position: "asc" }, select: { position: true, title: true, lessons: { orderBy: { position: "asc" }, select: { id: true, code: true, title: true, objectives: true } } } },
            },
          },
        },
      },
    },
  });
  if (!lesson) return null;
  const course = lesson.module.course;
  const ordered = course.modules.flatMap((courseModule) => courseModule.lessons.map((entry) => ({ ...entry, module: courseModule })));
  const at = ordered.findIndex((entry) => entry.id === lesson.id);
  const previous = at > 0 ? ordered[at - 1] : null;
  const next = at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : null;

  const skills = await prisma.practiceSkill.findMany({
    where: { lessonId },
    orderBy: { position: "asc" },
    select: {
      key: true,
      labelEn: true,
      labelEs: true,
      descriptionEn: true,
      knowledge: true,
      runnable: true,
      criteriaHint: true,
      requires: { select: { strength: true, reason: true, from: { select: { key: true, labelEn: true, lesson: { select: { code: true, title: true } } } } } },
      requiredBy: { select: { to: { select: { key: true, labelEn: true, lesson: { select: { code: true, title: true } } } } } },
    },
  });
  const keys = skills.map((skill) => skill.key);

  const sessions = await prisma.tutorSession.findMany({ where: { lessonId }, select: { id: true, userId: true } });
  const [discovered, foundHere, requests, notes, tasks, tutorMessages] = await Promise.all([
    keys.length ? prisma.practiceDiscoveredEdge.findMany({ where: { courseId: course.id, toKey: { in: keys }, status: { not: "DISMISSED" } } }) : [],
    prisma.practiceFoundSkill.findMany({ where: { courseId: course.id, lessonId }, select: { key: true, labelEn: true, origin: true, context: true } }),
    prisma.practiceRequest.findMany({ where: { lessonId }, select: { skill: true, evidence: true, userId: true } }),
    sessions.length
      ? prisma.learnerMemory.findMany({
          where: { sourceSessionId: { in: sessions.map((session) => session.id) }, kind: { in: ["MISCONCEPTION", "STRUGGLE"] } },
          orderBy: { validFrom: "desc" },
          take: 200,
          select: { kind: true, subject: true, fact: true, userId: true },
        })
      : [],
    keys.length ? prisma.practiceTask.findMany({ where: { courseId: course.id, skillKey: { in: keys } }, select: { id: true, skillKey: true } }) : [],
    sessions.length ? prisma.tutorMessage.count({ where: { sessionId: { in: sessions.map((session) => session.id) }, role: "learner" } }) : 0,
  ]);
  const foundRows = await prisma.practiceFoundSkill.findMany({
    where: { courseId: course.id, key: { in: discovered.map((edge) => edge.fromKey) } },
    select: { key: true, labelEn: true, origin: true },
  });
  // A skill made from a tutor request is listed with what learners asked the tutor for, not as one practice found.
  const tutorKeys = new Set(foundRows.filter((row) => row.origin === "TUTOR").map((row) => row.key));
  const diagnosed = discovered.filter((edge) => !tutorKeys.has(edge.fromKey));
  const answers = tasks.length ? await prisma.practiceAnswer.findMany({ where: { taskId: { in: tasks.map((task) => task.id) } }, select: { taskId: true, passed: true } }) : [];
  const skillOfTask = new Map(tasks.map((task) => [task.id, task.skillKey]));
  const results = new Map<string, { answers: number; passed: number }>();
  for (const answer of answers) {
    const key = skillOfTask.get(answer.taskId);
    if (!key) continue;
    const entry = results.get(key) ?? { answers: 0, passed: 0 };
    entry.answers++;
    if (answer.passed) entry.passed++;
    results.set(key, entry);
  }

  // The notebook and its reference solution (beside it, in solutions/<name>-solution.ipynb), at the imported commit.
  let notebook: string | null = null;
  let solution: string | null = null;
  let cells = 0;
  let withOutputs = 0;
  if (lesson.sourcePath?.endsWith(".ipynb")) {
    const raw = await repoFile(course, lesson.sourcePath);
    if (raw) {
      try {
        const parsed = (JSON.parse(raw) as { cells?: NotebookCell[] }).cells ?? [];
        cells = parsed.length;
        withOutputs = parsed.filter((cell) => (cell.outputs ?? []).length > 0).length;
        notebook = notebookMarkdown(raw);
      } catch {
        notebook = null;
      }
    }
    const folder = lesson.sourcePath.split("/").slice(0, -1).join("/");
    const stem = lesson.sourcePath.split("/").at(-1)!.replace(/\.ipynb$/, "");
    const rawSolution = await repoFile(course, `${folder}/solutions/${stem}-solution.ipynb`);
    if (rawSolution) {
      try {
        solution = notebookMarkdown(rawSolution);
      } catch {
        solution = null;
      }
    }
  }

  const label = (key: string) => skills.find((skill) => skill.key === key)?.labelEn ?? key;
  const named = (entry: { code: string | null; title: string }) => [entry.code, plain(entry.title)].filter(Boolean).join(" ");
  const objectivesOf = (entry: { objectives: string[] }) =>
    entry.objectives.length ? `. Its objectives: ${entry.objectives.map((objective) => plain(objective).replace(/[.;\s]+$/, "")).join("; ")}.` : "";
  const learners = (rows: { userId: string }[]) => new Set(rows.map((row) => row.userId)).size;
  const requestGroups = [...groupBy(requests, (request) => request.skill.trim().toLowerCase())].map(([, rows]) => ({ skill: rows[0].skill, learners: learners(rows), rows }));
  const noteGroups = [...groupBy(notes, (note) => `${note.kind}:${note.subject.trim().toLowerCase()}`)].map(([, rows]) => ({
    kind: rows[0].kind,
    subject: rows[0].subject,
    fact: rows[0].fact,
    learners: learners(rows),
  }));
  noteGroups.sort((a, b) => b.learners - a.learners);
  const stumbling = diagnosed.length + foundHere.length + requestGroups.length + noteGroups.length;

  const lines: string[] = [];
  const push = (...text: string[]) => lines.push(...text);
  push(
    `# Video brief · ${lesson.code ?? ""} ${plain(lesson.title)}`.replace("·  ", "· "),
    "",
    `Everything the platform knows about this lesson, for the session that makes its video: read it together with the studio's \`TEACHING-VIDEO-GUIDE.md\`. Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from academiadelcodigo.com; the notebook comes from the course repository at commit \`${course.sourceRef?.slice(0, 12) ?? "unknown"}\`. Learner data is aggregated and never names anyone.`,
    "",
    "## At a glance",
    "",
    "| | |",
    "|---|---|",
    `| Course | ${course.title} |`,
    `| Module | ${String(lesson.module.position).padStart(2, "0")} · ${lesson.module.title} |`,
    `| Lesson | ${lesson.code ?? ""} · ${plain(lesson.title)} (${at + 1} of ${ordered.length}) |`,
    `| Kind | ${lesson.kind.toLowerCase()}${lesson.estimatedTime ? `, ${lesson.estimatedTime}` : ""} |`,
    `| Notebook | ${lesson.sourcePath ?? "(none)"}${notebook ? ` (${cells} cells)` : lesson.sourcePath ? " (couldn't be fetched)" : ""} |`,
    `| Reference solution | ${solution ? "included below" : "none in the repository"} |`,
    `| Skills | ${skills.length}${lesson.practiceDraft ? ` (review: ${lesson.practiceDraft.status.toLowerCase()})` : ""} |`,
    `| Learner activity | ${sessions.length} tutor conversations (${learners(sessions)} learners, ${tutorMessages} questions); ${answers.length} practice answers |`,
    "",
    "## Where it sits in the course",
    "",
    previous ? `- **Before:** ${named(previous)}${objectivesOf(previous)}` : "- **Before:** this is the course's first lesson.",
    `- **This lesson:** ${named(lesson)}`,
    next ? `- **Next:** ${named(next)}${objectivesOf(next)}` : "- **Next:** this is the course's last lesson.",
    "",
    "## Objectives",
    "",
    ...(lesson.objectives.length ? lesson.objectives.map((objective) => `- ${objective}`) : ["(none listed)"]),
    "",
    "## Before you start (the lesson's prerequisites)",
    "",
    lesson.prerequisites ?? "(none listed)",
    "",
    "## Skills to teach, in order",
    "",
    "The lesson's skills from the platform's skill graph, the same ones learners practise afterwards. A video that teaches each of them, in this order, prepares learners for exactly what practice will ask.",
    "",
  );
  if (!skills.length) push("(No skills drafted for this lesson yet: teach from the objectives.)", "");
  skills.forEach((skill, index) => {
    const result = results.get(skill.key);
    push(
      `### ${index + 1}. ${skill.labelEn}`,
      "",
      `- **Key:** \`${skill.key}\` · Spanish label (for the subtitles): ${skill.labelEs}`,
      `- **What it is:** ${skill.descriptionEn}`,
      `- **Kind:** ${skill.knowledge === "PROCEDURAL" ? "procedural (how to do something: show it done, step by step)" : "declarative (a fact or concept: explain it, then show it at work)"}${skill.runnable ? "; runnable offline, practised with code" : "; practised with questions"}`,
      ...(skill.criteriaHint ? [`- **What shows it was learned:** ${skill.criteriaHint}`] : []),
      ...(skill.requires.length
        ? [`- **Builds on:** ${skill.requires.map((edge) => `${edge.from.labelEn} (${edge.from.lesson.code ?? edge.from.lesson.title}, ${edge.strength.toLowerCase()}${edge.reason ? `: ${edge.reason}` : ""})`).join("; ")}`]
        : []),
      ...(skill.requiredBy.length ? [`- **Used later by:** ${skill.requiredBy.map((edge) => `${edge.to.labelEn} (${edge.to.lesson.code ?? edge.to.lesson.title})`).join("; ")}`] : []),
      `- **In practice so far:** ${result ? `${result.answers} answers, ${Math.round((result.passed / result.answers) * 100)}% right` : "no answers yet"}`,
      "",
    );
  });

  push("## Where learners stumble", "", "What the platform has seen while learners worked on this lesson. Address these in the video: name the trap, show it, show the way out.", "");
  if (!stumbling && !results.size) push("(Nothing recorded yet: no learner has struggled here on the platform so far.)", "");
  if (diagnosed.length) {
    push("### Prerequisites found missing", "", "Skills that practice found some learners lacked when they kept failing this lesson's skills:", "");
    const count = (n: number) => `${n} learner${n === 1 ? "" : "s"}`;
    for (const edge of diagnosed) {
      const row = foundRows.find((found) => found.key === edge.fromKey);
      push(`- **${row?.labelEn ?? label(edge.fromKey)}**, needed for "${label(edge.toKey)}" (suspected for ${count(edge.opened)}, confirmed for ${count(edge.confirmed)})${edge.rationale ? `: ${edge.rationale}` : ""}`);
    }
    push("");
  }
  const tutorSkills = foundHere.filter((row) => row.origin === "TUTOR");
  if (tutorSkills.length || requestGroups.length) {
    push("### What learners asked the tutor to practise", "");
    for (const row of tutorSkills) push(`- **${row.labelEn}**${row.context ? `. The tutor's challenge for it: ${row.context}` : ""}`);
    for (const group of requestGroups) push(`- "${group.skill}" (${group.learners} learner${group.learners === 1 ? "" : "s"}; ${group.rows.map((row) => row.evidence.toLowerCase()).join(", ")})`);
    push("");
  }
  if (noteGroups.length) {
    push("### Misconceptions and struggles the tutor noted", "");
    for (const group of noteGroups.slice(0, MAX_NOTES)) push(`- *${group.kind === "MISCONCEPTION" ? "Misconception" : "Struggle"}* · ${group.subject}: ${group.fact} (${group.learners} learner${group.learners === 1 ? "" : "s"})`);
    push("");
  }
  const weakest = [...results].filter(([, result]) => result.answers >= 3).sort(([, a], [, b]) => a.passed / a.answers - b.passed / b.answers);
  if (weakest.length) {
    push("### Hardest skills in practice", "");
    for (const [key, result] of weakest.slice(0, 3)) push(`- ${label(key)}: ${Math.round((result.passed / result.answers) * 100)}% right over ${result.answers} answers`);
    push("");
  }

  push(
    "## The notebook",
    "",
    withOutputs
      ? "The lesson as learners see it in the lab, with the outputs it was saved with. Demonstrate this code; the video's examples should run exactly like this."
      : "The lesson as learners see it in the lab. The repository saves notebooks without outputs: run the cells (in the course's lc-mastery environment, with real keys where a cell calls a provider) and show the real output, never an invented one.",
    "",
  );
  if (notebook) push(notebook, "");
  else if (lesson.body) push(clip(lesson.body, NOTEBOOK_LIMIT), "");
  else push("(Not available.)", "");
  if (solution) push("## Reference solution", "", "How the exercises are meant to be solved. Learners have it too, in the lab's solutions folder: show the reasoning, not a copy of it.", "", solution, "");

  return {
    markdown: lines.join("\n"),
    filename: `${lesson.slug}.BRIEF.md`,
    lesson: { id: lesson.id, code: lesson.code, title: lesson.title },
    counts: { skills: skills.length, notebookCells: cells, solution: Boolean(solution), stumbling, practiceAnswers: answers.length, tutorSessions: sessions.length },
  };
}
