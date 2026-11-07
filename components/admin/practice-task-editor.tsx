"use client";

import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Wand2 } from "lucide-react";
import {
  aiEditPracticeTask,
  savePracticeTaskEdit,
  type SkillTask,
} from "@/actions/practice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

// Editing one practice task (docs/practice.md, "Editing a task"), by hand or by asking a model for a rewrite. Either
// way the result is proven again before it's saved: the edit joins the pool as a new task and the old one is retired.

/** The models an admin can pick for an AI edit (the authoring chain), provided by the review page. */
export const TaskModelsContext = createContext<{ id: string; label: string }[]>(
  [],
);
const DEFAULT_EDIT_MODEL = "claude-sonnet-5-5";

type Content = SkillTask["content"];

const FIELD =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CODE = cn(FIELD, "font-mono text-xs leading-relaxed");

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

/** A textarea as tall as its text. */
function Area({
  value,
  onChange,
  code,
  minRows = 2,
}: {
  value: string;
  onChange: (value: string) => void;
  code?: boolean;
  minRows?: number;
}) {
  const rows = Math.min(
    Math.max(value.split("\n").length + (code ? 1 : 0), minRows),
    28,
  );
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      spellCheck={!code}
      className={cn(code ? CODE : FIELD, "resize-y")}
    />
  );
}

