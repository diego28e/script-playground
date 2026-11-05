import { cn } from "@/lib/utils";

// The Academia del Código mark: "{a}" in mono on an ink tile. The lab's hub pages draw the same mark.
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-xl bg-ink font-mono text-[13px] font-medium text-ink-foreground",
        className,
      )}
    >
      {"{a}"}
    </span>
  );
}
