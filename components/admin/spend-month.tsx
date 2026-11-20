"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Download } from "lucide-react";
import { DotLoader } from "@/components/ui/dot-loader";

// Admin → Spend's controls: the month (UTC, as the providers bill), and the exports of that month.
export function SpendMonth({ month }: { month: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const link = "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-semibold shadow-[var(--shadow-tile)] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Month (UTC)
        <input
          type="month"
          value={month}
          max={new Date().toISOString().slice(0, 7)}
          onChange={(event) => event.target.value && start(() => router.push(`/admin/spend?month=${event.target.value}`))}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        />
      </label>
      {pending && <DotLoader />}
      <a href={`/api/admin/spend/export?month=${month}&format=csv`} className={link}>
        <Download className="size-4" aria-hidden="true" />
        CSV
      </a>
      <a href={`/api/admin/spend/export?month=${month}&format=json`} className={link}>
        <Download className="size-4" aria-hidden="true" />
        JSON
      </a>
    </div>
  );
}
