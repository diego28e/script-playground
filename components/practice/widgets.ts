// The practice widgets beside a course's practice (docs/practice.md, "Widgets"): the scratchbook and the coach. One is
// open at a time, on a phone and on a computer, so neither ever sits over the other: opening one says so on the window,
// and the other closes (the scratchbook keeps its code in the browser, the coach its conversation on the server). The
// open one is named on the root element, which moves the other's button clear of it (app/globals.css).

export type PracticeWidget = "scratchbook" | "coach";

const OPENED = "adc:practice-widget-opened";

/** Says a widget opened (the other closes) and marks it on the root; `false` clears the mark if it is still this one. */
export function markWidget(widget: PracticeWidget, open: boolean) {
  const root = document.documentElement;
  if (open) {
    root.dataset.practiceWidget = widget;
    window.dispatchEvent(new CustomEvent<PracticeWidget>(OPENED, { detail: widget }));
  } else if (root.dataset.practiceWidget === widget) {
    delete root.dataset.practiceWidget;
  }
}

/** Calls `close` when another widget opens. Returns the clean-up, for an effect. */
export function onOtherWidgetOpened(widget: PracticeWidget, close: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<PracticeWidget>).detail !== widget) close();
  };
  window.addEventListener(OPENED, listener);
  return () => window.removeEventListener(OPENED, listener);
}
