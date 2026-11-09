"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { getPracticeTaskForEdit } from "@/actions/practice-tasks";
import { TaskEditor, TaskModelsContext } from "@/components/admin/practice-task-editor";
import { Tip } from "@/components/ui/tip";
import type { SkillTask } from "@/actions/practice";

// For admins on their own practice page: the task in front of them opens in the task editor right there, the fastest
// way to fix a task found wrong while practising. (Learners never see it: the page passes the editor's models only to
// an admin.) Saving proves the new version and retires this one; the learner's session keeps the task it had, and the
// next sessions get the new one.

export function PracticeTaskEditButton({ taskId, models }: { taskId: string; models: { id: string; label: string }[] }) {
  const [task, setTask] = useState<SkillTask | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const openEditor = async () => {
    setLoading(true);
    const found = await getPracticeTaskForEdit(taskId).catch(() => null);
    setLoading(false);
    if (!found) {
      toast.error("That task couldn't be opened.");
      return;
    }
    setTask(found);
    setOpen(true);
  };

  return (
    <TaskModelsContext.Provider value={models}>
      <span className="ml-auto inline-flex items-center gap-1">
        <Tip content="Edit this task (admins only)">
          <button
            type="button"
            onClick={() => void openEditor()}
            disabled={loading}
            aria-label="Edit this task"
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-60"
          >
            <Pencil className="size-3" aria-hidden="true" />
            Edit
          </button>
        </Tip>
        <Tip content="Find it among every task">
          <Link
            href={`/admin/practice/tasks?task=${encodeURIComponent(taskId)}`}
            className="inline-flex h-7 items-center rounded-full px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            All tasks
          </Link>
        </Tip>
      </span>
      {task && <TaskEditor task={task} open={open} onOpenChange={setOpen} onSaved={() => setTask(null)} />}
    </TaskModelsContext.Provider>
  );
}
