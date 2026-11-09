"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { findPracticeTasks, getPracticeTaskForEdit, type FoundTask, type TaskFilters, type TaskFinderOptions } from "@/actions/practice-tasks";
import { FORM_LABEL, TaskCard } from "@/components/admin/practice-tasks";
import { TaskModelsContext } from "@/components/admin/practice-task-editor";
import { Button } from "@/components/ui/button";
import { DotLoader } from "@/components/ui/dot-loader";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

// Every practice task of a course, to find and fix (docs/practice.md, "Finding and fixing a task"): search its words
// (either language), narrow by lesson, skill, form, stage and status, and sort by how learners did, so the task a
// learner found wrong or confusing is one search away. The filters live in the address, so a search can be shared;
// `?task=<id>` opens that task in the editor (the practice page's Edit sends admins here when it can't open in place).

const STAGES = ["recognise", "recall", "produce", "apply", "example", "complete", "write", "transfer"];
const STATUSES = [
  { value: "PROVEN", label: "In use" },
  { value: "REJECTED", label: "Rejected" },
  { value: "RETIRED", label: "Retired" },
  { value: "ALL", label: "All" },
] as const;
const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "missed", label: "Most missed first" },
  { value: "answered", label: "Most answered first" },
] as const;

type Result = Awaited<ReturnType<typeof findPracticeTasks>>;
type Lang = "es" | "en";

