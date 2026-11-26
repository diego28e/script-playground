"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// Full screen for the board page (docs/whiteboard-contract.md §4): the frame fills the window and the site's header and
// the board's bar step aside; the browser's Fullscreen API is asked where it exists (not Safari on an iPhone, where the
// layout alone does it). The platform's bar has the button to go in; while in, Didactra's page shows the way out and
// says so with a message, as do Back, Escape and the system's own full-screen exit. Each side tells the other.

type Message = { source?: unknown; type?: unknown; on?: unknown };

export function useBoardFullscreen(container: RefObject<HTMLElement | null>, frame: RefObject<HTMLIFrameElement | null>, boardOrigin: string) {
  const [full, setFull] = useState(false);
  // A history entry is pushed on the way in, so the browser's Back leaves full screen before it leaves the page.
  const pushed = useRef(false);

  const tellBoard = useCallback(
    (on: boolean) => {
      try {
        frame.current?.contentWindow?.postMessage({ source: "academia", type: "fullscreen", on }, boardOrigin);
      } catch {
        // The frame isn't there yet: it's told when it loads.
      }
    },
    [boardOrigin, frame],
  );

  const enter = useCallback(() => {
    setFull(true);
    if (!pushed.current) {
      window.history.pushState({ ...(window.history.state ?? {}), boardFullscreen: true }, "");
      pushed.current = true;
    }
    const element = container.current;
    if (element && document.fullscreenEnabled && !document.fullscreenElement) void element.requestFullscreen?.().catch(() => undefined);
  }, [container]);

  const leave = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    }
  }, []);

  // Didactra's page asks, from its own origin only.
  useEffect(() => {
    const onMessage = (event: MessageEvent<Message>) => {
      if (event.origin !== boardOrigin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "didactra" || data.type !== "fullscreen") return;
      if (data.on === true) enter();
      else if (data.on === false) leave();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [boardOrigin, enter, frame, leave]);

  // Back, the system's exit, and Escape (when the page itself has the keyboard) leave it too.
  useEffect(() => {
    if (!full) return;
    const onPop = () => {
      pushed.current = false;
      setFull(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) leave();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") leave();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("popstate", onPop);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKey);
    };
  }, [full, leave]);

  // The board shows the state it's told: on every change, and when the frame (re)loads.
  useEffect(() => tellBoard(full), [full, tellBoard]);

  return { full, enter, leave, onFrameLoad: () => tellBoard(full) };
}
