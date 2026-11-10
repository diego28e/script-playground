"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Search, Sparkles } from "lucide-react";
import { draftCompassCard, syncCompassConcepts, type CompassList } from "@/actions/compass";
import { VideoProgress } from "@/components/admin/video-progress";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

// Admin → Python (docs/compass.md): every concept in the course's order of use, with where its card stands, to draft,
// prove and publish them most-used first.

type Concept = CompassList["concepts"][number];

const STATUS: Record<string, { label: string; className: string }> = {
  none: { label: "No card", className: "text-muted-foreground" },
  DRAFT: { label: "Draft", className: "bg-amber-500/12 text-amber-800 dark:text-amber-200" },
  PROVEN: { label: "Proven", className: "bg-sky-500/12 text-sky-800 dark:text-sky-200" },
  PUBLISHED: { label: "Published", className: "bg-emerald-500/12 text-emerald-800 dark:text-emerald-200" },
  RETIRED: { label: "Retired", className: "text-muted-foreground" },
};

const SELECT = "h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function CardStatus({ concept }: { concept: Concept }) {
  // A fixed column, right-aligned, so every row lines up whatever its status says.
  const latest = concept.latest;
  const status = STATUS[latest?.status ?? "none"];
  return (
    <span className="inline-flex items-center justify-self-end gap-1.5 text-xs">
      <span className={cn("rounded-full px-2 py-0.5 font-medium", status.className)}>{status.label}</span>
      {latest && <span className="font-mono text-muted-foreground">v{latest.version}</span>}
      {concept.published && concept.published !== latest?.version && (
        <Tip content={`Version ${concept.published} is what learners see`}>
          <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-emerald-800 dark:text-emerald-200">v{concept.published} live</span>
        </Tip>
      )}
    </span>
  );
}

export function CompassConceptList({ data }: { data: CompassList }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [batch, setBatch] = useState<{ done: number; total: number; current: string } | null>(null);

  const groups = [...new Set(data.concepts.map((concept) => concept.group))].sort();
  const needle = query.trim().toLowerCase();
  const shown = data.concepts.filter((concept) => {
    if (group && concept.group !== group) return false;
    const state = concept.latest?.status ?? "none";
    if (status === "live" ? !concept.published : status && state !== status) return false;
    return !needle || `${concept.key} ${concept.labelEn} ${concept.labelEs}`.toLowerCase().includes(needle);
  });
  const counts = {
    published: data.concepts.filter((concept) => concept.published).length,
    used: data.concepts.filter((concept) => concept.usageRank !== null).length,
  };

  const sync = async () => {
    setSyncing(true);
    const result = await syncCompassConcepts().catch(() => null);
    setSyncing(false);
    if (!result?.success) return toast.error(result?.error ?? "The concepts couldn't be loaded.");
    toast.success(`${result.concepts} concepts loaded from the course inventory (${result.commit.slice(0, 7)}).`);
    router.refresh();
  };

  // The most used concepts without a card, drafted one after another (each is one request).
  const draftNext = async (count: number) => {
    const next = data.concepts.filter((concept) => concept.usageRank !== null && !concept.latest).slice(0, count);
    if (!next.length) return toast.info("Every concept the course uses has a card.");
    let done = 0;
    let failed = 0;
    for (const concept of next) {
      setBatch({ done, total: next.length, current: concept.labelEn });
      const result = await draftCompassCard(concept.key).catch(() => null);
      if (!result?.success) failed++;
      done++;
    }
    setBatch(null);
    if (failed) toast.error(`${failed} of ${next.length} drafts failed. Try those again.`);
    else toast.success(`${next.length} cards drafted. Open each one to prove and publish it.`);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a concept (“f-string”, “dict”, “await”…)"
            aria-label="Find a concept"
            className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select aria-label="Group" className={SELECT} value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="">Every group</option>
          {groups.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <select aria-label="Card" className={SELECT} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Any card</option>
          <option value="none">No card</option>
          <option value="DRAFT">Draft</option>
          <option value="PROVEN">Proven, to review</option>
          <option value="live">Published</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => void draftNext(5)} disabled={batch !== null}>
          <Sparkles className="mr-1.5 size-4" aria-hidden="true" /> Draft the next 5
        </Button>
        <Tip content={`Reload the concepts from the course inventory bundled with the platform (${data.commit.slice(0, 7)})`}>
          <Button variant="ghost" size="sm" onClick={() => void sync()} loading={syncing} loadingLabel="Loading">
            <RefreshCw className="mr-1.5 size-4" aria-hidden="true" /> Inventory
          </Button>
        </Tip>
      </div>

      {batch && (
        <VideoProgress
          title={`Drafting ${batch.done + 1} of ${batch.total}: ${batch.current}`}
          subtitle="Each draft takes 10 to 20 seconds; keep this page open."
          steps={[{ label: "Drafts", state: "active", percent: (batch.done / batch.total) * 100, detail: `${batch.done} of ${batch.total}` }]}
        />
      )}

      <p className="text-sm text-muted-foreground">
        {shown.length} of {data.concepts.length} concepts · {counts.used} used by the course ({data.lessons} notebooks) · {counts.published} published
      </p>

      {data.concepts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No concepts yet. Load them from the course inventory with the Inventory button.
        </div>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {shown.map((concept) => (
            <li key={concept.key}>
              <Link href={`/admin/python/${encodeURIComponent(concept.key)}`} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-accent/50 md:grid-cols-[3rem_minmax(0,1fr)_9rem_12rem_11rem]">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{concept.usageRank ?? "–"}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{concept.labelEn}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{concept.key}</span>
                </span>
                <span className="hidden text-xs text-muted-foreground md:block">{concept.group}</span>
                <span className="hidden text-xs tabular-nums text-muted-foreground md:block">
                  {concept.lessonCount ? `${concept.lessonCount} lessons · from ${concept.firstLesson}` : "Not in the course yet"}
                </span>
                <CardStatus concept={concept} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
