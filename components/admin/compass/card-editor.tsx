"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowUpRight, Check, FlaskConical, Pencil, Plus, Rocket, Save, Sparkles, Wand2, X } from "lucide-react";
import { draftCompassCard, proveCompassCard, publishCompassCard, saveCompassCard, adoptRealOutputs, type CompassConceptView } from "@/actions/compass";
import { ConceptCard } from "@/components/compass/concept-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { CardDraft } from "@/lib/compass/cards";
import { cn } from "@/lib/utils";

// One concept's card in Admin → Python (docs/compass.md, "Cards"): draft it with a model or by hand, edit it with the
// learner's view beside it, prove it on the grader, publish it. Editing a proven or published version saves a new
// draft version; the published one stays live until the new one is published.

type Card = CompassConceptView["cards"][number];

const EMPTY: CardDraft = {
  titleEs: "",
  titleEn: "",
  summaryEs: "",
  summaryEn: "",
  explanationEs: "",
  explanationEn: "",
  whenEs: "",
  whenEn: "",
  examples: [{ code: "", output: "", noteEs: "", noteEn: "" }],
  mistakes: [],
  docs: [],
  related: [],
};

const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", PROVEN: "Proven", PUBLISHED: "Published", RETIRED: "Retired" };
const STATUS_CLASS: Record<string, string> = {
  DRAFT: "bg-amber-500/12 text-amber-800 dark:text-amber-200",
  PROVEN: "bg-sky-500/12 text-sky-800 dark:text-sky-200",
  PUBLISHED: "bg-emerald-500/12 text-emerald-800 dark:text-emerald-200",
  RETIRED: "bg-muted text-muted-foreground",
};
const CODE = "min-h-[5.5rem] resize-y rounded-lg border border-code-border bg-code p-3 font-mono text-[13px] leading-relaxed text-code-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** A Spanish and an English field side by side. */
function Pair({ label, es, en, onEs, onEn, rows }: { label: string; es: string; en: string; onEs: (value: string) => void; onEn: (value: string) => void; rows?: number }) {
  const Control = rows ? Textarea : Input;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={`${label} · ES`}>
        <Control value={es} rows={rows} onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => onEs(event.target.value)} />
      </Field>
      <Field label={`${label} · EN`}>
        <Control value={en} rows={rows} onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => onEn(event.target.value)} />
      </Field>
    </div>
  );
}

