import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// A video's way onto its lesson, step by step (upload, encode, captions), on the admin videos page: one segment per
// step, a tick on each finished one, and the active one filling as it goes, or sweeping while its share isn't known.

export type ProgressStep = {
  label: string;
  state: "done" | "active" | "waiting";
  /** 0 to 100 for the active step; null while it can't be measured (it sweeps instead). */
  percent?: number | null;
  /** What the active step is doing, in a few words ("Translating 48 of 99 lines"). */
  detail?: string;
};

export function VideoProgress({ title, subtitle, steps }: { title: string; subtitle?: string; steps: ProgressStep[] }) {
  const active = steps.find((step) => step.state === "active");
  const percent = active?.percent ?? null;
  const status = active ? `${active.detail ?? active.label}${percent !== null ? ` · ${Math.round(percent)}%` : ""}` : "Done";
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-tile)]">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {status}
        </p>
      </div>
      <ol className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step) => {
          const measured = step.state === "active" && step.percent !== null && step.percent !== undefined;
          const width = step.state === "done" ? 100 : measured ? Math.max(2, Math.min(100, step.percent!)) : 0;
          return (
            <li key={step.label} className="min-w-0">
              <div
                role="progressbar"
                aria-label={step.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={step.state === "done" ? 100 : measured ? Math.round(step.percent!) : undefined}
                aria-valuetext={step.state === "done" ? "Done" : step.state === "waiting" ? "Not started" : (step.detail ?? step.label)}
                className="relative h-1.5 overflow-hidden rounded-full bg-muted"
              >
                {/* Ink on paper, chartreuse in the dark theme: the fill reads clearly on either track. */}
                <div className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-700 ease-out dark:bg-signal" style={{ width: `${width}%` }} />
                {step.state === "active" && !measured && <div className="progress-sweep absolute inset-y-0 left-0 w-1/3 rounded-full bg-foreground/70 dark:bg-signal/80" />}
              </div>
              <p
                className={cn(
                  "mt-1.5 flex items-center gap-1 truncate text-[11px]",
                  step.state === "waiting" ? "text-muted-foreground/70" : step.state === "active" ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {step.state === "done" && <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
                {step.label}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