const SELECT = "h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** How learners did on a task, coloured when it looks like the task (not the learners) may be the problem. */
function Stats({ stats }: { stats: FoundTask["stats"] }) {
  if (!stats.answers) return <span className="text-muted-foreground">No answers yet</span>;
  const rate = Math.round((stats.passed / stats.answers) * 100);
  const suspicious = stats.answers >= 3 && rate < 40;
  return (
    <Tip content={suspicious ? "Most learners miss it: check the wording and the key" : `${stats.passed} of ${stats.answers} answers right`}>
      <span className={cn("tabular-nums", suspicious ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
        {stats.answers} {stats.answers === 1 ? "answer" : "answers"} · {rate}% right
      </span>
    </Tip>
  );
}

export function PracticeTaskFinder({ options, models }: { options: TaskFinderOptions; models: { id: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [lang, setLang] = useState<Lang>("en");

  const filters: Required<Omit<TaskFilters, "page">> = {
    courseId: params.get("course") ?? options[0]?.id ?? "",
    q: params.get("q") ?? "",
    lessonId: params.get("lesson") ?? "",
    skillKey: params.get("skill") ?? "",
    stage: params.get("stage") ?? "",
    form: params.get("form") ?? "",
    status: (params.get("status") as TaskFilters["status"]) ?? "PROVEN",
    sort: (params.get("sort") as TaskFilters["sort"]) ?? "newest",
  };
  const linked = params.get("task");

  // The search box answers as you type; the address follows a moment later.
  const [query, setQuery] = useState(filters.q);
  const set = useCallback(
    (change: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(change)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  useEffect(() => {
    if (query === filters.q) return;
    const timer = setTimeout(() => set({ q: query.trim() }), 300);
    return () => clearTimeout(timer);
  }, [query, filters.q, set]);

  const course = options.find((entry) => entry.id === filters.courseId);
  const lesson = course?.lessons.find((entry) => entry.id === filters.lessonId);
  const skills = lesson ? lesson.skills : (course?.lessons.flatMap((entry) => entry.skills) ?? []);

  // Results: the first page for these filters, and more pages as asked.
  const key = JSON.stringify(filters);
  const [result, setResult] = useState<{ key: string; data: Result; pages: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void findPracticeTasks({ ...filters, page: 0 }).then((data) => !cancelled && setResult({ key, data, pages: 1 }));
    return () => {
      cancelled = true;
    };
    // `key` stands for every filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  const loading = result?.key !== key;

  const more = async () => {
    if (!result) return;
    setLoadingMore(true);
    const data = await findPracticeTasks({ ...filters, page: result.pages });
    setLoadingMore(false);
    setResult({ key, data: { ...data, tasks: [...result.data.tasks, ...data.tasks] }, pages: result.pages + 1 });
  };

  // A task linked by its id opens in the editor, above the list.
  const [linkedTask, setLinkedTask] = useState<{ id: string; task: Awaited<ReturnType<typeof getPracticeTaskForEdit>> } | null>(null);
  useEffect(() => {
    if (!linked) return;
    let cancelled = false;
    void getPracticeTaskForEdit(linked).then((task) => !cancelled && setLinkedTask({ id: linked, task }));
    return () => {
      cancelled = true;
    };
  }, [linked]);

  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = Boolean(filters.q || filters.lessonId || filters.skillKey || filters.stage || filters.form || filters.status !== "PROVEN");

  if (!course) return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No practice tasks yet.</p>;

  return (
    <TaskModelsContext.Provider value={models}>
      <div className="space-y-5">
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[16rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search the tasks' words, in English or Spanish (“free tier”, “Gemini”…)"
                aria-label="Search the tasks"
                className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    set({ q: "" });
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear the search"
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {options.length > 1 && (
              <select aria-label="Course" className={SELECT} value={filters.courseId} onChange={(event) => set({ course: event.target.value, lesson: "", skill: "" })}>
                {options.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
            )}
            <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label="Language shown">
              {(["en", "es"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={lang === code}
                  onClick={() => setLang(code)}
                  className={cn("rounded-md px-2.5 py-1.5 font-medium uppercase", lang === code ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Lesson" className={cn(SELECT, "max-w-[18rem]")} value={filters.lessonId} onChange={(event) => set({ lesson: event.target.value, skill: "" })}>
              <option value="">Every lesson</option>
              {course.lessons.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code ? `${entry.code} ` : ""}
                  {entry.title}
                </option>
              ))}
            </select>
            <select aria-label="Skill" className={cn(SELECT, "max-w-[18rem]")} value={filters.skillKey} onChange={(event) => set({ skill: event.target.value })}>
              <option value="">Every skill</option>
              {skills.map((skill) => (
                <option key={skill.key} value={skill.key}>
                  {skill.label}
                </option>
              ))}
            </select>
            <select aria-label="Form" className={SELECT} value={filters.form} onChange={(event) => set({ form: event.target.value })}>
              <option value="">Every form</option>
              {Object.entries(FORM_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select aria-label="Stage" className={SELECT} value={filters.stage} onChange={(event) => set({ stage: event.target.value })}>
              <option value="">Every stage</option>
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
            <div className="inline-flex rounded-lg bg-muted p-0.5" role="group" aria-label="Status">
              {STATUSES.map((status) => (
                <button
                  key={status.value}
                  type="button"
                  aria-pressed={filters.status === status.value}
                  onClick={() => set({ status: status.value === "PROVEN" ? "" : status.value })}
                  className={cn("rounded-md px-2.5 py-1.5 text-xs font-medium", filters.status === status.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {status.label}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <select aria-label="Sort" className={SELECT} value={filters.sort} onChange={(event) => set({ sort: event.target.value === "newest" ? "" : event.target.value })}>
              {SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>
                  {sort.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {linked && linkedTask?.id === linked && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">The task you opened</h3>
              <button type="button" onClick={() => set({ task: "" })} className="text-xs text-muted-foreground hover:text-foreground">
                Close
              </button>
            </div>
            {linkedTask.task ? (
              <ul>
                <TaskCard key={linked} task={linkedTask.task} lang={lang} defaultEditing onRetired={() => set({ task: "" })} />
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">That task doesn&apos;t exist any more.</p>
            )}
          </section>
        )}

        <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
          {loading ? <DotLoader /> : <span className="tabular-nums">{result?.data.total ?? 0} {result?.data.total === 1 ? "task" : "tasks"}</span>}
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                router.replace(`${pathname}${options.length > 1 ? `?course=${filters.courseId}` : ""}`, { scroll: false });
              }}
              className="hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>

        {result && !loading && result.data.tasks.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No task matches. Try fewer words, or another status.
          </p>
        )}

        <ul className={cn("space-y-3 transition-opacity", loading && "opacity-50")}>
          {result?.data.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              lang={lang}
              onRetired={() => setVersion((value) => value + 1)}
              context={
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {task.skill.lesson && (
                    <button
                      type="button"
                      onClick={() => {
                        const found = course.lessons.find((entry) => entry.code === task.skill.lesson?.code);
                        if (found) set({ lesson: found.id, skill: "" });
                      }}
                      className="font-mono text-muted-foreground hover:text-foreground"
                    >
                      {task.skill.lesson.code}
                    </button>
                  )}
                  <button type="button" onClick={() => set({ skill: task.skill.key })} className="font-medium text-foreground hover:underline">
                    {task.skill.label}
                  </button>
                  <span className="text-muted-foreground/50" aria-hidden="true">
                    ·
                  </span>
                  <Stats stats={task.stats} />
                  {task.editedFromId && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">edited</span>}
                </div>
              }
            />
          ))}
        </ul>

        {result && !loading && result.data.tasks.length < result.data.total && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void more()} loading={loadingMore} loadingLabel="Loading">
              Show {Math.min(result.data.pageSize, result.data.total - result.data.tasks.length)} more
            </Button>
          </div>
        )}
      </div>
    </TaskModelsContext.Provider>
  );
}