export function CompassCardEditor({ data }: { data: CompassConceptView }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(data.cards[0]?.id ?? null);
  const [writingByHand, setWritingByHand] = useState(false);
  const selected = data.cards.find((card) => card.id === selectedId) ?? data.cards[0] ?? null;
  // Sonnet unless the admin picks another: it drafts a card in about 15 s; Opus is slower than a request allows on a long card.
  const [model, setModel] = useState(data.models.find((entry) => entry.id === "claude-sonnet-5-5")?.id ?? data.models[0]?.id ?? "");
  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);

  const draft = async () => {
    setDrafting(true);
    const result = await draftCompassCard(data.concept.key, { model, instruction: selected && instruction.trim() ? instruction.trim() : undefined, fromCardId: selected && instruction.trim() ? selected.id : undefined }).catch(() => null);
    setDrafting(false);
    if (!result?.success) return toast.error(result?.error ?? "The draft didn't come back. Try again.", { duration: 10000 });
    toast.success(`Drafted by ${result.model}.${result.dropped.length ? ` Dropped invented links or concepts: ${result.dropped.join(", ")}.` : ""} Prove it next.`);
    setInstruction("");
    setWritingByHand(false);
    setSelectedId(result.cardId);
    router.refresh();
  };

  const conceptLabels = Object.fromEntries(data.concepts.map((concept) => [concept.key, concept.labelEn]));
  const links = Object.fromEntries(data.links.map((link) => [link.key, link]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Link href="/admin/python" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" /> All concepts
          </Link>
          <h2 className="text-2xl font-bold tracking-tight">
            {data.concept.labelEn} <span className="font-mono text-base font-normal text-muted-foreground">{data.concept.key}</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            {data.concept.group} · {data.concept.lessonCount ? `#${data.concept.usageRank} in the course, ${data.concept.lessonCount} lessons from ${data.concept.firstLesson}` : "not in the course yet"}
            {data.usage?.example && (
              <>
                {" "}· <code className="rounded bg-muted px-1 text-xs">{data.usage.example.line.slice(0, 90)}</code> ({data.usage.example.lesson})
              </>
            )}
          </p>
        </div>
        {data.cards.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Versions">
            {data.cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => {
                  setSelectedId(card.id);
                  setWritingByHand(false);
                }}
                aria-pressed={selected?.id === card.id}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", selected?.id === card.id ? "border-foreground/40 bg-accent" : "border-border hover:bg-accent/60")}
              >
                <span className="font-mono">v{card.version}</span>
                <span className={cn("rounded-full px-1.5", STATUS_CLASS[card.status])}>{STATUS_LABEL[card.status]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The model: a first draft, or a rewrite of the version shown following an instruction. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <Wand2 className="ml-1 size-4 text-muted-foreground" aria-hidden="true" />
        {selected && (
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Rewrite with AI: say what to change (“simpler first example”, “add the mistake of…”), or leave empty for a fresh draft"
            aria-label="What to change"
            className="h-9 min-w-[18rem] flex-1 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        <select aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm">
          {data.models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => void draft()} loading={drafting} loadingLabel="Writing, about 15 s">
          <Sparkles className="mr-1.5 size-4" aria-hidden="true" />
          {selected && instruction.trim() ? "Rewrite with AI" : selected ? "New draft with AI" : "Draft with AI"}
        </Button>
        {!selected && !writingByHand && (
          <Button size="sm" variant="ghost" onClick={() => setWritingByHand(true)}>
            <Pencil className="mr-1.5 size-4" aria-hidden="true" /> Write it by hand
          </Button>
        )}
      </div>

      {selected || writingByHand ? (
        <VersionEditor key={selected && !writingByHand ? selected.id : "new"} conceptKey={data.concept.key} card={writingByHand ? null : selected} data={data} links={links} conceptLabels={conceptLabels} onSaved={(cardId) => {
          setWritingByHand(false);
          setSelectedId(cardId);
          router.refresh();
        }} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No card yet. Draft one with AI (it takes about 15 seconds), or write it by hand.
        </div>
      )}
    </div>
  );
}

function VersionEditor({
  conceptKey,
  card,
  data,
  links,
  conceptLabels,
  onSaved,
}: {
  conceptKey: string;
  card: Card | null;
  data: CompassConceptView;
  links: Record<string, CompassConceptView["links"][number]>;
  conceptLabels: Record<string, string>;
  onSaved: (cardId: string) => void;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState<CardDraft>(card?.draft ?? EMPTY);
  const [language, setLanguage] = useState<"es" | "en">("es");
  const [busy, setBusy] = useState<"save" | "prove" | "real" | "publish" | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(card?.draft ?? EMPTY);
  const set = <K extends keyof CardDraft>(key: K, value: CardDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const proof = !dirty ? card?.proof : null;
  const editable = !card || card.status === "DRAFT" || card.status === "PROVEN";

  const save = async (): Promise<string | null> => {
    setBusy("save");
    const result = await saveCompassCard(conceptKey, card?.id ?? null, draft).catch(() => null);
    setBusy(null);
    if (!result?.success) {
      toast.error(result?.error ?? "The card couldn't be saved.", { duration: 10000 });
      return null;
    }
    toast.success(card && card.status !== "DRAFT" ? "Saved as a new draft version." : "Saved. Prove it next.");
    onSaved(result.cardId);
    return result.cardId;
  };

  const prove = async () => {
    const id = dirty ? await save() : card?.id;
    if (!id) return;
    setBusy("prove");
    const result = await proveCompassCard(id).catch(() => null);
    setBusy(null);
    if (!result?.success) return toast.error(result?.error ?? "The proof couldn't run.");
    if (result.proof.ok) toast.success("Proven: every example and mistake behaves as the card says.");
    else toast.error("Some examples don't behave as the card says. See below.");
    onSaved(id);
  };

  const applyRealOutputs = async () => {
    if (!card) return;
    setBusy("real");
    const result = await adoptRealOutputs(card.id).catch(() => null);
    setBusy(null);
    if (!result?.success) return toast.error(result?.error ?? "The outputs couldn't be replaced.");
    toast[result.proof.ok ? "success" : "error"](result.proof.ok ? "Outputs replaced and proven." : "Outputs replaced; something still doesn't behave as the card says.");
    router.refresh();
  };

  const publish = async () => {
    if (!card) return;
    const live = data.cards.find((entry) => entry.status === "PUBLISHED");
    if (live && live.id !== card.id) {
      const ok = await confirm({ title: `Publish version ${card.version}?`, detail: data.concept.labelEn, description: `Learners see it from now on; version ${live.version} is retired.`, confirmLabel: "Publish" });
      if (!ok) return;
    }
    setBusy("publish");
    const result = await publishCompassCard(card.id).catch(() => null);
    setBusy(null);
    if (!result?.success) return toast.error(result?.error ?? "The card couldn't be published.");
    toast.success("Published: learners see this card.");
    router.refresh();
  };

  const fixable = proof && !proof.ok && proof.items.some((item) => !item.ok && !item.error && (item.kind === "example" || !draft.mistakes[item.index]?.raises));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {dialog}
      <div className="space-y-5">
        {/* Where this version stands, and what to do next. */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
          {card && <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_CLASS[card.status])}>v{card.version} · {STATUS_LABEL[card.status]}</span>}
          {card && <span className="text-xs text-muted-foreground">by {card.author}</span>}
          {dirty && <span className="text-xs text-amber-700 dark:text-amber-300">Unsaved changes</span>}
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => void save()} disabled={!dirty || busy !== null} loading={busy === "save"} loadingLabel="Saving">
            <Save className="mr-1.5 size-4" aria-hidden="true" /> Save
          </Button>
          <Tip content="Run every example and mistake on the grader">
            <Button size="sm" variant="outline" onClick={() => void prove()} disabled={busy !== null || (!dirty && !card) || (!dirty && card?.status === "PUBLISHED")} loading={busy === "prove"} loadingLabel="Proving">
              <FlaskConical className="mr-1.5 size-4" aria-hidden="true" /> {dirty ? "Save and prove" : "Prove"}
            </Button>
          </Tip>
          <Button size="sm" onClick={() => void publish()} disabled={dirty || busy !== null || card?.status !== "PROVEN"} loading={busy === "publish"} loadingLabel="Publishing">
            <Rocket className="mr-1.5 size-4" aria-hidden="true" /> Publish
          </Button>
        </div>
        {!editable && <p className="text-xs text-muted-foreground">Editing this version saves your changes as a new draft version; this one stays as it is.</p>}

        {proof && (
          <div className={cn("space-y-2 rounded-2xl border p-4", proof.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5")}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{proof.ok ? "Proven on the grader" : "The grader disagrees with the card"}</p>
              <span className="font-mono text-[11px] text-muted-foreground">{new Date(proof.ranAt).toLocaleString()}</span>
              <span className="flex-1" />
              {fixable && card?.status === "DRAFT" && (
                <Tip content="The code is the truth: each output that differed becomes what it really printed">
                  <Button size="sm" variant="outline" onClick={() => void applyRealOutputs()} loading={busy === "real"} loadingLabel="Replacing">
                    Use the real outputs
                  </Button>
                </Tip>
              )}
            </div>
            <ul className="space-y-1.5 text-sm">
              {proof.items.map((item) => (
                <li key={`${item.kind}-${item.index}`} className="flex gap-2">
                  {item.ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />}
                  <span className="min-w-0">
                    {item.kind === "example" ? `Example ${item.index + 1}` : `Mistake ${item.index + 1}`}
                    {!item.ok && (
                      <span className="mt-1 grid gap-1 font-mono text-xs">
                        <span>
                          <span className="text-muted-foreground">card says: </span>
                          <span className="whitespace-pre-wrap">{item.expected || "(nothing)"}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">it {item.error ? "raised" : "printed"}: </span>
                          <span className="whitespace-pre-wrap">{item.error ?? (item.actual || "(nothing)")}</span>
                        </span>
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="space-y-3">
          <Pair label="Title" es={draft.titleEs} en={draft.titleEn} onEs={(value) => set("titleEs", value)} onEn={(value) => set("titleEn", value)} />
          <Pair label="Summary (one sentence)" es={draft.summaryEs} en={draft.summaryEn} onEs={(value) => set("summaryEs", value)} onEn={(value) => set("summaryEn", value)} rows={2} />
          <Pair label="Explanation (Markdown)" es={draft.explanationEs} en={draft.explanationEn} onEs={(value) => set("explanationEs", value)} onEn={(value) => set("explanationEn", value)} rows={9} />
          <Pair label="When to reach for it" es={draft.whenEs} en={draft.whenEn} onEs={(value) => set("whenEs", value)} onEn={(value) => set("whenEn", value)} rows={2} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Examples</h3>
            <Button size="sm" variant="ghost" disabled={draft.examples.length >= 3} onClick={() => set("examples", [...draft.examples, { code: "", output: "", noteEs: "", noteEn: "" }])}>
              <Plus className="mr-1 size-4" aria-hidden="true" /> Example
            </Button>
          </div>
          {draft.examples.map((example, index) => (
            <div key={index} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Example {index + 1}</span>
                {draft.examples.length > 1 && (
                  <button type="button" onClick={() => set("examples", draft.examples.filter((_, at) => at !== index))} className="hover:text-destructive" aria-label={`Remove example ${index + 1}`}>
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <Field label="Code">
                  <textarea className={cn(CODE, "w-full")} value={example.code} spellCheck={false} onChange={(event) => set("examples", draft.examples.map((entry, at) => (at === index ? { ...entry, code: event.target.value } : entry)))} />
                </Field>
                <Field label="Prints exactly">
                  <textarea className={cn(CODE, "w-full")} value={example.output} spellCheck={false} onChange={(event) => set("examples", draft.examples.map((entry, at) => (at === index ? { ...entry, output: event.target.value } : entry)))} />
                </Field>
              </div>
              <Pair label="Note" es={example.noteEs} en={example.noteEn} onEs={(value) => set("examples", draft.examples.map((entry, at) => (at === index ? { ...entry, noteEs: value } : entry)))} onEn={(value) => set("examples", draft.examples.map((entry, at) => (at === index ? { ...entry, noteEn: value } : entry)))} />
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Common mistakes</h3>
            <Button size="sm" variant="ghost" disabled={draft.mistakes.length >= 2} onClick={() => set("mistakes", [...draft.mistakes, { code: "", raises: "", output: "", whyEs: "", whyEn: "", fixEs: "", fixEn: "" }])}>
              <Plus className="mr-1 size-4" aria-hidden="true" /> Mistake
            </Button>
          </div>
          {draft.mistakes.length === 0 && <p className="text-xs text-muted-foreground">None. Only real, common mistakes belong here.</p>}
          {draft.mistakes.map((mistake, index) => {
            const update = (change: Partial<CardDraft["mistakes"][number]>) => set("mistakes", draft.mistakes.map((entry, at) => (at === index ? { ...entry, ...change } : entry)));
            return (
              <div key={index} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Mistake {index + 1}</span>
                  <button type="button" onClick={() => set("mistakes", draft.mistakes.filter((_, at) => at !== index))} className="hover:text-destructive" aria-label={`Remove mistake ${index + 1}`}>
                    <X className="size-4" />
                  </button>
                </div>
                <Field label="Code">
                  <textarea className={cn(CODE, "w-full")} value={mistake.code} spellCheck={false} onChange={(event) => update({ code: event.target.value })} />
                </Field>
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="Raises (exception name)" hint="Or leave empty and say what it prints instead.">
                    <Input value={mistake.raises} onChange={(event) => update({ raises: event.target.value })} placeholder="KeyError" />
                  </Field>
                  <Field label="Prints exactly (when it doesn't raise)">
                    <textarea className={cn(CODE, "min-h-[2.5rem] w-full")} value={mistake.output} spellCheck={false} onChange={(event) => update({ output: event.target.value })} />
                  </Field>
                </div>
                <Pair label="Why" es={mistake.whyEs} en={mistake.whyEn} onEs={(value) => update({ whyEs: value })} onEn={(value) => update({ whyEn: value })} rows={2} />
                <Pair label="How to write it" es={mistake.fixEs} en={mistake.fixEn} onEs={(value) => update({ fixEs: value })} onEn={(value) => update({ fixEn: value })} rows={2} />
              </div>
            );
          })}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Official docs</h3>
          <p className="text-xs text-muted-foreground">From the Python 3.12 docs index only: at most 4, the most helpful to a beginner first.</p>
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
            {data.links.map((link) => {
              const chosen = draft.docs.includes(link.key);
              return (
                <li key={link.key} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent/50">
                  <input
                    type="checkbox"
                    id={`doc-${link.key}`}
                    checked={chosen}
                    disabled={!chosen && draft.docs.length >= 4}
                    onChange={() => set("docs", chosen ? draft.docs.filter((key) => key !== link.key) : [...draft.docs, link.key])}
                  />
                  <label htmlFor={`doc-${link.key}`} className="min-w-0 flex-1 cursor-pointer text-sm">
                    {link.title} <span className="font-mono text-[11px] text-muted-foreground">{link.key}</span>
                  </label>
                  <a href={link.url} target="_blank" rel="noreferrer" aria-label={`Open ${link.title}`} className="text-muted-foreground hover:text-foreground">
                    <ArrowUpRight className="size-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Related concepts</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {draft.related.map((key) => (
              <span key={key} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                {conceptLabels[key] ?? key}
                <button type="button" onClick={() => set("related", draft.related.filter((entry) => entry !== key))} aria-label={`Remove ${conceptLabels[key] ?? key}`} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {draft.related.length < 6 && (
              <select
                aria-label="Add a related concept"
                value=""
                onChange={(event) => event.target.value && set("related", [...draft.related, event.target.value])}
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
              >
                <option value="">Add…</option>
                {data.concepts
                  .filter((concept) => concept.key !== conceptKey && !draft.related.includes(concept.key))
                  .map((concept) => (
                    <option key={concept.key} value={concept.key}>
                      {concept.labelEn}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </section>
      </div>

      {/* What learners will read. */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Learner&apos;s view</h3>
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label="Language">
            {(["es", "en"] as const).map((code) => (
              <button key={code} type="button" aria-pressed={language === code} onClick={() => setLanguage(code)} className={cn("rounded-md px-2.5 py-1.5 font-medium uppercase", language === code ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                {code}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-2xl border border-border bg-card p-6">
          {draft.titleEn || draft.titleEs ? (
            <ConceptCard card={draft} links={links} language={language} related={conceptLabels} usage={{ lessonCount: data.concept.lessonCount, firstLesson: data.concept.firstLesson }} />
          ) : (
            <p className="text-sm text-muted-foreground">The card appears here as you write it.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