export function TaskEditor({
  task,
  open,
  onOpenChange,
  onSaved,
}: {
  task: SkillTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const models = useContext(TaskModelsContext);
  const [draft, setDraft] = useState<Content>(task.content);
  const [editedWith, setEditedWith] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [model, setModel] = useState(
    models.some((entry) => entry.id === DEFAULT_EDIT_MODEL)
      ? DEFAULT_EDIT_MODEL
      : (models[0]?.id ?? DEFAULT_EDIT_MODEL),
  );
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const set = <K extends keyof Content>(key: K, value: Content[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const form = task.form;

  const rewrite = async () => {
    setBusy("ai");
    const result = await aiEditPracticeTask(task.id, instruction, model).catch(
      () => null,
    );
    setBusy(null);
    if (!result || !result.success) {
      toast.error(
        result && !result.success
          ? result.error
          : "The rewrite didn't come back. Try again.",
      );
      return;
    }
    setDraft(result.task);
    setEditedWith(result.model);
    toast.success(`Rewritten by ${result.model}. Review it below, then save.`);
  };

  const save = async () => {
    setBusy("save");
    const result = await savePracticeTaskEdit(task.id, draft, editedWith).catch(
      () => null,
    );
    setBusy(null);
    if (!result || !result.success) {
      toast.error(
        result && !result.success
          ? result.error
          : "The task couldn't be saved. Try again.",
        { duration: 12000 },
      );
      return;
    }
    toast.success(
      `Saved and proven${result.note ? `: ${result.note}` : ""}. The old version is retired.`,
    );
    onOpenChange(false);
    onSaved();
  };

  const options = (lang: "Es" | "En") => {
    const key = `options${lang}` as const;
    const list = draft[key] ?? ["", "", "", ""];
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-4 text-xs font-medium text-muted-foreground">
              {String.fromCharCode(65 + index)}
            </span>
            <input
              value={list[index] ?? ""}
              onChange={(event) =>
                set(
                  key,
                  list.map((option, at) =>
                    at === index ? event.target.value : option,
                  ),
                )
              }
              className={cn(
                FIELD,
                "py-1.5",
                draft.answerIndex === index && "border-emerald-500/60",
              )}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            Saving proves the task again (code runs on the grader; a question is
            answered blind by a second model). When it passes, it replaces this
            one, which is retired; answers already given keep pointing at the
            old version.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2 rounded-xl bg-muted/50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Wand2 className="h-4 w-4" /> Edit with AI
          </p>
          <Area value={instruction} onChange={setInstruction} minRows={2} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Model"
            >
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void rewrite()}
              disabled={busy !== null || !instruction.trim()}
            >
              {busy === "ai" ? (
                <DotLoader className="mr-2" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {busy === "ai" ? "Rewriting…" : "Rewrite"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Say what to change, for example &quot;make the distractors less
            obvious&quot; or &quot;use a dict instead of a list&quot;. The
            rewrite fills the fields below; nothing is saved until you save.
          </p>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Prompt (Spanish, Markdown)">
            <Area
              value={draft.promptEs}
              onChange={(value) => set("promptEs", value)}
              minRows={4}
            />
          </Field>
          <Field label="Prompt (English, Markdown)">
            <Area
              value={draft.promptEn}
              onChange={(value) => set("promptEn", value)}
              minRows={4}
            />
          </Field>

          {form === "choice" && (
            <>
              <Field label="Options (Spanish)">{options("Es")}</Field>
              <Field label="Options (English)">{options("En")}</Field>
              <Field label="Right option">
                <select
                  value={draft.answerIndex ?? 0}
                  onChange={(event) =>
                    set("answerIndex", Number(event.target.value))
                  }
                  className={cn(FIELD, "h-9 py-0")}
                >
                  {[0, 1, 2, 3].map((index) => (
                    <option key={index} value={index}>
                      {String.fromCharCode(65 + index)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {form === "fill" && (
            <Field
              label="Accepted answers, one per line"
              hint="Compared ignoring case, spaces at the ends, and surrounding backticks or quotes."
            >
              <Area
                value={(draft.answers ?? []).join("\n")}
                onChange={(value) =>
                  set(
                    "answers",
                    value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  )
                }
              />
            </Field>
          )}
          {form === "predict" && (
            <>
              <Field label="Code">
                <Area
                  value={draft.code ?? ""}
                  onChange={(value) => set("code", value)}
                  code
                  minRows={4}
                />
              </Field>
              <div className="space-y-4">
                <Field label="What it prints (checked on the grader)">
                  <Area
                    value={draft.expectedOutput ?? ""}
                    onChange={(value) => set("expectedOutput", value)}
                    code
                  />
                </Field>
                <Field label="Likely wrong answer (must differ)">
                  <Area
                    value={draft.wrongOutput ?? ""}
                    onChange={(value) => set("wrongOutput", value)}
                    code
                  />
                </Field>
              </div>
            </>
          )}
          {(form === "code" || form === "debug") && (
            <>
              <Field
                label={
                  form === "code"
                    ? "Starter the learner edits"
                    : "Buggy code the learner fixes"
                }
              >
                <Area
                  value={draft.code ?? ""}
                  onChange={(value) => set("code", value)}
                  code
                  minRows={6}
                />
              </Field>
              <Field label="Tests (hidden from the learner)">
                <Area
                  value={draft.tests ?? ""}
                  onChange={(value) => set("tests", value)}
                  code
                  minRows={6}
                />
              </Field>
              <Field
                label={
                  form === "code"
                    ? "Reference solution (must pass)"
                    : "Fixed code (must pass)"
                }
              >
                <Area
                  value={draft.solution ?? ""}
                  onChange={(value) => set("solution", value)}
                  code
                  minRows={6}
                />
              </Field>
              {form === "code" && (
                <Field label="Wrong solution (must fail)">
                  <Area
                    value={draft.wrongSolution ?? ""}
                    onChange={(value) => set("wrongSolution", value)}
                    code
                    minRows={6}
                  />
                </Field>
              )}
              {form === "code" &&
                (["Es", "En"] as const).map((language) => (
                  <Field
                    key={language}
                    label={`Recipe (${language === "Es" ? "Spanish" : "English"}), one step per line`}
                    hint="3 to 7 steps in plain words, the same number in both languages. Names in backticks are fine; code, calls and expressions aren't."
                  >
                    <Area
                      value={(draft[`recipe${language}`] ?? []).join("\n")}
                      onChange={(value) =>
                        set(
                          `recipe${language}`,
                          value
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                        )
                      }
                      minRows={4}
                    />
                  </Field>
                ))}
            </>
          )}

          <Field label="Explanation (Spanish)">
            <Area
              value={draft.explanationEs}
              onChange={(value) => set("explanationEs", value)}
              minRows={3}
            />
          </Field>
          <Field label="Explanation (English)">
            <Area
              value={draft.explanationEn}
              onChange={(value) => set("explanationEn", value)}
              minRows={3}
            />
          </Field>
          <div className="flex gap-4">
            <Field
              label="Difficulty for its stage"
              hint="-1 easy, 0 typical, 1 hard"
            >
              <input
                type="number"
                min={-1}
                max={1}
                step={0.5}
                value={draft.difficulty}
                onChange={(event) =>
                  set("difficulty", Number(event.target.value))
                }
                className={cn(FIELD, "w-28")}
              />
            </Field>
            <Field label="Seconds it takes">
              <input
                type="number"
                min={10}
                max={900}
                step={5}
                value={draft.expectedSeconds}
                onChange={(event) =>
                  set("expectedSeconds", Number(event.target.value))
                }
                className={cn(FIELD, "w-28")}
              />
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {busy === "save" && (
            <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
              <DotLoader /> Proving the edit: up to half a minute…
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy !== null}
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy !== null}>
            {busy === "save" ? "Proving…" : "Save and prove"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
