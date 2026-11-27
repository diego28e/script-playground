"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/providers/language-provider";

// A lesson's solutions, folded until the learner asks for them (docs/lesson-solutions.md): a course practised by not
// reading the solution first turns this on in Admin → Courses. The solutions are on the page all along, only hidden,
// so their headings keep their anchors: a link to one opens the fold and scrolls to it. Printing shows everything.

const COPY = {
  es: {
    note: "Inténtalo antes por tu cuenta. Las soluciones están plegadas para que no las leas sin querer.",
    show: "Mostrar soluciones",
    hide: "Ocultar soluciones",
  },
  en: {
    note: "Try it on your own first. The solutions are folded so you don't read them by accident.",
    show: "Show solutions",
    hide: "Hide solutions",
  },
} as const;

export function SolutionsFold({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const t = COPY[language === "es" ? "es" : "en"];
  const [open, setOpen] = useState(false);
  const id = useId();
  const body = useRef<HTMLDivElement>(null);

  // A link to a heading inside the fold (from the address bar or the page) opens it.
  useEffect(() => {
    const reveal = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const target = hash ? document.getElementById(hash) : null;
      if (!target || !body.current?.contains(target)) return;
      setOpen(true);
      requestAnimationFrame(() => target.scrollIntoView());
    };
    const frame = requestAnimationFrame(reveal);
    window.addEventListener("hashchange", reveal);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", reveal);
    };
  }, []);

  return (
    <>
      <div className="my-5 flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <p className="text-sm leading-6 text-muted-foreground">{t.note}</p>
        <Button type="button" variant="outline" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)} className="shrink-0 gap-2 self-start sm:self-auto [&_svg]:size-4">
          {open ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {open ? t.hide : t.show}
        </Button>
      </div>
      <div id={id} ref={body} className={open ? undefined : "hidden print:block"}>
        {children}
      </div>
    </>
  );
}
