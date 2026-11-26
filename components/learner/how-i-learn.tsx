"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, PenLine, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { addPreference, forgetObservations, removePreference, type HowILearn } from "@/actions/how-i-learn";
import { useLanguage } from "@/components/providers/language-provider";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tip } from "@/components/ui/tip";
import type { Preference, PreferenceScope } from "@/lib/preferences";
import { cn } from "@/lib/utils";

// How I learn (docs/whiteboard-teaching.md §2). Two kinds of things, kept apart on purpose:
// - what the learner asked for, word for word, which every teacher follows (or only the whiteboard's);
// - what the teachers observed, written by them from conversations and boards, which the learner can forget.

const COPY = {
  es: {
    title: "Cómo aprendo",
    intro: "Lo que pediste a tus profesores, y lo que ellos han notado. Tus peticiones van por delante de lo que notaron.",
    asked: "Lo que pediste",
    askedNote: "Palabra por palabra. Los profesores las siguen, sin ir nunca contra sus reglas de enseñanza.",
    all: "Para todos los profesores",
    allNote: "Los profesores por voz, el entrenador de práctica y la pizarra.",
    board: "Solo en la pizarra",
    boardNote: "Sobre dibujar y usar la pizarra. Los profesores por voz no las ven.",
    none: "Nada todavía. Cuando le pidas algo a un profesor (por ejemplo «ve paso a paso»), aparece aquí.",
    add: "Añadir",
    placeholder: "Por ejemplo: «Usa ejemplos de AWS»",
    where: "Para",
    remove: "Quitar",
    removed: "Quitado.",
    undo: "Deshacer",
    addedBoard: "Guardado solo para la pizarra: habla de la pizarra.",
    observed: "Lo que notaron los profesores",
    observedNote: "Escrito por los profesores a partir de tus conversaciones y pizarras.",
    general: "Cómo aprendes",
    course: (title: string) => `En ${title || "un curso"}`,
    forget: "Olvidar",
    forgetTitle: "¿Olvidar estas notas?",
    forgetText: "Los profesores dejarán de tenerlas en cuenta y empezarán a anotar de nuevo. No se puede deshacer.",
    nothingObserved: "Todavía nada. Los profesores toman notas mientras hablas con ellos.",
    failed: "No se pudo guardar. Inténtalo de nuevo.",
  },
  en: {
    title: "How I learn",
    intro: "What you asked of your teachers, and what they have noticed. What you asked comes first.",
    asked: "What you asked for",
    askedNote: "Word for word. Teachers follow them, never against their teaching rules.",
    all: "For every teacher",
    allNote: "The voice teachers, the practice coach and the whiteboard.",
    board: "On the whiteboard only",
    boardNote: "About drawing and using the board. The voice teachers don't see these.",
    none: "Nothing yet. When you ask a teacher for something (\"go step by step\", say), it appears here.",
    add: "Add",
    placeholder: "For example: \"Use examples from AWS\"",
    where: "For",
    remove: "Remove",
    removed: "Removed.",
    undo: "Undo",
    addedBoard: "Saved for the whiteboard only: it's about the board.",
    observed: "What your teachers noticed",
    observedNote: "Written by the teachers from your conversations and boards.",
    general: "How you learn",
    course: (title: string) => `In ${title || "a course"}`,
    forget: "Forget",
    forgetTitle: "Forget these notes?",
    forgetText: "The teachers stop using them and start noting things afresh. This can't be undone.",
    nothingObserved: "Nothing yet. The teachers take notes as you talk with them.",
    failed: "That couldn't be saved. Try again.",
  },
};

/** A profile note's sections as headings and lines; a section with nothing in it ("none", "nada") is left out. */
function noteSections(text: string): { heading: string; items: string[] }[] {
  return text
    .split(/\n(?=[^\n-][^\n]*:\s*$)/m)
    .map((block) => {
      const [heading, ...lines] = block.trim().split("\n");
      const items = lines.map((line) => line.replace(/^-\s*/, "").trim()).filter((line) => line && !/^(none|nada)( yet| aún)?\.?$/i.test(line));
      return { heading: heading.replace(/:\s*$/, ""), items };
    })
    .filter((section) => section.items.length);
}

