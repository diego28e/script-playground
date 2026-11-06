"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// The platform's tooltip: never the browser's `title` (its look and timing are the OS's, not ours). Wrap the element
// that would have had the title:
//
//   <Tip content="Shortcut: A"><Button …>Approve</Button></Tip>
//
// The child must take a ref and pass props through (Button, plain elements). For one that doesn't (ShimmerButton), or
// one that can be disabled (a disabled button gets no pointer events, so its tooltip would never open), pass `wrap`:
// the tooltip then hangs on a span around it. An icon-only control still needs its own aria-label: a tooltip is shown
// on hover and focus, it doesn't name the control.

export function Tip({
  content,
  children,
  side = "top",
  wrap = false,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  wrap?: boolean;
}) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{wrap ? <span className="inline-flex">{children}</span> : children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
