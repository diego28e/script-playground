"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { BrandMark } from "@/components/brand/brand-mark";
import { useLanguage } from "@/components/providers/language-provider";

// The look follows the identifier-first sign-in card; Google is the only method today, so the email
// field and method detection are left out until there is a second way in.
const COPY = {
  es: {
    eyebrow: "Tu academia",
    heading: "Entra a Academia del Código",
    description: "Aprende con notebooks, videos y práctica guiada. Continúa con tu cuenta de Google.",
    cta: "Continuar con Google",
    opening: "Abriendo Google…",
    hint: "Solo usamos tu nombre, tu correo y tu foto de perfil",
    error: "No pudimos iniciar sesión con Google. Inténtalo de nuevo.",
    termsLead: "Al continuar aceptas los",
    terms: "Términos",
    and: "y la",
    privacy: "Política de privacidad",
  },
  en: {
    eyebrow: "Your academy",
    heading: "Sign in to Academia del Código",
    description: "Learn with notebooks, videos and guided practice. Continue with your Google account.",
    cta: "Continue with Google",
    opening: "Opening Google…",
    hint: "We only use your name, email and profile photo",
    error: "We couldn't sign you in with Google. Try again.",
    termsLead: "By continuing you agree to the",
    terms: "Terms",
    and: "and the",
    privacy: "Privacy Policy",
  },
};

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[18px] shrink-0" aria-hidden="true">
      <path d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.75-5.59-4.11H3.07v2.59A10 10 0 0 0 12 22ZM6.41 13.93A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.93V7.48H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.52l3.34-2.59ZM12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59C7.2 7.71 9.4 5.96 12 5.96Z" />
    </svg>
  );
}

export function SignInCard() {
  const { language } = useLanguage();
  const t = COPY[language];
  // Better Auth sends a failed Google sign-in back here with ?error=<code>.
  const returnedError = useSearchParams().get("error");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Coming back with the browser's Back button restores this page from its cache, still "opening".
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const signIn = async () => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/login",
      });
      if (error) throw error;
    } catch (error) {
      console.error("Sign-in error:", error);
      setPending(false);
      setFailed(true);
    }
  };

  const showError = failed || Boolean(returnedError);

  return (
    <div className="relative w-full max-w-[400px] overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-xl shadow-primary/5">
      <div className="px-7 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <BrandMark />
          <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[.16em] text-muted-foreground">
            <LockKeyhole className="size-3" aria-hidden="true" />
            {t.eyebrow}
          </span>
        </div>
        <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-balance">{t.heading}</h1>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{t.description}</p>
      </div>

      <div className="px-7 pb-5 pt-5">
        <button
          type="button"
          onClick={signIn}
          aria-busy={pending}
          aria-disabled={pending || undefined}
          className={`relative flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 motion-reduce:transition-none ${FOCUS}`}
        >
          <span className={`flex items-center gap-2.5 ${pending ? "invisible" : ""}`}>
            <GoogleIcon />
            {t.cta}
            <ArrowRight className="absolute right-4 size-4" aria-hidden="true" />
          </span>
          {pending && (
            <span role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-xs">
              <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
              {t.opening}
            </span>
          )}
        </button>

        <div className="relative mt-1 flex min-h-8 items-center">
          {showError ? (
            <p role="alert" className="px-1.5 text-[11px] font-medium text-destructive">
              {t.error}
            </p>
          ) : (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] leading-4 text-muted-foreground">
              <ShieldCheck className="size-3 shrink-0" aria-hidden="true" />
              {t.hint}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-muted/30 px-7 py-2.5 text-center text-[11px] text-muted-foreground">
        {t.termsLead}{" "}
        <Link href="/terms" className={`rounded underline underline-offset-4 hover:text-foreground ${FOCUS}`}>
          {t.terms}
        </Link>{" "}
        {t.and}{" "}
        <Link href="/privacy" className={`rounded underline underline-offset-4 hover:text-foreground ${FOCUS}`}>
          {t.privacy}
        </Link>
      </div>
    </div>
  );
}
