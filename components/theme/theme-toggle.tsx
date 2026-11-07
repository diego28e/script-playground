"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Tip } from "@/components/ui/tip";
import { useLanguage } from "@/components/providers/language-provider";

type Theme = "light" | "dark";

const LABELS = {
  en: { light: "Switch to light theme", dark: "Switch to dark theme" },
  es: { light: "Cambiar al tema claro", dark: "Cambiar al tema oscuro" },
};
const CHANGE_EVENT = "themechange";
const DARK_QUERY = "(prefers-color-scheme: dark)";

// Two themes, light and dark. Until the viewer picks one, the site follows the operating system (ThemeScript), and a
// pick that matches the operating system goes back to following it: a choice is only stored while it differs. So
// every click changes what's on screen; an earlier third state, "system", looked the same as one of the other two,
// and one click in three changed nothing.
//
// <html data-theme> says "system" while following, or the stored choice; the "dark" class on <html> is what shows,
// and what this reads, as an external store (the server render assumes light; the browser's real theme takes over
// right after, and ThemeScript has already painted it).
function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
function getShown(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function show(theme: Theme, choice: Theme | "system") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = choice;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeToggle() {
  const { language } = useLanguage();
  const shown = useSyncExternalStore(subscribe, getShown, () => "light" as Theme);

  // While following the operating system, follow it live (it may switch to dark at night).
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const follow = () => {
      if (document.documentElement.dataset.theme === "system") show(media.matches ? "dark" : "light", "system");
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const toggle = () => {
    const next: Theme = shown === "dark" ? "light" : "dark";
    const system: Theme = window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
    try {
      if (next === system) localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      // Storage can be blocked: the theme then lasts until the page reloads.
    }
    show(next, next === system ? "system" : next);
  };

  // The button offers the other theme: a moon in light, a sun in dark.
  const target: Theme = shown === "dark" ? "light" : "dark";
  const Icon = target === "dark" ? Moon : Sun;
  const label = LABELS[language][target];
  return (
    <Tip content={label} side="bottom">
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon key={target} className="theme-icon size-4" aria-hidden="true" />
      </button>
    </Tip>
  );
}
