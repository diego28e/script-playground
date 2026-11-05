"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

type Theme = "system" | "light" | "dark";

const ORDER: Theme[] = ["system", "light", "dark"];
const ICONS = { system: Monitor, light: Sun, dark: Moon };
const LABELS = {
  en: { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" },
  es: { system: "Tema: sistema", light: "Tema: claro", dark: "Tema: oscuro" },
};
const CHANGE_EVENT = "themechange";

// ThemeScript writes the choice to <html data-theme>; this reads it back as an external store, so the
// server render ("system") and the first client render agree, then the real choice takes over.
function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
function getTheme(): Theme {
  const current = document.documentElement.dataset.theme as Theme | undefined;
  return current && ORDER.includes(current) ? current : "system";
}

function apply(theme: Theme) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
  document.documentElement.dataset.theme = theme;
}

// Cycles system → light → dark. The choice is per browser (localStorage), read by ThemeScript on load.
export function ThemeToggle() {
  const { language } = useLanguage();
  const theme = useSyncExternalStore(subscribe, getTheme, () => "system" as Theme);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => apply("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [theme]);

  const next = () => {
    const nextTheme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    apply(nextTheme);
    try {
      if (nextTheme === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", nextTheme);
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  const Icon = ICONS[theme];
  const label = LABELS[language][theme];
  return (
    <button
      type="button"
      onClick={next}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
