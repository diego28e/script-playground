"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, X } from "lucide-react";
import { getPracticeJob, startPracticeJob, stopPracticeJobAction } from "@/actions/practice-jobs";
import type { PracticeJobView } from "@/lib/practice/jobs";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

// A course's practice job on the admin page (lib/practice/jobs.ts, docs/practice.md "Jobs"): the practice worker on
// the lab server does the work; this page starts it, stops it and shows how it's going, polling every few seconds
// while it runs. The page can be closed: the job carries on, and opening the page again shows where it is.

const POLL_MS = 3_000;
const DISMISSED_KEY = "adc.practiceJob.dismissed";

const duration = (seconds: number) =>
  seconds < 90 ? `${Math.max(1, Math.round(seconds))} s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** The course's latest job, kept fresh while it runs, with start and stop. */
export function usePracticeJob(courseId: string) {
  const router = useRouter();
  const [job, setJob] = useState<PracticeJobView | null>(null);
  const [starting, setStarting] = useState(false);
  const wasActive = useRef(false);

  const refresh = useCallback(async () => {
    const next = await getPracticeJob(courseId).catch(() => undefined);
    if (next === undefined) return; // A network blip: the next poll tries again.
    setJob(next);
  }, [courseId]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(first);
  }, [refresh]);
  useEffect(() => {
    if (!job?.active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [job?.active, refresh]);
  // When a job ends, the page's counts (tasks per stage, drafted lessons) are read again.
  useEffect(() => {
    if (wasActive.current && job && !job.active) router.refresh();
    wasActive.current = Boolean(job?.active);
  }, [job, router]);

  const start = async (kind: "WRITE_TASKS" | "DRAFT_LESSONS", model?: string) => {
    setStarting(true);
    const result = await startPracticeJob(courseId, kind, model).catch(() => null);
    setStarting(false);
    if (!result?.success) {
      toast.error(result?.error ?? "The job couldn't be started. Try again.");
      return;
    }
    setJob(result.job);
    toast.success(`Started: ${result.job.total} ${kind === "WRITE_TASKS" ? "tasks to write" : "lessons to draft"} on the server. You can close this page.`);
  };

  const stop = async () => {
    if (!job?.active) return;
    // Shown at once; the worker finishes the items in progress, then the job reads "Stopped".
    setJob({ ...job, status: job.status === "QUEUED" ? "STOPPED" : "STOPPING", active: job.status !== "QUEUED" });
    const result = await stopPracticeJobAction(job.id).catch(() => null);
    if (!result?.success) toast.error(result?.error ?? "The job couldn't be stopped. Try again.");
    void refresh();
  };

  return { job, start, stop, starting };
}

/** A job in progress, or how the last one ended (until closed). */
export function PracticeJobPanel({ job }: { job: PracticeJobView | null }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  useEffect(() => {
    const read = setTimeout(() => setDismissed(readDismissed()), 0);
    return () => clearTimeout(read);
  }, []);
  if (!job || (!job.active && dismissed === job.id)) return null;

  const finished = job.counts.ok + job.counts.rejected + job.counts.failed;
  const writing = job.kind === "WRITE_TASKS";
  const noun = writing ? "written" : "drafted";
  const tally = `${job.counts.ok} ${noun}, ${job.counts.rejected} rejected, ${job.counts.failed} failed`;
  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, job.id);
    } catch {
      // Storage refused: it hides for this visit.
    }
    setDismissed(job.id);
  };
  // Skills that keep failing even after repairs: their tasks likely need what the sandbox doesn't have.
  const struggling =
    job.struggling.length > 0 ? (
      <p className="w-full text-xs text-amber-700 dark:text-amber-300">
        Keep failing their proof, even after repairs: {job.struggling.map((skill) => `${skill.skillKey} (${skill.rejected})`).join(", ")}. If they need a live
        service (LangSmith, an API), mark them &ldquo;questions only&rdquo; in the skill editor.
      </p>
    ) : null;
  const problems =
    job.problems.length > 0 ? (
      <div>
        <button type="button" onClick={() => setShowProblems(!showProblems)} className="text-xs text-muted-foreground hover:text-foreground">
          {showProblems ? "Hide" : "Show"} {job.problems.length} {job.problems.length === 1 ? "problem" : "problems"}
        </button>
        {showProblems && (
          <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs">
            {job.problems.map((problem, index) => (
              <li key={index} className="flex gap-2">
                <span className="shrink-0 font-mono text-muted-foreground">{problem.label}</span>
                <span className={cn("shrink-0", problem.status === "FAILED" ? "text-destructive" : problem.status === "PENDING" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  {problem.status === "PENDING" ? "retrying" : problem.status.toLowerCase()}
                </span>
                <span className="min-w-0">{problem.why}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : null;

  if (job.active) {
    const state = job.status === "QUEUED" ? "Waiting for the worker" : job.status === "STOPPING" ? "Stopping: finishing the items in progress" : writing ? "Writing missing tasks" : "Drafting lessons";
    return (
      <div className="w-full space-y-2" role="status" aria-live="polite">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <DotLoader />
          <span className={cn("font-medium", job.status === "STOPPING" && "text-muted-foreground")}>{state}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {finished} of {job.total}
          </span>
          <span className="flex-1" />
          <span className="text-xs tabular-nums text-muted-foreground">
            {tally}
            {job.secondsLeft !== null && job.status === "RUNNING" ? ` · about ${duration(job.secondsLeft)} left` : ""}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-background" aria-hidden="true">
          <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-700" style={{ width: `${(finished / Math.max(1, job.total)) * 100}%` }} />
        </div>
        {job.running.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            In progress: {job.running.map((item) => `${item.label}${item.attempt > 1 ? ` (attempt ${item.attempt})` : ""}`).join(", ")}
          </p>
        )}
        {job.workerQuiet && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            The worker on the lab server hasn&apos;t been heard from for over a minute. Check it&apos;s running there:
            <code className="rounded bg-background/60 px-1">docker compose ps practice-worker</code> and
            <code className="rounded bg-background/60 px-1">docker logs practice-worker</code>. The job waits; nothing is lost.
          </p>
        )}
        {struggling}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-xs text-muted-foreground">Runs on the lab server: you can close this page and come back.</p>
          {problems}
        </div>
      </div>
    );
  }

  const seconds = job.startedAt && job.finishedAt ? (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000 : null;
  const title = job.status === "DONE" ? `Finished: ${job.total} of ${job.total}` : job.status === "STOPPED" ? `Stopped after ${finished} of ${job.total}` : `Halted after ${finished} of ${job.total}`;
  return (
    <div
      role="status"
      className={cn(
        "w-full space-y-1.5 rounded-xl border px-4 py-3 text-sm",
        job.status === "HALTED" ? "border-destructive/40 bg-destructive/5" : job.counts.failed ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-background/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">
          {tally}
          {seconds !== null ? ` · ${duration(seconds)}` : ""}
          {job.finishedAt ? ` · ended ${new Date(job.finishedAt).toLocaleString()}` : ""}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={dismiss} aria-label="Close this summary" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {job.error && <p className="text-destructive">{job.error}</p>}
      {job.status !== "DONE" && !job.error && <p className="text-muted-foreground">Start it again to carry on: only what&apos;s still missing is listed.</p>}
      {struggling}
      {problems}
    </div>
  );
}
