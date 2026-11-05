"use client";

import { useEffect } from "react";
import "./globals.css";

// The last resort: an error in the root layout itself. It replaces the whole document, so it has no
// providers, navbar or language setting; it speaks both languages and keeps to the platform's tokens.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es">
      <body className="flex min-h-screen items-center justify-center bg-background px-4 font-sans text-foreground antialiased">
        <div className="w-full max-w-[420px] overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
          <div className="px-7 pt-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Error</p>
            <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight">Algo salió mal · Something went wrong</h1>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              No pudimos cargar Academia del Código. We couldn&apos;t load Academia del Código.
            </p>
          </div>
          <div className="flex flex-col gap-2.5 px-7 pb-6 pt-5">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground"
            >
              Reintentar · Try again
            </button>
            {/* A full page load, not a client navigation: the app around this page is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="inline-flex h-10 items-center justify-center rounded-full text-[13px] font-medium text-muted-foreground hover:bg-accent">
              Ir al inicio · Go home
            </a>
          </div>
          {error.digest && (
            <div className="border-t border-border bg-muted/30 px-7 py-2.5 text-center font-mono text-[11px] text-muted-foreground">
              Ref: {error.digest}
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
