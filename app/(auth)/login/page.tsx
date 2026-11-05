import { Suspense } from "react";
import { Metadata } from "next";
import Link from "next/link";
import { SignInCard } from "@/components/auth/sign-in-card";

export const metadata: Metadata = {
  title: "Iniciar sesión",
  description: "Entra a Academia del Código con tu cuenta de Google.",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-muted/40 px-4 py-8">
      {/* The card reads ?error from the URL, which needs a Suspense boundary on a static page. */}
      <Suspense>
        <SignInCard />
      </Suspense>
      <Link
        href="/"
        className="rounded px-1 text-[11px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        academiadelcodigo.com
      </Link>
    </main>
  );
}
