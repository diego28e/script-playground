"use client";

import type { CSSProperties, ReactNode } from "react";
import { useLinkStatus } from "next/link";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

type PendingFaceProps = {
  pending: boolean;
  children: ReactNode;
  /** Shown next to the loader while pending, e.g. "Saving…". Without it the loader stands alone. */
  label?: ReactNode;
  /** Milliseconds before the loader appears (links use 100 so instant navigations never flicker). */
  delay?: number;
  loaderSize?: number;
  className?: string;
};

// The inside of a button or link that can be busy. While pending the label fades out and a DotLoader takes its
// place in the same box, so the control keeps its size and nothing around it moves. The parent must be
// `position: relative` (Button and ShimmerButton are). Styles: `.pending-*` in app/globals.css.
export function PendingFace({ pending, children, label, delay, loaderSize = 16, className }: PendingFaceProps) {
  return (
    <span
      data-pending={pending ? "true" : "false"}
      className="contents"
      style={delay ? ({ "--pending-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      <span className={cn("pending-label inline-flex items-center justify-center", className)}>{children}</span>
      <span
        role={pending ? "status" : undefined}
        aria-hidden={pending ? undefined : true}
        className="pending-overlay pointer-events-none absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap text-xs"
      >
        {pending && <DotLoader size={loaderSize} />}
        {pending && label}
        {pending && !label && <span className="sr-only">Loading</span>}
      </span>
    </span>
  );
}

/** PendingFace for the inside of a next/link Link: busy from the click until the next page is on screen. */
export function LinkPendingFace(props: Omit<PendingFaceProps, "pending" | "delay">) {
  const { pending } = useLinkStatus();
  return <PendingFace pending={pending} delay={100} {...props} />;
}
