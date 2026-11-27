"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPracticeDue } from "@/actions/practice-learner";
import { cn } from "@/lib/utils";

/** Sent by the practice page when an answer is recorded, so the badge counts down without a page change. */
export const PRACTICE_ANSWERED = "academia:practice-answered";

/** How many practice tasks wait today: asked again on every page change and answer. 0 when signed out. */
export function usePracticeDue(pathname: string, signedIn: boolean): number {
  const [due, setDue] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const refresh = () =>
      void getPracticeDue(timeZone)
        .then((result) => {
          if (live) setDue(result.total);
        })
        .catch(() => {});
    refresh();
    window.addEventListener(PRACTICE_ANSWERED, refresh);
    return () => {
      live = false;
      window.removeEventListener(PRACTICE_ANSWERED, refresh);
    };
  }, [pathname, signedIn]);
  return signedIn ? due : 0;
}

/** The count beside Practice, in the header and in the phone menu. */
export function PracticeDueBadge({ due }: { due: number }) {
  if (due <= 0) return null;
  return (
    <span aria-hidden="true" className="min-w-5 rounded-full bg-ring px-1.5 py-0.5 text-center font-mono text-[11px] leading-none font-semibold text-background tabular-nums">
      {due > 99 ? "99+" : due}
    </span>
  );
}

/** The header's Practice link, with the number of tasks waiting today. */
export function PracticeNavLink({ label, className, active, due }: { label: string; className: string; active: boolean; due: number }) {
  return (
    <Link href="/practice" aria-current={active ? "page" : undefined} aria-label={due > 0 ? `${label} (${due})` : label} className={cn(className, "inline-flex items-center gap-1.5", active && "text-foreground")}>
      {label}
      <PracticeDueBadge due={due} />
    </Link>
  );
}
