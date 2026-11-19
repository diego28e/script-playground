"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/providers/language-provider";

// A diagram in a course guide (docs/lesson-diagrams.md): a fenced code block tagged `mermaid`, drawn in the browser.
//
// - The guide itself is rendered on the server. This is the one piece of it that runs in the browser, and the
//   Mermaid library is only downloaded on a lesson that has a diagram, after the page has painted.
// - Colours and the font come from the site's own tokens, read from <html>, and the diagram is drawn again when the
//   theme switches.
// - Mermaid runs at its "strict" security level: labels are sanitised and a diagram can't carry scripts or click
//   handlers.
// - A diagram never pushes the page sideways. It shrinks to fit, down to the size where its text is still readable;
//   a diagram too wide for that scrolls inside its own box, as tables and code blocks do.
// - If the text isn't a valid diagram, or the library can't be loaded, the source is shown as a code block.

type Props = { source: string };
type Status = "drawing" | "drawn" | "failed";

const STRINGS = {
  en: { failed: "This diagram couldn't be drawn. Its source is shown instead." },
  es: { failed: "No se pudo dibujar este diagrama. Se muestra su texto." },
};

/** A diagram shrinks to this share of its drawn size and no further (its 14px text is then about 8px). */
const READABLE_SCALE = 0.6;

// One download, shared by every diagram on the page.
let library: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  library ??= import("mermaid").then((module) => module.default);
  return library;
}

// The theme is the "dark" class on <html> (components/theme/theme-script.tsx sets it, the toggle changes it).
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

/** The site's palette (app/globals.css) as the variables of Mermaid's "base" theme. */
function themeVariables(dark: boolean) {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const ink = token("--foreground");
  const line = token("--muted-foreground");
  const box = token("--secondary");
  const edge = token("--input");
  return {
    darkMode: dark,
    fontFamily: getComputedStyle(document.body).fontFamily,
    fontSize: "14px",
    background: token("--card"),
    // Boxes: a quiet fill, a clear outline, ink text.
    primaryColor: box,
    primaryTextColor: ink,
    primaryBorderColor: line,
    secondaryColor: token("--accent"),
    secondaryTextColor: ink,
    secondaryBorderColor: edge,
    // Groups (a VPC, a subnet) sit behind the boxes, in the page's own paper colour.
    tertiaryColor: token("--background"),
    tertiaryTextColor: ink,
    tertiaryBorderColor: edge,
    clusterBkg: token("--background"),
    clusterBorder: edge,
    titleColor: ink,
    textColor: ink,
    lineColor: line,
    arrowheadColor: line,
    edgeLabelBackground: token("--card"),
    // Sequence diagrams.
    actorBkg: box,
    actorBorder: line,
    actorTextColor: ink,
    actorLineColor: edge,
    signalColor: ink,
    signalTextColor: ink,
    labelBoxBkgColor: box,
    labelBoxBorderColor: line,
    labelTextColor: ink,
    loopTextColor: ink,
    activationBkgColor: token("--accent"),
    activationBorderColor: line,
    sequenceNumberColor: token("--card"),
    noteBkgColor: token("--muted"),
    noteTextColor: ink,
    noteBorderColor: edge,
  };
}

export function MermaidDiagram({ source }: Props) {
  const { language } = useLanguage();
  // useId gives ":r1:"; Mermaid uses the id in CSS selectors, where a colon would need escaping.
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const canvas = useRef<HTMLDivElement>(null);
  const drawings = useRef(0);
  const dark = useSyncExternalStore(subscribeToTheme, isDark, () => false);
  const [status, setStatus] = useState<Status>("drawing");

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // Without this, Mermaid draws its own error picture at the end of the page for an invalid diagram.
          suppressErrorRendering: true,
          theme: "base",
          themeVariables: themeVariables(dark),
        });
        // A new id for each drawing: Mermaid removes any element that already has the id it is given, which would
        // empty the box for a moment every time the theme switches.
        drawings.current += 1;
        const { svg } = await mermaid.render(`${id}-${drawings.current}`, source);
        if (!current || !canvas.current) return;
        canvas.current.innerHTML = svg;
        const drawing = canvas.current.querySelector("svg");
        if (drawing) {
          // Mermaid sizes the drawing to shrink with its box. Keep that, centre it, and stop the shrinking where
          // the text can still be read.
          const natural = drawing.viewBox.baseVal.width;
          drawing.style.display = "block";
          drawing.style.margin = "0 auto";
          drawing.style.height = "auto";
          if (natural > 0) drawing.style.minWidth = `${Math.round(natural * READABLE_SCALE)}px`;
        }
        setStatus("drawn");
      } catch {
        if (current) setStatus("failed");
      }
    })();
    return () => {
      current = false;
    };
  }, [id, source, dark]);

  if (status === "failed") {
    return (
      <figure className="my-5">
        <pre className="overflow-x-auto rounded-2xl border border-code-border bg-code p-4 font-mono text-[13px] leading-6 text-code-foreground">
          <code className="font-mono">{source}</code>
        </pre>
        <figcaption className="mt-2 text-sm text-muted-foreground">{STRINGS[language].failed}</figcaption>
      </figure>
    );
  }

  return (
    <figure className="my-6 overflow-x-auto rounded-2xl border border-border bg-card p-3 sm:p-4">
      {/* Until the drawing arrives the box keeps a height of its own, so the text below doesn't jump far. */}
      <div ref={canvas} className={status === "drawing" ? "min-h-40 animate-pulse rounded-xl bg-muted" : undefined} />
    </figure>
  );
}
