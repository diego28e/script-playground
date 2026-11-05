"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useLanguage } from "@/components/providers/language-provider";
import { BrandMark } from "@/components/brand/brand-mark";
import { ShimmerButton } from "@/components/ui/shimmer-button";

const COPY = {
  es: {
    eyebrow: "Permitir acceso",
    heading: (name: string) => `${name} quiere usar tu cuenta`,
    body: "Podrá ver lo siguiente de tu cuenta de Academia del Código:",
    goesTo: (host: string) => `Te devolverá a ${host}.`,
    scopes: { openid: "Tu identificador de usuario", profile: "Tu nombre y foto", email: "Tu correo" } as Record<string, string>,
    allow: "Permitir",
    deny: "No permitir",
    working: "Un momento…",
    invalidTitle: "Este enlace ya no sirve",
    invalidBody: "La solicitud expiró o fue modificada. Vuelve a la aplicación e inténtalo de nuevo.",
    home: "Ir al inicio",
    error: "No pudimos completar la solicitud. Inténtalo de nuevo.",
  },
  en: {
    eyebrow: "Allow access",
    heading: (name: string) => `${name} wants to use your account`,
    body: "It will be able to see this from your Academia del Código account:",
    goesTo: (host: string) => `It will send you back to ${host}.`,
    scopes: { openid: "Your user ID", profile: "Your name and photo", email: "Your email" } as Record<string, string>,
    allow: "Allow",
    deny: "Don't allow",
    working: "One moment…",
    invalidTitle: "This link no longer works",
    invalidBody: "The request expired or was changed. Go back to the app and try again.",
    home: "Go home",
    error: "We couldn't complete the request. Try again.",
  },
};

export function ConsentCard({
  valid,
  clientName,
  scopes,
  redirectHost,
}: {
  valid: boolean;
  clientName: string | null;
  scopes: string[];
  redirectHost: string | null;
}) {
  const { language } = useLanguage();
  const t = COPY[language];
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [failed, setFailed] = useState(false);

  // The client plugin adds this page's signed query to the request; the answer carries where to go next.
  const answer = async (accept: boolean) => {
    if (pending) return;
    setPending(accept ? "allow" : "deny");
    setFailed(false);
    try {
      const { data, error } = await authClient.$fetch<{ url?: string }>("/oauth2/consent", { method: "POST", body: { accept } });
      if (error || !data?.url) throw error ?? new Error("no redirect");
      window.location.href = data.url;
    } catch {
      setPending(null);
      setFailed(true);
    }
  };

  return (
    <div className="w-full max-w-[400px] overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-xl shadow-primary/5">
      <div className="px-7 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <BrandMark />
          <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[.16em] text-muted-foreground">
            <ShieldCheck className="size-3" aria-hidden="true" />
            {t.eyebrow}
          </span>
        </div>
        {valid && clientName ? (
          <>
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-balance">{t.heading(clientName)}</h1>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{t.body}</p>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {scopes.map((scope) => (
                <li key={scope} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-foreground/50" aria-hidden="true" />
                  {t.scopes[scope] ?? scope}
                </li>
              ))}
            </ul>
            {redirectHost && <p className="mt-3 text-xs text-muted-foreground">{t.goesTo(redirectHost)}</p>}
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{t.invalidTitle}</h1>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{t.invalidBody}</p>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2.5 px-7 pb-6 pt-5">
        {valid && clientName ? (
          <>
            <ShimmerButton tone="ink" fullWidth onHover onClick={() => answer(true)} pending={pending === "allow"} pendingLabel={t.working} disabled={pending === "deny"}>
              {t.allow}
            </ShimmerButton>
            <ShimmerButton tone="glass" fullWidth onHover onClick={() => answer(false)} pending={pending === "deny"} pendingLabel={t.working} disabled={pending === "allow"}>
              {t.deny}
            </ShimmerButton>
            {failed && (
              <p role="alert" className="text-center text-[12px] font-medium text-destructive">
                {t.error}
              </p>
            )}
          </>
        ) : (
          <ShimmerButton href="/" tone="ink" fullWidth onHover>
            {t.home}
          </ShimmerButton>
        )}
      </div>
      <div className="border-t border-border bg-muted/30 px-7 py-2.5 text-center text-[11px] text-muted-foreground">
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          Academia del Código
        </Link>
      </div>
    </div>
  );
}
