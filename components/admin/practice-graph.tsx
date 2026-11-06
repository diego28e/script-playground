"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, CheckCheck, ListChecks, Pencil, Plus, Search, Sparkles, Square, Trash2, Undo2, Upload, X } from "lucide-react";
import {
  addSkill,
  approveAllLessons,
  deleteSkill,
  draftLessonSkills,
  publishPracticeGraph,
  setLessonApproval,
  setPrerequisite,
  updateSkill,
  writeSkillTask,
  type PracticeGraphData,
  type SkillInput,
} from "@/actions/practice";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PracticeDiscoveriesButton } from "@/components/admin/practice-discoveries";
import { SkillTasks } from "@/components/admin/practice-tasks";
import { Input } from "@/components/ui/input";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

// The practice graph's review tool (/admin/practice, docs/practice.md). Master-detail: the course's lessons on the
// left, the chosen lesson on the right, each scrolling on its own. Skills read as text first; one opens for editing
// at a time, with fields that grow to show all of their text. "Approve and next" walks the lessons left to review.

type Course = PracticeGraphData["courses"][number];
type Lesson = Course["modules"][number]["lessons"][number];
type Skill = Lesson["practiceSkills"][number];
type Lang = "es" | "en";
type Filter = "all" | "todo" | "review" | "approved";
type SkillRef = { id: string; key: string; labelEs: string; labelEn: string; lesson: string; order: number };

// Drafting starts with Claude Opus 5.5 (the platform's Anthropic credit); the list picks another starting model, and a
// model that fails passes the lesson to the ones after it (lib/ai/gemini.ts AUTHORING_CHAIN). Kept per browser.
const DEFAULT_MODEL = "claude-opus-5-5";
const MODEL_KEY = "practice-draft-model";
function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function storedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}
const plain = (text: string) => text.replaceAll("`", "").replaceAll("**", "");
const stateOf = (lesson: Lesson): Exclude<Filter, "all"> => (!lesson.practiceDraft ? "todo" : lesson.practiceDraft.status === "APPROVED" ? "approved" : "review");

const STATE = {
  todo: { label: "Not drafted", dot: "bg-muted-foreground/40" },
  review: { label: "To review", dot: "bg-amber-500" },
  approved: { label: "Approved", dot: "bg-emerald-500" },
} as const;

export function PracticeGraphEditor({ data }: { data: PracticeGraphData }) {
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? "");
  const course = data.courses.find((entry) => entry.id === courseId) ?? data.courses[0];
  if (!course) {
    return <p className="rounded-xl bg-muted/60 p-6 text-center text-sm text-muted-foreground">No courses yet. Import one first.</p>;
  }
  return (
    <CourseReview
      key={course.id}
      course={course}
      models={data.models}
      courses={data.courses.length > 1 ? data.courses.map(({ id, title }) => ({ id, title })) : null}
      onCourse={setCourseId}
    />
  );
}