function PreferenceList({ items, empty, onRemove, label }: { items: Preference[]; empty: string; onRemove: (item: Preference) => void; label: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 leading-relaxed">{item.text}</span>
          <Tip content={label}>
            <button
              type="button"
              onClick={() => onRemove(item)}
              aria-label={`${label}: ${item.text}`}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </Tip>
        </li>
      ))}
    </ul>
  );
}

export function HowILearnPage({ data }: { data: HowILearn }) {
  const { language } = useLanguage();
  const t = COPY[language];
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<PreferenceScope>("all");
  const [saving, setSaving] = useState(false);
  const refresh = () => startTransition(() => router.refresh());

  const add = async (line: string, where: PreferenceScope) => {
    setSaving(true);
    const result = await addPreference({ text: line, scope: where }).catch(() => null);
    setSaving(false);
    if (!result?.success) {
      toast.error(result && !result.success ? result.error : t.failed);
      return false;
    }
    if (where === "all" && result.scope === "board") toast.message(t.addedBoard);
    refresh();
    return true;
  };

  const remove = async (item: Preference, where: PreferenceScope) => {
    const result = await removePreference(item.id).catch(() => null);
    if (!result?.success) {
      toast.error(t.failed);
      return;
    }
    refresh();
    // Removing is one click; Undo puts the same words back.
    toast(t.removed, { duration: 8000, action: { label: t.undo, onClick: () => void add(item.text, where) } });
  };

  const forget = async (observationScope: string) => {
    const ok = await confirm({ title: t.forgetTitle, description: t.forgetText, confirmLabel: t.forget, tone: "danger" });
    if (!ok) return;
    const result = await forgetObservations(observationScope).catch(() => null);
    if (!result?.success) toast.error(t.failed);
    else refresh();
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-2 text-muted-foreground">{t.intro}</p>

      <section aria-labelledby="asked" className="mt-8 rounded-2xl border border-border bg-card p-5">
        <h2 id="asked" className="text-lg font-semibold">
          {t.asked}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t.askedNote}</p>

        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-ring" aria-hidden="true" />
              {t.all}
            </h3>
            <p className="mb-2 mt-0.5 text-xs text-muted-foreground">{t.allNote}</p>
            <PreferenceList items={data.preferences.all} empty={t.none} label={t.remove} onRemove={(item) => void remove(item, "all")} />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <PenLine className="size-4 text-ring" aria-hidden="true" />
              {t.board}
            </h3>
            <p className="mb-2 mt-0.5 text-xs text-muted-foreground">{t.boardNote}</p>
            <PreferenceList items={data.preferences.board} empty={t.none} label={t.remove} onRemove={(item) => void remove(item, "board")} />
          </div>
        </div>

        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim() || saving) return;
            void add(text, scope).then((ok) => ok && setText(""));
          }}
        >
          <label className="sr-only" htmlFor="new-preference">
            {t.placeholder}
          </label>
          <input
            id="new-preference"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={300}
            placeholder={t.placeholder}
            className="h-10 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-sm"
          />
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="new-preference-scope">
              {t.where}
            </label>
            <select
              id="new-preference-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value === "board" ? "board" : "all")}
              className="h-10 min-w-0 flex-1 rounded-full border border-input bg-background px-3 text-sm sm:flex-none"
            >
              <option value="all">{t.all}</option>
              <option value="board">{t.board}</option>
            </select>
            <button
              type="submit"
              disabled={!text.trim() || saving}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                (!text.trim() || saving) && "opacity-50",
              )}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.add}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="observed" className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 id="observed" className="flex items-center gap-2 text-lg font-semibold">
          <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
          {t.observed}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t.observedNote}</p>
        {data.observations.length ? (
          <div className="mt-4 space-y-4">
            {data.observations.map((observation) => (
              <div key={observation.scope} className="rounded-xl bg-muted/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{observation.scope === "all" ? t.general : t.course(observation.title)}</h3>
                  <button
                    type="button"
                    onClick={() => void forget(observation.scope)}
                    className="rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t.forget}
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {noteSections(observation.notes).map((section) => (
                    <div key={section.heading}>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{section.heading.toLowerCase()}</p>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm leading-relaxed">
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t.nothingObserved}</p>
        )}
      </section>
      {dialog}
    </div>
  );
}
