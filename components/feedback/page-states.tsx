"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { DotLoader } from "@/components/ui/dot-loader";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { useLanguage } from "@/components/providers/language-provider";
import { cn } from "@/lib/utils";

// Whole-page states shared by every route: loading (loading.tsx), error (error.tsx) and not found
// (not-found.tsx). They fill the space between the navbar and the footer, centered, in the card style
// of the sign-in page.

const COPY = {
  es: {
    loading: "Cargando…",
    errorEyebrow: "Error",
    errorTitle: "Algo salió mal",
    errorBody: "No pudimos cargar esta página. Suele ser algo pasajero: inténtalo de nuevo en un momento.",
    retry: "Reintentar",
    home: "Ir al inicio",
    reference: "Referencia",
    notFoundEyebrow: "404",
    notFoundTitle: "No encontramos esta página",
    notFoundBody: "Puede que el enlace esté mal escrito o que la página ya no exista.",
    courses: "Ver los cursos",
  },
  en: {
    loading: "Loading…",
    errorEyebrow: "Error",
    errorTitle: "Something went wrong",
    errorBody: "We couldn't load this page. It's usually temporary, so try again in a moment.",
    retry: "Try again",
    home: "Go home",
    reference: "Reference",
    notFoundEyebrow: "404",
    notFoundTitle: "We can't find this page",
    notFoundBody: "The link may be mistyped, or the page may no longer exist.",
    courses: "Browse courses",
  },
};

export function PageLoader({ className }: { className?: string }) {
  const { language } = useLanguage();
  return (
    <div role="status" className={cn("flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-4 px-4", className)}>
      <DotLoader size={40} className="text-foreground" />
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{COPY[language].loading}</span>
    </div>
  );
}

function StateCard({ eyebrow, title, body, children, footer }: {
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px] overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-xl shadow-primary/5">
        <div className="px-7 pt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight text-balance">{title}</h1>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{body}</p>
        </div>
        <div className="flex flex-col gap-2.5 px-7 pb-6 pt-5">{children}</div>
        {footer && (
          <div className="border-t border-border bg-muted/30 px-7 py-2.5 text-center font-mono text-[11px] text-muted-foreground">{footer}</div>
        )}
      </div>
    </div>
  );
}

/** For error.tsx: `retry` re-renders the failed segment (Next's `reset`), `digest` identifies the error in the logs. */
export function ErrorState({ retry, digest }: { retry: () => void; digest?: string }) {
  const { language } = useLanguage();
  const t = COPY[language];
  return (
    <StateCard
      eyebrow={t.errorEyebrow}
      title={t.errorTitle}
      body={t.errorBody}
      footer={digest ? `${t.reference}: ${digest}` : undefined}
    >
      <ShimmerButton tone="ink" fullWidth onHover onClick={retry}>
        <RotateCcw className="size-4" strokeWidth={2.25} aria-hidden="true" />
        {t.retry}
      </ShimmerButton>
      <Link
        href="/"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t.home}
      </Link>
    </StateCard>
  );
}

export function NotFoundState() {
  const { language } = useLanguage();
  const t = COPY[language];
  return (
    <StateCard eyebrow={t.notFoundEyebrow} title={t.notFoundTitle} body={t.notFoundBody}>
      <ShimmerButton href="/courses" tone="ink" fullWidth onHover>
        {t.courses}
      </ShimmerButton>
      <Link
        href="/"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t.home}
      </Link>
    </StateCard>
  );
}