function CourseReview({
  course,
  models,
  courses,
  onCourse,
}: {
  course: Course;
  models: PracticeGraphData["models"];
  courses: { id: string; title: string }[] | null;
  onCourse: (id: string) => void;
}) {
  const lessons = useMemo(() => course.modules.flatMap((courseModule) => courseModule.lessons), [course]);
  const counts = useMemo(() => {
    const result = { all: lessons.length, todo: 0, review: 0, approved: 0 };
    for (const lesson of lessons) result[stateOf(lesson)] += 1;
    return result;
  }, [lessons]);
  const approvedSkills = lessons.filter((lesson) => stateOf(lesson) === "approved").reduce((sum, lesson) => sum + lesson.practiceSkills.length, 0);

  // Every skill in course order: a skill's prerequisites can only come from before it.
  const skillRefs = useMemo(() => {
    const refs = new Map<string, SkillRef>();
    let order = 0;
    for (const lesson of lessons) {
      for (const skill of lesson.practiceSkills) {
        refs.set(skill.id, { id: skill.id, key: skill.key, labelEs: skill.labelEs, labelEn: skill.labelEn, lesson: lesson.code ?? "", order: order++ });
      }
    }
    return refs;
  }, [lessons]);

  // The stored choice is read as an external store: null on the server and in the first render (so the two agree),
  // the browser's value after hydration.
  const stored = useSyncExternalStore(subscribeStorage, storedModel, () => null);
  const [picked, setPicked] = useState<string | null>(null);
  const known = (value: string | null) => (value && models.some((entry) => entry.id === value) ? value : null);
  const model = known(picked) ?? known(stored) ?? DEFAULT_MODEL;
  const setModel = (value: string) => {
    setPicked(value);
    try {
      localStorage.setItem(MODEL_KEY, value);
    } catch {
      // Storage can be blocked; the choice then lasts until the page reloads.
    }
  };
  const [lang, setLang] = useState<Lang>("es");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const fromUrl = useSearchParams().get("lesson");
  const [selectedId, setSelectedId] = useState<string>(() => {
    return lessons.find((lesson) => lesson.id === fromUrl)?.id ?? lessons.find((lesson) => stateOf(lesson) === "review")?.id ?? lessons[0]?.id ?? "";
  });
  const select = useCallback((id: string) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("lesson", id);
    window.history.replaceState(null, "", url);
    // On a phone the lesson sits below the list: take the reader to it.
    if (window.matchMedia("(max-width: 767px)").matches) {
      requestAnimationFrame(() => {
        document.getElementById("lesson-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);
  const selected = lessons.find((lesson) => lesson.id === selectedId) ?? lessons[0];

  const [running, setRunning] = useState<string | null>(null);
  const stop = useRef(false);
  const [publishing, startPublish] = useTransition();
  const [approvingAll, startApproveAll] = useTransition();

  // Lessons with skills that still wait for review: what "Approve all" would approve.
  const reviewable = lessons.filter((lesson) => stateOf(lesson) === "review" && lesson.practiceSkills.length > 0).length;
  const { confirm, dialog } = useConfirm();
  const approveAll = async () => {
    const ok = await confirm({
      title: "Approve every lesson waiting for review?",
      detail: `${reviewable} ${reviewable === 1 ? "lesson" : "lessons"}`,
      description: "Any of them can go back to review later, and nothing reaches learners until you publish a version.",
      confirmLabel: "Approve all",
    });
    if (!ok) return;
    startApproveAll(async () => {
      const result = await approveAllLessons(course.id);
      if (!result.success) toast.error(result.error);
      else toast.success(`${result.approved} lessons approved.`);
    });
  };

  const draftRemaining = async () => {
    const todo = lessons.filter((lesson) => !lesson.practiceDraft);
    stop.current = false;
    for (const [index, lesson] of todo.entries()) {
      if (stop.current) break;
      setRunning(`Drafting ${lesson.code ?? ""}, ${index + 1} of ${todo.length}`);
      const result = await draftLessonSkills(lesson.id, model || undefined);
      if (!result.success) {
        toast.error(`${lesson.code}: ${result.error}`);
        if (/allowance/.test(result.error)) break;
      }
    }
    setRunning(null);
  };

  // Practice tasks: the published skills' stages that have no proven task yet.
  const missing = useMemo(
    () => Object.entries(course.stages).flatMap(([skillKey, stages]) => stages.filter((stage) => !(course.tasks[skillKey]?.[stage] ?? 0)).map((stage) => ({ skillKey, stage }))),
    [course.stages, course.tasks],
  );
  const writeMissing = async () => {
    stop.current = false;
    let written = 0;
    for (const [index, { skillKey, stage }] of missing.entries()) {
      if (stop.current) break;
      setRunning(`Writing a ${stage} task for ${skillKey}, ${index + 1} of ${missing.length}`);
      const result = await writeSkillTask(course.id, skillKey, stage);
      if (result.success) written += 1;
      else if (/allowance|Publish/.test(result.error)) {
        toast.error(result.error);
        break;
      }
    }
    setRunning(null);
    toast.success(`${written} tasks written and proven. Rejected candidates are kept under each skill; run again to fill what's left.`);
  };

  const publish = () =>
    startPublish(async () => {
      const result = await publishPracticeGraph(course.id);
      if (!result.success) {
        toast.error(result.error, { duration: 15000 });
        return;
      }
      toast.success(`Version ${result.version} published: ${result.skills} skills, ${result.edges} prerequisites.`);
      for (const warning of result.warnings.slice(0, 5)) toast.warning(warning, { duration: 12000 });
    });

  /** The next lesson after `id` that still waits for review, in course order (wrapping round). */
  const nextToReview = (id: string) => {
    const index = lessons.findIndex((lesson) => lesson.id === id);
    const after = [...lessons.slice(index + 1), ...lessons.slice(0, index)];
    return after.find((lesson) => stateOf(lesson) === "review");
  };

  const done = counts.approved / Math.max(1, counts.all);
  const drafted = (counts.review + counts.approved) / Math.max(1, counts.all);

  return (
    <div className="space-y-5">
      {dialog}
      {/* The course at a glance, and what applies to all of it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-2xl bg-muted/60 px-5 py-4">
        <div className="min-w-0 flex-1 basis-[26rem] space-y-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {courses ? (
              <select value={course.id} onChange={(event) => onCourse(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-base font-semibold">
                {courses.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
            ) : (
              <h3 className="text-lg font-semibold">{course.title}</h3>
            )}
            <span className="text-sm text-muted-foreground">
              {course.latest
                ? `Version ${course.latest.version} live since ${new Date(course.latest.publishedAt).toLocaleDateString()}, ${course.latest.skillCount} skills`
                : "Nothing published yet"}
            </span>
          </div>
          {/* Progress: approved over drafted over the whole course. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <div className="relative h-2 w-full max-w-56 overflow-hidden rounded-full bg-background" aria-hidden>
              <div className="absolute inset-y-0 left-0 bg-amber-500/50" style={{ width: `${drafted * 100}%` }} />
              <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${done * 100}%` }} />
            </div>
            <p className="text-sm">
              <span className="font-medium">{counts.approved}</span> of {counts.all} lessons approved ({approvedSkills} skills),{" "}
              <span className="font-medium">{counts.review}</span> to review, <span className="font-medium">{counts.todo}</span> not drafted
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Model
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              title="Drafting starts with this model; if it fails, the next ones in the list take over."
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          {running ? (
            <Button variant="outline" size="sm" onClick={() => (stop.current = true)}>
              <Square className="mr-2 h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={draftRemaining} disabled={counts.todo === 0}>
              <Sparkles className="mr-2 h-4 w-4" /> Draft {counts.todo} remaining
            </Button>
          )}
          {!running && course.latest && (
            <Button variant="outline" size="sm" onClick={writeMissing} disabled={missing.length === 0} title="One proven task for every stage of every published skill that has none yet">
              <ListChecks className="mr-2 h-4 w-4" /> Write {missing.length} missing tasks
            </Button>
          )}
          {course.latest && <PracticeDiscoveriesButton courseId={course.id} waiting={course.discovered} />}
          <Button variant="outline" size="sm" onClick={approveAll} disabled={approvingAll || reviewable === 0 || Boolean(running)}>
            <CheckCheck className="mr-2 h-4 w-4" /> {approvingAll ? "Approving…" : `Approve all ${reviewable}`}
          </Button>
          <Button size="sm" onClick={publish} disabled={publishing || counts.approved === 0 || Boolean(running)}>
            <Upload className="mr-2 h-4 w-4" /> {publishing ? "Publishing…" : `Publish version ${(course.latest?.version ?? 0) + 1}`}
          </Button>
        </div>
        {running && (
          <p className="flex w-full items-center gap-2 text-sm text-muted-foreground">
            <DotLoader /> {running}. The list fills in as each lesson is done.
          </p>
        )}
      </div>

      <div className="grid gap-5 md:h-[calc(100dvh-19.5rem)] md:min-h-[560px] md:grid-cols-[320px_minmax(0,1fr)]">
        <LessonRail
          course={course}
          counts={counts}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          selectedId={selected?.id}
          onSelect={select}
          lang={lang}
        />
        {selected && (
          <LessonDetail
            key={selected.id}
            lesson={selected}
            model={model}
            lang={lang}
            onLang={setLang}
            skillRefs={skillRefs}
            courseId={course.id}
            stages={course.stages}
            tasks={course.tasks}
            busy={Boolean(running)}
            onApproved={() => {
              const next = nextToReview(selected.id);
              if (next) select(next.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

function LessonRail({
  course,
  counts,
  filter,
  onFilter,
  query,
  onQuery,
  selectedId,
  onSelect,
  lang,
}: {
  course: Course;
  counts: Record<Filter, number>;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  query: string;
  onQuery: (query: string) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  lang: Lang;
}) {
  const needle = query.trim().toLowerCase();
  const matches = (lesson: Lesson) =>
    (filter === "all" || stateOf(lesson) === filter) &&
    (!needle ||
      `${lesson.code} ${plain(lesson.title)}`.toLowerCase().includes(needle) ||
      lesson.practiceSkills.some((skill) => `${skill.key} ${lang === "es" ? skill.labelEs : skill.labelEn}`.toLowerCase().includes(needle)));
  const selectedRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Keep the chosen lesson in view inside the list only. (scrollIntoView would also scroll the page, which on a phone
  // jumps past the header.)
  useEffect(() => {
    const list = listRef.current;
    const item = selectedRef.current;
    if (!list || !item) return;
    // The list is the item's offsetParent (it is `relative`), so offsetTop is measured from the list's top.
    const top = item.offsetTop;
    if (top < list.scrollTop + 32 || top + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 3);
    }
  }, [selectedId]);

  return (
    <nav aria-label="Lessons" className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-muted/60">
      <div className="space-y-2 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Find a lesson or skill" className="h-9 bg-background pl-8" />
        </div>
        <div role="tablist" aria-label="Show" className="grid grid-cols-4 gap-1 rounded-lg bg-background p-1 text-xs">
          {(
            [
              ["all", "All"],
              ["todo", "To draft"],
              ["review", "Review"],
              ["approved", "Done"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={filter === value}
              onClick={() => onFilter(value)}
              className={cn(
                "flex flex-col items-center rounded-md px-1 py-1 font-medium leading-tight transition-colors",
                filter === value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span>{label}</span>
              <span className="tabular-nums opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>
      <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-md:max-h-80">
        {course.modules.map((courseModule) => {
          const shown = courseModule.lessons.filter(matches);
          if (!shown.length) return null;
          return (
            <section key={courseModule.id} className="mb-2">
              <h4 className="sticky top-0 z-10 bg-muted px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                {String(courseModule.position).padStart(2, "0")} · {courseModule.title}
              </h4>
              <ul>
                {shown.map((lesson) => {
                  const state = stateOf(lesson);
                  const active = lesson.id === selectedId;
                  return (
                    <li key={lesson.id}>
                      <button
                        ref={active ? selectedRef : undefined}
                        type="button"
                        onClick={() => onSelect(lesson.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                          active ? "bg-background font-medium text-foreground" : "text-foreground/80 hover:bg-background/60",
                        )}
                      >
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATE[state].dot)} title={STATE[state].label} />
                        <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{lesson.code}</span>
                        <span className="min-w-0 flex-1 leading-snug">{plain(lesson.title)}</span>
                        {lesson.practiceSkills.length > 0 && <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{lesson.practiceSkills.length}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </nav>
  );
}

function LessonDetail({
  lesson,
  model,
  lang,
  onLang,
  skillRefs,
  courseId,
  stages,
  tasks,
  busy,
  onApproved,
}: {
  lesson: Lesson;
  model: string;
  lang: Lang;
  onLang: (lang: Lang) => void;
  skillRefs: Map<string, SkillRef>;
  courseId: string;
  stages: Course["stages"];
  tasks: Course["tasks"];
  busy: boolean;
  onApproved: () => void;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const state = stateOf(lesson);
  const usedLater = lesson.practiceSkills.reduce((sum, skill) => sum + skill._count.requiredBy, 0);

  const { confirm, dialog } = useConfirm();
  const draft = async () => {
    if (lesson.practiceSkills.length) {
      const ok = await confirm({
        title: `Redraft ${lesson.code}?`,
        detail: `${lesson.practiceSkills.length} skills replaced`,
        description: `The model writes this lesson's skills again. A skill that keeps its key keeps its place${usedLater ? `, with the ${usedLater} prerequisite links later lessons draw to it` : ""}; your edits to the others are lost.`,
        confirmLabel: "Redraft",
        tone: "danger",
      });
      if (!ok) return;
    }
    start(async () => {
      const result = await draftLessonSkills(lesson.id, model || undefined);
      if (!result.success) toast.error(result.error);
      else {
        toast.success(`${lesson.code}: ${result.skills} skills, ${result.edges} prerequisites, by ${result.model}.`);
        if (result.dropped.length) toast.warning(`Left out: ${result.dropped.join("; ")}`, { duration: 12000 });
      }
    });
  };
  const approve = (value: boolean) =>
    start(async () => {
      const result = await setLessonApproval(lesson.id, value);
      if (!result.success) toast.error(result.error);
      else if (value) onApproved();
    });
  const add = () =>
    start(async () => {
      const result = await addSkill(lesson.id);
      if (!result.success) toast.error(result.error);
    });

  // Keyboard: A approves and moves on, E edits the first skill. Not while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "a" && state === "review" && lesson.practiceSkills.length && !pending) approve(true);
      if (event.key === "e" && lesson.practiceSkills[0] && !editing) setEditing(lesson.practiceSkills[0].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <article id="lesson-detail" className="flex min-h-0 scroll-mt-4 flex-col overflow-hidden rounded-2xl bg-card">
      {dialog}
      <header className="space-y-3 bg-muted/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", STATE[state].dot)} />
              {lesson.code} · {STATE[state].label}
              {lesson.practiceDraft?.model && state !== "todo" ? ` · drafted by ${lesson.practiceDraft.model}` : ""}
            </p>
            <h3 className="mt-1 text-2xl font-semibold leading-tight tracking-tight">{plain(lesson.title)}</h3>
          </div>
          <div role="radiogroup" aria-label="Language" className="flex rounded-lg bg-background p-1 text-xs font-medium">
            {(["es", "en"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={lang === value}
                onClick={() => onLang(value)}
                className={cn("rounded-md px-2.5 py-1 transition-colors", lang === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {value === "es" ? "Español" : "English"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state === "review" && (
            <Button size="sm" onClick={() => approve(true)} disabled={pending} title="Shortcut: A">
              <Check className="mr-2 h-4 w-4" /> Approve and next <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
          {state === "approved" && (
            <Button size="sm" variant="outline" onClick={() => approve(false)} disabled={pending}>
              <Undo2 className="mr-2 h-4 w-4" /> Back to review
            </Button>
          )}
          <Button size="sm" variant={state === "todo" ? "default" : "outline"} onClick={draft} disabled={pending || busy}>
            <Sparkles className="mr-2 h-4 w-4" /> {lesson.practiceDraft ? "Redraft" : "Draft with the model"}
          </Button>
          <Button size="sm" variant="ghost" onClick={add} disabled={pending}>
            <Plus className="mr-2 h-4 w-4" /> Add skill
          </Button>
          {pending && <DotLoader />}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        {lesson.objectives.length > 0 && (
          <details className="group rounded-xl bg-muted/40 px-4 py-3 text-sm" open={lesson.practiceSkills.length === 0}>
            <summary className="cursor-pointer font-medium marker:text-muted-foreground">The lesson&apos;s {lesson.objectives.length} objectives</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
              {lesson.objectives.map((objective) => (
                <li key={objective}>{plain(objective)}</li>
              ))}
            </ol>
          </details>
        )}

        {lesson.practiceSkills.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">No skills yet. Draft them with the model, or add one by hand.</p>
        ) : (
          <ol className="space-y-3">
            {lesson.practiceSkills.map((skill) =>
              editing === skill.id ? (
                <SkillEditor key={skill.id} skill={skill} onClose={() => setEditing(null)} />
              ) : (
                <SkillView key={skill.id} skill={skill} lang={lang} skillRefs={skillRefs} onEdit={() => setEditing(skill.id)} courseId={courseId} stages={stages[skill.key]} taskCounts={tasks[skill.key] ?? {}} />
              ),
            )}
          </ol>
        )}
      </div>
    </article>
  );
}

function SkillView({
  skill,
  lang,
  skillRefs,
  onEdit,
  courseId,
  stages,
  taskCounts,
}: {
  skill: Skill;
  lang: Lang;
  skillRefs: Map<string, SkillRef>;
  onEdit: () => void;
  courseId: string;
  stages: string[] | undefined;
  taskCounts: Record<string, number>;
}) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const run = (action: () => Promise<{ success: boolean; error?: string }>) =>
    start(async () => {
      const result = await action();
      if (!result.success) toast.error(result.error ?? "That didn't work.");
    });
  const own = skillRefs.get(skill.id);
  const linked = new Set(skill.requires.map((edge) => edge.from.id));
  const candidates = [...skillRefs.values()].filter((entry) => own && entry.order < own.order && !linked.has(entry.id) && entry.id !== skill.id).reverse();
  const label = (ref: SkillRef | undefined, fallback: string) => (ref ? (lang === "es" ? ref.labelEs : ref.labelEn) : fallback);
  const { confirm, dialog } = useConfirm();
  const remove = async () => {
    const ok = await confirm({
      title: "Delete this skill?",
      detail: skill.key,
      description: `${lang === "es" ? skill.labelEs : skill.labelEn}${skill._count.requiredBy ? `. ${skill._count.requiredBy} later ${skill._count.requiredBy === 1 ? "skill loses" : "skills lose"} it as a prerequisite.` : "."}`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (ok) run(() => deleteSkill(skill.id));
  };

  return (
    <li className={cn("group rounded-xl bg-muted/40 p-4 transition-opacity", pending && "opacity-60")}>
      {dialog}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h4 className="text-base font-semibold leading-snug">{lang === "es" ? skill.labelEs : skill.labelEn}</h4>
          <p className="leading-relaxed">{lang === "es" ? skill.descriptionEs : skill.descriptionEn}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <code className="text-xs">{skill.key}</code>
            <span>{skill.knowledge === "PROCEDURAL" ? "Doing" : "Knowing"}</span>
            <span>{skill.runnable ? "Code tasks and questions" : "Questions only (needs a live service)"}</span>
            {skill._count.requiredBy > 0 && <span>Unlocks {skill._count.requiredBy} later</span>}
          </p>
          {skill.criteriaHint && <p className="text-sm text-muted-foreground">Grader hint: {skill.criteriaHint}</p>}
        </div>
        <div className="flex shrink-0 gap-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onEdit} aria-label={`Edit ${skill.key}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive" onClick={() => void remove()} aria-label={`Delete ${skill.key}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{skill.requires.length ? "Needs first" : "Needs nothing first"}</span>
        {skill.requires.map((edge) => {
          const ref = skillRefs.get(edge.from.id);
          const hard = edge.strength === "HARD";
          return (
            <span key={edge.id} className={cn("inline-flex max-w-full items-center rounded-lg text-sm", hard ? "bg-rose-500/12 text-rose-900 dark:text-rose-100" : "bg-sky-500/12 text-sky-900 dark:text-sky-100")} title={`${edge.from.key}${edge.reason ? `: ${edge.reason}` : ""}`}>
              <button
                type="button"
                onClick={() => run(() => setPrerequisite(skill.id, edge.from.id, hard ? "SOFT" : "HARD"))}
                className="rounded-l-lg px-2 py-1 font-semibold hover:bg-black/5 dark:hover:bg-white/10"
                title="Hard: locked until it is mastered. Soft: practised first. Click to switch."
              >
                {hard ? "Hard" : "Soft"}
              </button>
              <span className="truncate py-1 pr-1">
                {ref?.lesson ? `${ref.lesson} ` : ""}
                {label(ref, edge.from.labelEn)}
              </span>
              <button type="button" onClick={() => run(() => setPrerequisite(skill.id, edge.from.id, null))} className="rounded-r-lg px-1.5 py-1 opacity-60 hover:opacity-100" aria-label={`Remove ${edge.from.key}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
        {candidates.length > 0 &&
          (adding ? (
            <PrerequisitePicker
              candidates={candidates}
              lang={lang}
              onPick={(fromId, strength) => {
                setAdding(false);
                run(() => setPrerequisite(skill.id, fromId, strength));
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-muted-foreground hover:bg-background hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          ))}
      </div>
      <SkillTasks courseId={courseId} skillKey={skill.key} stages={stages} counts={taskCounts} lang={lang} />
    </li>
  );
}

/** A searchable list of the skills before this one, each addable as hard or soft. */
function PrerequisitePicker({
  candidates,
  lang,
  onPick,
  onCancel,
}: {
  candidates: SkillRef[];
  lang: Lang;
  onPick: (id: string, strength: "HARD" | "SOFT") => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = candidates.filter((entry) => !needle || `${entry.lesson} ${entry.key} ${entry.labelEs} ${entry.labelEn}`.toLowerCase().includes(needle)).slice(0, 8);
  return (
    <div className="w-full space-y-1 rounded-xl bg-background p-2" onKeyDown={(event) => event.key === "Escape" && onCancel()}>
      <div className="flex items-center gap-2">
        <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an earlier skill by lesson, name or key" className="h-8" />
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onCancel} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {shown.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
            <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{entry.lesson}</span>
            <span className="min-w-0 flex-1">{lang === "es" ? entry.labelEs : entry.labelEn}</span>
            <button type="button" onClick={() => onPick(entry.id, "HARD")} className="rounded-md bg-rose-500/12 px-2 py-0.5 text-xs font-semibold text-rose-900 hover:bg-rose-500/20 dark:text-rose-100">
              Hard
            </button>
            <button type="button" onClick={() => onPick(entry.id, "SOFT")} className="rounded-md bg-sky-500/12 px-2 py-0.5 text-xs font-semibold text-sky-900 hover:bg-sky-500/20 dark:text-sky-100">
              Soft
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-1.5 text-muted-foreground">No earlier skill matches.</li>}
      </ul>
    </div>
  );
}

/** A textarea that grows with its text, so nothing hides behind a scrollbar. */
function GrowingTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={cn(
        "block w-full resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

// Labels are one line that wraps: Enter doesn't add a line (Ctrl+Enter still saves).
const noNewline = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) event.preventDefault();
};

const fieldsOf = (skill: Skill): SkillInput => ({
  key: skill.key,
  labelEs: skill.labelEs,
  labelEn: skill.labelEn,
  descriptionEs: skill.descriptionEs,
  descriptionEn: skill.descriptionEn,
  knowledge: skill.knowledge,
  runnable: skill.runnable,
  criteriaHint: skill.criteriaHint,
});

function SkillEditor({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [form, setForm] = useState<SkillInput>(() => fieldsOf(skill));
  const [pending, start] = useTransition();
  const set = <K extends keyof SkillInput>(field: K, value: SkillInput[K]) => setForm((current) => ({ ...current, [field]: value }));
  const save = () =>
    start(async () => {
      const result = await updateSkill(skill.id, form);
      if (!result.success) toast.error(result.error);
      else onClose();
    });
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) save();
  };

  return (
    <li className="space-y-4 rounded-xl bg-muted/70 p-4 ring-2 ring-foreground/15" onKeyDown={onKeyDown}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Español</span>
          <GrowingTextarea value={form.labelEs} onChange={(event) => set("labelEs", event.target.value.replace(/\n/g, " "))} onKeyDown={noNewline} className="font-semibold" aria-label="Etiqueta" autoFocus />
          <GrowingTextarea value={form.descriptionEs} onChange={(event) => set("descriptionEs", event.target.value)} aria-label="Descripción" />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">English</span>
          <GrowingTextarea value={form.labelEn} onChange={(event) => set("labelEn", event.target.value.replace(/\n/g, " "))} onKeyDown={noNewline} className="font-semibold" aria-label="Label" />
          <GrowingTextarea value={form.descriptionEn} onChange={(event) => set("descriptionEn", event.target.value)} aria-label="Description" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Grader hint: how an answer shows this skill and not a neighbouring one</span>
        <GrowingTextarea value={form.criteriaHint ?? ""} onChange={(event) => set("criteriaHint", event.target.value || null)} />
      </label>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="font-medium">Key</span>
          <Input value={form.key} onChange={(event) => set("key", event.target.value)} className="h-8 w-72 bg-background font-mono text-xs" />
        </label>
        <div role="radiogroup" aria-label="Kind of knowledge" className="flex rounded-lg bg-background p-1 text-xs font-medium">
          {(
            [
              ["PROCEDURAL", "Doing"],
              ["DECLARATIVE", "Knowing"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.knowledge === value}
              onClick={() => set("knowledge", value)}
              className={cn("rounded-md px-2.5 py-1", form.knowledge === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {text}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.runnable} onChange={(event) => set("runnable", event.target.checked)} className="h-4 w-4" />
          Code tasks can practise it offline
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">Ctrl+Enter saves, Esc cancels</span>
      </div>
    </li>
  );
}
