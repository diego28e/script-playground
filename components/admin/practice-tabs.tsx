"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// The practice admin's two pages: the skill graph, and every task to find and fix.
const TABS = [
  { href: "/admin/practice", label: "Skills" },
  { href: "/admin/practice/tasks", label: "Tasks" },
];

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
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
