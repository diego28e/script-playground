"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createPracticeJob, jobView, stopPracticeJob, type PracticeJobView } from "@/lib/practice/jobs";

// The admin page's side of practice jobs (lib/practice/jobs.ts, docs/practice.md "Jobs"): start one, stop it, and
// read how it's going. The work itself is the practice worker's, on the lab server.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.role === "ADMIN" ? session : null;
}

/** Starts writing every missing task, or drafting every remaining lesson, for a course. */
export async function startPracticeJob(courseId: string, kind: "WRITE_TASKS" | "DRAFT_LESSONS", model?: string): Promise<Result<{ job: PracticeJobView }>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Only admins can start practice jobs." };
  const created = await createPracticeJob({ courseId, kind, userId: session.user.id, model });
  if (!created.ok) return { success: false, error: created.error };
  const job = await jobView(courseId);
  return job ? { success: true, job } : { success: false, error: "The job couldn't be read back." };
}

/** Stops a job: the worker finishes the items in progress, then stops. */
export async function stopPracticeJobAction(jobId: string): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can stop practice jobs." };
  await stopPracticeJob(jobId);
  return { success: true };
}

/** The course's latest job, for the page to show (polled while one is active). */
export async function getPracticeJob(courseId: string): Promise<PracticeJobView | null> {
  if (!(await requireAdmin())) return null;
  const job = await jobView(courseId);
  // The page's counts (tasks per stage, drafted lessons) follow the job's progress.
  if (job?.active) revalidatePath("/admin/practice");
  return job;
}
