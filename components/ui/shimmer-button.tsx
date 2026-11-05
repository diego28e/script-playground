"use client";

import { useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LinkPendingFace, PendingFace } from "@/components/ui/pending";

// Adapted from Klyv's ShimmerButton (MIT, Klyv contributors) to the Academia del Código tokens.
// A pill with a sheen that sweeps across it and a soft light that follows the pointer. Both are one span each,
// clipped by the pill, so the label stays readable and selectable. The pointer light is written to CSS custom
// properties rather than React state: pointer moves fire more often than frames, and only the compositor reads it.

export type ShimmerTone = "signal" | "ink" | "glass";

const TONES: Record<ShimmerTone, { shell: string; sheen: string; glow: string }> = {
  // The page's one main call to action.
  signal: {
    shell: "bg-signal text-signal-foreground shadow-[var(--shadow-tile)] hover:bg-signal-strong",
    sheen: "bg-white/70",
    glow: "rgba(255,255,255,0.6)",
  },
  // Primary actions: ink on paper, paper in the dark theme.
  ink: {
    shell: "bg-primary text-primary-foreground shadow-[var(--shadow-float)]",
    sheen: "bg-white/35 dark:bg-black/20",
    glow: "rgba(200,242,78,0.45)",
  },
  // Secondary actions.
  glass: {
    shell: "border border-border bg-card/70 text-foreground shadow-[var(--shadow-tile)] backdrop-blur hover:bg-accent",
    sheen: "bg-signal/45",
    glow: "rgba(200,242,78,0.5)",
  },
};

const SIZES = {
  sm: "h-8 px-3.5 text-[12px]",
  md: "h-10 px-5 text-[13px]",
  lg: "h-12 px-6 text-[14px]",
} as const;

type CommonProps = {
  children: ReactNode;
  tone?: ShimmerTone;
  size?: keyof typeof SIZES;
  /** Seconds between sweeps. */
  duration?: number;
  /** Sweep only on hover and focus. A sweep that never stops suits one hero button, not a toolbar. */
  onHover?: boolean;
  /** A soft light that follows the pointer across the face. */
  glow?: boolean;
  fullWidth?: boolean;
  className?: string;
  /** Busy after a click: the label gives way to the DotLoader and further clicks are ignored.
   *  Internal links (`href` without `external`) show this on their own while the next page loads. */
  pending?: boolean;
  /** Shown next to the loader while busy, e.g. "Enrolling…". */
  pendingLabel?: ReactNode;
};

type ButtonRest = { href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps>;
/** With `href` it renders a link; `external` opens it in a new tab. */
type AnchorRest = { href: string; external?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | "href">;

export type ShimmerButtonProps = CommonProps & (ButtonRest | AnchorRest);

export function shimmerShell({ tone = "ink", size = "md", fullWidth = false, className }: Pick<CommonProps, "tone" | "size" | "fullWidth" | "className">) {
  return cn(
    "group/shimmer relative isolate inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full font-semibold leading-none transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none",
    TONES[tone].shell,
    SIZES[size],
    fullWidth && "w-full",
    className,
  );
}

export function ShimmerButton({
  children,
  tone = "ink",
  size = "md",
  duration = 3,
  onHover = false,
  glow = true,
  fullWidth = false,
  className,
  pending = false,
  pendingLabel,
  ...rest
}: ShimmerButtonProps) {
  const ref = useRef<HTMLElement>(null);
  const palette = TONES[tone];

  const moveGlow = (event: PointerEvent<HTMLElement>) => {
    const node = ref.current;
    if (!glow || !node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--glow-x", `${event.clientX - rect.left}px`);
    node.style.setProperty("--glow-y", `${event.clientY - rect.top}px`);
    node.style.setProperty("--glow-opacity", "1");
  };
  const hideGlow = () => ref.current?.style.setProperty("--glow-opacity", "0");

  const effects = (
    <>
      {glow && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -z-10 size-[150px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[var(--glow-opacity,0)] blur-2xl transition-opacity duration-500"
          style={{ left: "var(--glow-x, 50%)", top: "var(--glow-y, 50%)", background: `radial-gradient(circle, ${palette.glow} 0%, transparent 70%)` }}
        />
      )}
      <span
        aria-hidden="true"
        className={cn(
          "shimmer-sheen pointer-events-none absolute inset-y-0 left-0 -z-10 w-1/3 blur-[6px]",
          palette.sheen,
          // Paused rather than unmounted, so a sweep starts from the left edge the moment the pointer arrives.
          onHover &&
            "opacity-0 [animation-play-state:paused] group-hover/shimmer:opacity-100 group-hover/shimmer:[animation-play-state:running] group-focus-visible/shimmer:opacity-100 group-focus-visible/shimmer:[animation-play-state:running]",
        )}
        style={{ animation: `shimmer-sweep ${duration}s ease-in-out infinite` }}
      />
    </>
  );
  const label = <span className="relative inline-flex items-center gap-2">{children}</span>;
  // Busy is not "unavailable": full opacity while the native disabled blocks repeat clicks.
  const shell = shimmerShell({ tone, size, fullWidth, className: cn(className, pending && "disabled:opacity-100") });

  if (rest.href !== undefined) {
    const { href, external, onPointerMove, onPointerLeave, ...anchor } = rest as AnchorRest;
    const handlers = {
      onPointerMove: (event: PointerEvent<HTMLAnchorElement>) => {
        onPointerMove?.(event);
        moveGlow(event);
      },
      onPointerLeave: (event: PointerEvent<HTMLAnchorElement>) => {
        onPointerLeave?.(event);
        hideGlow();
      },
    };
    const anchorRef = ref as React.Ref<HTMLAnchorElement>;
    return external ? (
      // A new tab opens at once: the page itself has nothing to wait for.
      <a ref={anchorRef} href={href} target="_blank" rel="noopener noreferrer" className={shell} {...handlers} {...anchor}>
        {effects}
        {label}
      </a>
    ) : (
      <Link ref={anchorRef} href={href} className={shell} {...handlers} {...anchor}>
        {effects}
        <LinkPendingFace label={pendingLabel}>{label}</LinkPendingFace>
      </Link>
    );
  }

  const { onPointerMove, onPointerLeave, type = "button", disabled, ...button } = rest as ButtonRest;
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={type}
      className={shell}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        moveGlow(event);
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        hideGlow();
      }}
      {...button}
    >
      {effects}
      <PendingFace pending={pending} label={pendingLabel}>
        {label}
      </PendingFace>
    </button>
  );
}
