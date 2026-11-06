"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, CheckCheck, Link2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The platform's own confirmation and one-line prompt dialogs, in its colours and type: the browser's confirm(),
// alert() and prompt() are never used. Each hook returns a promise to await and the element to render:
//
//   const { confirm, dialog } = useConfirm();
//   if (!(await confirm({ title: "Approve all?", confirmLabel: "Approve" }))) return;
//   ...
//   return <>{dialog}…</>;
//
// The motion (globals.css, "Action dialog"): the backdrop fades, the card rises and settles, the icon pops in with one
// ring; all of it is skipped when the person prefers reduced motion.

type Tone = "default" | "danger";

type DialogOptions = {
  title: string;
  description?: React.ReactNode;
  /** A short fact under the title, such as "107 lessons". */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger: a destructive action (red, and Cancel takes the focus). */
  tone?: Tone;
  icon?: LucideIcon;
};

export type ConfirmOptions = DialogOptions;
export type PromptOptions = DialogOptions & {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: "text" | "url";
  /** A message when the value can't be used, or null when it can. */
  validate?: (value: string) => string | null;
};

const TONE: Record<Tone, { icon: string; confirm: "default" | "destructive" }> = {
  // The brand accent: lime in the dark theme (the focus ring colour), ink in the light one.
  default: { icon: "bg-ring/15 text-ring", confirm: "default" },
  danger: { icon: "bg-destructive/12 text-destructive", confirm: "destructive" },
};

function ActionDialog({
  open,
  options,
  prompt,
  onSettle,
}: {
  open: boolean;
  options: DialogOptions & Partial<Omit<PromptOptions, keyof DialogOptions>>;
  prompt: boolean;
  onSettle: (confirmed: boolean, value?: string) => void;
}) {
  const tone = options.tone ?? "default";
  const Icon = options.icon ?? (tone === "danger" ? AlertTriangle : prompt ? Link2 : CheckCheck);
  const [value, setValue] = React.useState(options.defaultValue ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const submit = () => {
    if (prompt) {
      const trimmed = value.trim();
      const problem = !trimmed ? `${options.label} is empty.` : (options.validate?.(trimmed) ?? null);
      if (problem) {
        setError(problem);
        inputRef.current?.focus();
        return;
      }
      onSettle(true, trimmed);
      return;
    }
    onSettle(true);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onSettle(false)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="action-dialog-overlay fixed inset-0 z-50 bg-black/55" />
        <DialogPrimitive.Content
          role={prompt ? "dialog" : "alertdialog"}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (prompt ? inputRef : tone === "danger" ? cancelRef : confirmRef).current?.focus();
          }}
          className="action-dialog fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-2xl bg-card text-card-foreground shadow-[var(--shadow-float)] focus:outline-none"
        >
          <div className="flex flex-col items-center gap-3 px-6 pb-6 pt-8 text-center">
            <span className={cn("action-dialog-icon relative flex size-12 items-center justify-center rounded-full", TONE[tone].icon)}>
              <Icon className="size-6" aria-hidden />
            </span>
            <DialogPrimitive.Title className="text-lg font-semibold leading-snug tracking-tight">{options.title}</DialogPrimitive.Title>
            {options.detail && <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium tabular-nums">{options.detail}</span>}
          </div>

          <form
            className="flex flex-col gap-5 bg-muted/60 px-6 pb-6 pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {options.description ? (
              <DialogPrimitive.Description className="text-center text-sm leading-relaxed text-muted-foreground">{options.description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{options.title}</DialogPrimitive.Description>
            )}
            {prompt && (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{options.label}</span>
                <input
                  ref={inputRef}
                  type={options.inputType ?? "text"}
                  value={value}
                  placeholder={options.placeholder}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError(null);
                  }}
                  aria-invalid={Boolean(error)}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
                />
                {error && <span className="text-destructive">{error}</span>}
              </label>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
              <Button ref={cancelRef} type="button" variant="ghost" onClick={() => onSettle(false)} className="sm:min-w-28">
                {options.cancelLabel ?? "Cancel"}
              </Button>
              <Button ref={confirmRef} type="submit" variant={TONE[tone].confirm} className="sm:min-w-28">
                {options.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type Pending<T> = { options: DialogOptions & Partial<PromptOptions>; resolve: (value: T) => void; key: number };

function useActionDialog<T>(prompt: boolean, fromSettle: (confirmed: boolean, value?: string) => T) {
  const [pending, setPending] = React.useState<Pending<T> | null>(null);
  const [open, setOpen] = React.useState(false);
  const settled = React.useRef(true);

  const ask = React.useCallback((options: DialogOptions & Partial<PromptOptions>) => {
    return new Promise<T>((resolve) => {
      settled.current = false;
      setPending((current) => ({ options, resolve, key: (current?.key ?? 0) + 1 }));
      setOpen(true);
    });
  }, []);

  const onSettle = (confirmed: boolean, value?: string) => {
    if (settled.current || !pending) return;
    settled.current = true;
    pending.resolve(fromSettle(confirmed, value));
    // The dialog stays mounted, closed, so its exit animation can play.
    setOpen(false);
  };

  const dialog = pending ? <ActionDialog key={pending.key} open={open} options={pending.options} prompt={prompt} onSettle={onSettle} /> : null;
  return { ask, dialog };
}

/** A yes/no question in the platform's own dialog: resolves true when the person confirms. */
export function useConfirm() {
  const { ask, dialog } = useActionDialog<boolean>(false, (confirmed) => confirmed);
  const confirm = React.useCallback((options: ConfirmOptions) => ask(options), [ask]);
  return { confirm, dialog };
}

/** One line of text in the platform's own dialog: resolves the trimmed value, or null when cancelled. */
export function usePrompt() {
  const { ask, dialog } = useActionDialog<string | null>(true, (confirmed, value) => (confirmed ? (value ?? null) : null));
  const prompt = React.useCallback((options: PromptOptions) => ask(options), [ask]);
  return { prompt, dialog };
}
