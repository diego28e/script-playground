"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small menu that opens above its button in the player's bar (speed, captions). Drawn inside the player, not in a
 * portal: in fullscreen only the player is on screen, and a menu outside it would not show. Arrow keys move through
 * the choices, Escape closes it, and a click elsewhere too.
 */
export function PlayerMenu<T extends string | number>({
  label,
  trigger,
  triggerLabel,
  active,
  options,
  value,
  onChange,
  open,
  onOpenChange,
}: {
  /** The menu's name, read by screen readers ("Playback speed"). */
  label: string;
  trigger: ReactNode;
  /** The button's accessible name, with its current value ("Playback speed, 1.5×"). */
  triggerLabel: string;
  /** The setting is away from its default: the button shows it in the accent. */
  active?: boolean;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    // The chosen item takes focus, so the arrow keys work at once.
    rootRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']")?.focus();
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70",
          active ? "bg-signal/15 text-signal hover:bg-signal/25" : "text-white/85 hover:bg-white/10 hover:text-white",
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full right-0 z-30 mb-2 min-w-[9.5rem] rounded-xl border border-white/10 bg-[#0f1520]/95 p-1 shadow-xl backdrop-blur-md"
        >
          <p className="px-2.5 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">{label}</p>
          {options.map((option) => {
            const chosen = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                onClick={() => {
                  onChange(option.value);
                  onOpenChange(false);
                  triggerRef.current?.focus();
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:bg-white/10",
                  chosen ? "text-signal" : "text-white/85 hover:bg-white/10 hover:text-white",
                )}
              >
                {option.label}
                {chosen && <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
