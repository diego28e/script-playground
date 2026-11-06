"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Archive, Check, ChevronDown, Sparkles, X } from "lucide-react";
import { getSkillTasks, retireTask, writeSkillTask, type SkillTask } from "@/actions/practice";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

// A skill's practice tasks on the review page (docs/practice.md, "Tasks"): how many proven tasks each stage of its
// ladder has, a button to write one more, and every task (rejected ones with why) to read or retire.

type Lang = "es" | "en";

const FORM_LABEL: Record<string, string> = {
  choice: "Multiple choice",
  fill: "Fill the blank",
  predict: "Predict the output",
  code: "Write code",
  debug: "Fix the bug",
};

/** The stages line under a skill: counts per stage, and the panel when opened. */
export function SkillTasks({ courseId, skillKey, stages, counts, lang }: { courseId: string; skillKey: string; stages: string[] | undefined; counts: Record<string, number>; lang: Lang }) {
  const [open, setOpen] = useState(false);
  if (!stages?.length) {
    return <p className="mt-3 text-sm text-muted-foreground">Tasks: publish a version with this skill first.</p>;
  }
  const total = stages.reduce((sum, stage) => sum + (counts[stage] ?? 0), 0);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg py-1 text-sm hover:text-foreground">
        <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        <span className="font-medium">{total} {total === 1 ? "task" : "tasks"}</span>
        {stages.map((stage) => (
          <span key={stage} className={cn("tabular-nums", (counts[stage] ?? 0) === 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
            {stage} {counts[stage] ?? 0}
          </span>
        ))}
      </button>
      {open && <TasksPanel courseId={courseId} skillKey={skillKey} stages={stages} lang={lang} />}
    </div>
  );
}

function TasksPanel({ courseId, skillKey, stages, lang }: { courseId: string; skillKey: string; stages: string[]; lang: Lang }) {
  const [tasks, setTasks] = useState<SkillTask[] | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);

  const load = useCallback(() => {
    void getSkillTasks(courseId, skillKey).then(setTasks);
  }, [courseId, skillKey]);
  useEffect(load, [load]);

  const write = async (stage: string) => {
    setWriting(stage);
    const result = await writeSkillTask(courseId, skillKey, stage);
    setWriting(null);
    if (result.success) toast.success(`${FORM_LABEL[result.form] ?? result.form} task for ${stage}, by ${result.model}: ${result.note}.`);
    else toast.error(result.error, { duration: 10000 });
    load();
  };

  const proven = tasks?.filter((task) => task.status === "PROVEN") ?? [];
  const rejected = tasks?.filter((task) => task.status === "REJECTED") ?? [];

  return (
    <div className="mt-2 space-y-3 rounded-xl bg-background/70 p-3">
      <div className="flex flex-wrap gap-2">
        {stages.map((stage) => (
          <Button key={stage} size="sm" variant="outline" className="h-8" onClick={() => void write(stage)} disabled={writing !== null}>
            {writing === stage ? <DotLoader className="mr-2" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
            Write a {stage} task
          </Button>
        ))}
      </div>
      {writing && <p className="text-sm text-muted-foreground">Writing and proving a {writing} task: about 10 seconds…</p>}
      {tasks === null ? (
        <DotLoader />
      ) : proven.length === 0 ? (
        <p className="text-sm text-muted-foreground">No proven tasks yet.</p>
      ) : (
        <ul className="space-y-2">
          {proven.map((task) => (
            <TaskCard key={task.id} task={task} lang={lang} onRetired={load} />
          ))}
        </ul>
      )}
      {rejected.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowRejected(!showRejected)} className="text-sm text-muted-foreground hover:text-foreground">
            {showRejected ? "Hide" : "Show"} {rejected.length} rejected {rejected.length === 1 ? "candidate" : "candidates"}
          </button>
          {showRejected && (
            <ul className="mt-2 space-y-2">
              {rejected.map((task) => (
                <TaskCard key={task.id} task={task} lang={lang} onRetired={load} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const MARKDOWN = "text-sm leading-relaxed [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[0.85em] [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0";

function Code({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">{text}</pre>
    </div>
  );
}

function TaskCard({ task, lang, onRetired }: { task: SkillTask; lang: Lang; onRetired: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { confirm, dialog } = useConfirm();
  const c = task.content;
  const es = lang === "es";
  const options = (es ? c.optionsEs : c.optionsEn) ?? [];

  const retire = async () => {
    const ok = await confirm({ title: "Retire this task?", detail: FORM_LABEL[task.form] ?? task.form, description: "Learners won't get it any more. It stays in the database, marked retired.", confirmLabel: "Retire", tone: "danger" });
    if (!ok) return;
    start(async () => {
      const result = await retireTask(task.id);
      if (!result.success) toast.error(result.error);
      onRetired();
    });
  };

  return (
    <li className={cn("rounded-lg bg-muted/50 p-3", pending && "opacity-60")}>
      {dialog}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{FORM_LABEL[task.form] ?? task.form}</span>
        <span>{task.stage}</span>
        <span className="tabular-nums" title="A newcomer's chance of getting it right (lk-practice's difficulty, in logits)">
          {Math.round(100 / (1 + Math.exp(task.difficulty)))}% expected success
        </span>
        <span className="tabular-nums">about {task.expectedSeconds} s</span>
        <span>{task.model}</span>
        {task.status === "PROVEN" ? (
          <span className="text-emerald-700 dark:text-emerald-300">
            Proven{task.proof?.kind === "model-checked" ? ` (${task.proof.model} agreed)` : task.proof?.kind === "executable" ? " (ran on the grader)" : ""}
          </span>
        ) : (
          <span className="text-destructive">Rejected: {task.rejectReason}</span>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => setOpen(!open)} className="hover:text-foreground">
          {open ? "Less" : "Key and explanation"}
        </button>
        {task.status === "PROVEN" && (
          <button type="button" onClick={() => void retire()} className="inline-flex items-center gap-1 hover:text-destructive" aria-label="Retire this task">
            <Archive className="h-3.5 w-3.5" /> Retire
          </button>
        )}
      </div>
      <div className={cn("mt-2", MARKDOWN)}>
        <ReactMarkdown>{es ? c.promptEs : c.promptEn}</ReactMarkdown>
      </div>
      {task.form === "choice" && (
        <ol className="mt-2 space-y-1 text-sm">
          {options.map((option, index) => (
            <li key={index} className={cn("flex gap-2 rounded-md px-2 py-1", open && index === c.answerIndex && "bg-emerald-500/12")}>
              <span className="w-4 shrink-0 font-medium text-muted-foreground">{String.fromCharCode(65 + index)}</span>
              <span className="min-w-0 flex-1">{option}</span>
              {open && (index === c.answerIndex ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <X className="h-4 w-4 shrink-0 text-muted-foreground/50" />)}
            </li>
          ))}
        </ol>
      )}
      {open && (
        <div className="mt-3 space-y-3 text-sm">
          {task.form === "fill" && <p>Accepted: {c.answers?.map((answer) => <code key={answer} className="mr-2 rounded bg-muted px-1">{answer}</code>)}</p>}
          {task.form === "predict" && (
            <>
              <Code title="It prints" text={c.expectedOutput ?? ""} />
              <p className="text-muted-foreground">Likely wrong answer: <code className="rounded bg-muted px-1">{c.wrongOutput}</code></p>
            </>
          )}
          {(task.form === "code" || task.form === "debug") && (
            <>
              {task.form === "code" && c.code && <Code title="Starter" text={c.code} />}
              {c.tests && <Code title="Tests (hidden from the learner)" text={c.tests} />}
              {c.solution && <Code title="Reference solution" text={c.solution} />}
              {c.wrongSolution && <Code title="Wrong solution (must fail)" text={c.wrongSolution} />}
            </>
          )}
          <div className={cn("rounded-lg bg-background/60 p-3", MARKDOWN)}>
            <ReactMarkdown>{es ? c.explanationEs : c.explanationEn}</ReactMarkdown>
          </div>
        </div>
      )}
    </li>
  );
}
