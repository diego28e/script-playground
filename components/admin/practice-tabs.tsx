"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { PageLoader } from "@/components/feedback/page-states";
import { cn } from "@/lib/utils";

// The practice admin's two pages: the skill graph, and every task to find and fix.
const TABS = [
  {
    href: "/admin/practice",
    label: "Skills",
    title: "Practice skills",
    about: "What learners practise after each lesson, and what each skill needs first. Draft, review, approve, then publish.",
  },
  {
    href: "/admin/practice/tasks",
    label: "Tasks",
    title: "Practice tasks",
    about: "Every task learners can get, to find and fix: search its words, narrow it down, and see how learners did. An edit is proven again before it replaces the task.",
  },
];

/**
 * A tab's label. From the click until the other page takes over, the tab looks pressed, so a click is never met with
 * nothing (both pages load their data on the server before they show).
 */
function TabLabel({ label, active }: { label: string; active: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={cn(
        "block rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active || pending ? "bg-background text-foreground shadow-sm" : "text-muted-foreground group-hover:text-foreground",
        pending && "animate-pulse motion-reduce:animate-none",
      )}
    >
      {label}
    </span>
  );
}

export function PracticeTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Practice" className="inline-flex rounded-full bg-muted p-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className="group rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <TabLabel label={tab.label} active={active} />
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The top of both pages: the title, what the page is for, and the tabs. The title follows the address, so a loading
 * state shows the page being opened whichever of the two loading.tsx files is on screen (the section's own one also
 * wraps the Tasks page).
 */
export function PracticeHeader() {
  const pathname = usePathname();
  const page = TABS.find((tab) => tab.href === pathname) ?? TABS[0];
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{page.title}</h2>
        <p className="max-w-2xl text-muted-foreground">{page.about}</p>
      </div>
      <PracticeTabs />
    </div>
  );
}

/**
 * What a practice admin page shows while its data loads (its loading.tsx): the real header, tabs included and already
 * on the page being opened, over a loader. Without it, switching tabs showed nothing until the server answered: the
 * admin area's own loading.tsx doesn't cover a move between two pages of the same section.
 */
export function PracticeLoading() {
  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-8 md:px-4">
      <PracticeHeader />
      <PageLoader className="min-h-[40vh]" />
    </div>
  );
}
