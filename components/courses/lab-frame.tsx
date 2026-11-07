"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExternalLink, Maximize2, Minimize2, MonitorSmartphone } from "lucide-react";
import { DotLoader } from "@/components/ui/dot-loader";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Tip } from "@/components/ui/tip";
import { LAB_URL, labEmbedUrl, labNotebookUrl } from "@/lib/lab";
import { cn } from "@/lib/utils";

// The lesson's notebook inside the lesson page (docs/notebook-embed.md): the learner's own lab, in JupyterLab's
// single-document view, in a frame. The lab may be stopped: until JupyterLab says it's ready (a message from the
// tutor extension's language plugin), the frame sits under the platform's own "starting your lab" card; after a
// minute the card steps aside, showing whatever the hub says, with a way to open the lab in a new tab.

const COPY = {
  es: {
    title: (notebook: string) => `Notebook: ${notebook}`,
    starting: "Encendiendo tu laboratorio…",
    startingDetail: "Si estaba apagado, tarda unos segundos (la primera vez, alrededor de un minuto). Tus archivos te esperan donde los dejaste.",
    slow: "Esto está tardando más de lo normal. Puedes seguir esperando aquí o abrir el laboratorio en una pestaña nueva.",
    openNewTab: "Abrir en una pestaña nueva",
    fullLab: "Abrir el laboratorio completo",
    fullLabHint: "Con el explorador de archivos, terminales y tus otros notebooks, en una pestaña nueva",
    fullscreen: "Pantalla completa",
    exitFullscreen: "Salir de pantalla completa",
    phoneTitle: "El notebook necesita una pantalla más grande",
    phoneBody: "En el teléfono, ábrelo en tu laboratorio, en una pestaña nueva. En una tableta o computadora lo verás aquí mismo.",
    openInLab: "Abrir en tu laboratorio",
  },
  en: {
    title: (notebook: string) => `Notebook: ${notebook}`,
    starting: "Starting your lab…",
    startingDetail: "If it was stopped, it takes a few seconds (about a minute the first time). Your files are where you left them.",
    slow: "This is taking longer than usual. You can keep waiting here or open the lab in a new tab.",
    openNewTab: "Open in a new tab",
    fullLab: "Open the full lab",
    fullLabHint: "With the file browser, terminals and your other notebooks, in a new tab",
    fullscreen: "Full screen",
    exitFullscreen: "Exit full screen",
    phoneTitle: "The notebook needs a bigger screen",
    phoneBody: "On a phone, open it in your lab, in a new tab. On a tablet or computer you'll see it right here.",
    openInLab: "Open in your lab",
  },
};

const SLOW_MS = 60_000;
const LAB_ORIGIN = new URL(LAB_URL).origin;

/** Below 768 px JupyterLab isn't usable: the tab offers the lab in a new tab instead of a frame. */
function subscribeWidth(onChange: () => void) {
  const query = window.matchMedia("(min-width: 768px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const wideEnough = () => window.matchMedia("(min-width: 768px)").matches;

export function LabFrame({ courseSlug, sourcePath, language }: { courseSlug: string; sourcePath: string; language: "es" | "en" }) {
  const t = COPY[language];
  // Mounted in the browser only (never on the server, see lesson-workspace.tsx), so this is the real width from the first
  // render: on a phone the frame never mounts.
  const wide = useSyncExternalStore(subscribeWidth, wideEnough, () => false);
  const fullLab = labNotebookUrl(courseSlug, sourcePath);
  const notebook = sourcePath.split("/").pop() ?? sourcePath;

  if (!wide) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-tile)]">
        <MonitorSmartphone className="size-6 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t.phoneTitle}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.phoneBody}</p>
        </div>
        <ShimmerButton href={fullLab} external tone="signal" size="lg">
          {t.openInLab}
          <ExternalLink className="size-4" strokeWidth={2.25} aria-hidden="true" />
        </ShimmerButton>
      </div>
    );
  }
  // A new language is a new frame: the lab reads the platform's language when it loads (docs/notebook-embed.md).
  return <Frame key={language} src={labEmbedUrl(courseSlug, sourcePath)} fullLab={fullLab} title={t.title(notebook)} t={t} />;
}

function Frame({ src, fullLab, title, t }: { src: string; fullLab: string; title: string; t: (typeof COPY)["es"] }) {
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  // "Ready" comes from the lab's own page in this frame, and only from it.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== LAB_ORIGIN || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (data?.source === "academia-lab" && data.type === "ready") setReady(true);
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen().catch(() => {});
  };

  const covered = !ready && !slow;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Tip content={t.fullLabHint}>
          <a
            href={fullLab}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.fullLab}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </Tip>
        <Tip content={fullscreen ? t.exitFullscreen : t.fullscreen}>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t.exitFullscreen : t.fullscreen}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {fullscreen ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
          </button>
        </Tip>
      </div>

      {slow && !ready && (
        <p role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <span className="flex-1">{t.slow}</span>
          <a href={fullLab} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
            {t.openNewTab} <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </p>
      )}

      <div ref={box} className="relative h-[calc(100dvh-9rem)] min-h-[520px] overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-tile)]">
        <iframe
          ref={frame}
          src={src}
          title={title}
          // JupyterLab copies and pastes cells through the clipboard; full screen is the button above; the tutor's voice
          // conversation needs the microphone, and reads replies aloud (docs/voice.md).
          allow="clipboard-read; clipboard-write; fullscreen; microphone; autoplay"
          className={cn("size-full border-0 bg-background transition-opacity duration-300", covered ? "opacity-0" : "opacity-100")}
        />
        {covered && (
          <div role="status" className="absolute inset-0 flex items-center justify-center bg-card p-6">
            <div className="flex max-w-sm flex-col items-center gap-4 text-center">
              <DotLoader />
              <p className="text-lg font-medium tracking-tight">{t.starting}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{t.startingDetail}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
