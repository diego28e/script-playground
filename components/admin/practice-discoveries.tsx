"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Layers, ScanSearch, Undo2, X } from "lucide-react";
import { addPracticeDiscovery, getPracticeDiscoveries, setPracticeDiscoveryStatus } from "@/actions/practice";
import type { CourseDiscovery } from "@/lib/practice/discovery";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

// Missing prerequisites (docs/practice.md): what learners' diagnoses proposed, how the probes went, and lk-practice's
// advice across the learners who confirmed it. The admin adds one to the course for everyone, or dismisses it so it
// isn't proposed again. A learner's own confirmed prerequisite stays theirs either way.

const ADVICE: Record<string, string> = {
  practise: "practising it",
  harden: "harden: the blocked skill passed after it",
  revoke: "revoke: the blocked skill kept failing after it",
  keep: "keep",
  admit: "waiting to join their graph",
};

const STATUS = {
  PROPOSED: { label: "Proposed", tone: "bg-amber-500/15 text-amber-800 dark:text-amber-200" },
  ADDED: { label: "Added to the course", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  DISMISSED: { label: "Dismissed", tone: "bg-muted text-muted-foreground" },
} as const;

export function PracticeDiscoveriesButton({ courseId, waiting }: { courseId: string; waiting: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tip content="Prerequisites learners were missing, found by diagnoses and confirmed by probes">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <ScanSearch className="mr-2 h-4 w-4" /> Discovered{waiting ? ` (${waiting})` : ""}
        </Button>
      </Tip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Missing prerequisites</DialogTitle>
            <DialogDescription>
              When a learner fails a skill twice in a row, a model names what may be missing underneath, and short check questions decide it. Each row is one proposal, with how
              its checks went across learners. Adding one puts the skill and a soft prerequisite in the course for everyone, from the next published version.
            </DialogDescription>
          </DialogHeader>
          {open && <DiscoveryList courseId={courseId} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DiscoveryList({ courseId }: { courseId: string }) {
  const [rows, setRows] = useState<CourseDiscovery[] | null>(null);
  const [busy, startBusy] = useTransition();
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    const result = await getPracticeDiscoveries(courseId).catch(() => null);
    if (!result || !result.success) {
      toast.error(result && !result.success ? result.error : "The proposals couldn't load.");
      return [];
    }
    return result.discoveries;
  }, [courseId]);
  useEffect(() => {
    let current = true;
    void load().then((list) => current && setRows(list));
    return () => {
      current = false;
    };
  }, [load]);

  const add = async (row: CourseDiscovery) => {
    const ok = await confirm({
      title: "Add this prerequisite to the course?",
      detail: `${row.from.en} → ${row.to.en}`,
      description: row.from.found
        ? "The skill joins its lesson as a new skill, and becomes a soft prerequisite. Learners get it with the next version you publish."
        : "It becomes a soft prerequisite. Learners get it with the next version you publish.",
      confirmLabel: "Add to the course",
    });
    if (!ok) return;
    startBusy(async () => {
      const result = await addPracticeDiscovery(row.id);
      if (!result.success) toast.error(result.error);
      else {
        toast.success("Added. Publish a new version to apply it.");
        setRows(await load());
      }
    });
  };
  const setStatus = (row: CourseDiscovery, status: "PROPOSED" | "DISMISSED") =>
    startBusy(async () => {
      const result = await setPracticeDiscoveryStatus(row.id, status);
      if (!result.success) toast.error(result.error);
      else setRows(await load());
    });

  if (!rows) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <DotLoader /> Loading…
      </p>
    );
  }
  if (!rows.length) return <p className="rounded-xl bg-muted/60 p-6 text-center text-sm text-muted-foreground">Nothing proposed yet. Proposals appear when learners struggle with a skill.</p>;

  return (
    <ul className="grid gap-3">
      {dialog}
      {rows.map((row) => {
        const status = STATUS[row.status];
        const advice = Object.entries(row.advice);
        return (
          <li key={row.id} className={cn("rounded-2xl border border-border p-4", row.status === "DISMISSED" && "opacity-60")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                {row.from.found && <Layers className="size-4 shrink-0 text-ring" aria-label="Not taught by the course" role="img" />}
                <span>{row.from.en}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="is a prerequisite of" role="img" />
                <span className="text-muted-foreground">{row.to.en}</span>
              </p>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", status.tone)}>{status.label}</span>
            </div>
            {row.from.found && row.from.description && <p className="mt-1 text-sm text-muted-foreground">New skill: {row.from.description.en}</p>}
            {row.rationale && <p className="mt-2 text-sm">“{row.rationale}”</p>}
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {row.opened} probed · {row.confirmed} confirmed · {row.refuted} refuted
              {advice.length > 0 && ` · ${advice.map(([key, count]) => `${count} ${ADVICE[key] ?? key}`).join(", ")}`}
            </p>
            {row.status !== "ADDED" && (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {row.status === "PROPOSED" ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setStatus(row, "DISMISSED")} disabled={busy}>
                      <X className="mr-1.5 h-4 w-4" /> Dismiss
                    </Button>
                    <Button size="sm" onClick={() => void add(row)} disabled={busy}>
                      <Check className="mr-1.5 h-4 w-4" /> Add to the course
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setStatus(row, "PROPOSED")} disabled={busy}>
                    <Undo2 className="mr-1.5 h-4 w-4" /> Undo dismiss
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
