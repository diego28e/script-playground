"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { BrandMark } from "@/components/brand/brand-mark";
import { UserDropdown } from "@/components/auth/user-dropdown";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useLanguage } from "@/components/providers/language-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

const LAB_URL = "https://lab.academiadelcodigo.com";

const COPY = {
    en: { challenges: "Challenges", lab: "Lab", signIn: "Sign in", start: "Get started" },
    es: { challenges: "Retos", lab: "Laboratorio", signIn: "Entrar", start: "Empezar" },
};

const NAV_LINK =
    "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Navbar() {
    const { data: session, isPending, error } = authClient.useSession();
    const pathname = usePathname();
    const { language } = useLanguage();
    const t = COPY[language];
    const signedIn = Boolean(session && !error);

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-xl">
            <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
                <div className="flex items-center gap-6">
                    <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <BrandMark />
                        <span className="text-[15px] font-semibold tracking-tight text-foreground">Academia del Código</span>
                    </Link>
                    {signedIn && (
                        <nav className="hidden items-center gap-1 sm:flex" aria-label="Principal">
                            <Link
                                href="/challenges"
                                aria-current={pathname.startsWith("/challenges") ? "page" : undefined}
                                className={cn(NAV_LINK, pathname.startsWith("/challenges") && "text-foreground")}
                            >
                                {t.challenges}
                            </Link>
                            <a href={LAB_URL} target="_blank" rel="noopener noreferrer" className={cn(NAV_LINK, "inline-flex items-center gap-1.5")}>
                                {t.lab}
                                <ExternalLink className="size-3.5" aria-hidden="true" />
                            </a>
                        </nav>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <LanguageSwitcher />
                    <ThemeToggle />
                    {isPending ? (
                        <div className="ml-2 size-8 animate-pulse rounded-full bg-muted" />
                    ) : signedIn ? (
                        <div className="ml-2">
                            <UserDropdown />
                        </div>
                    ) : (
                        <>
                            <Link href="/login" className={NAV_LINK}>
                                {t.signIn}
                            </Link>
                            <Link
                                href="/challenges"
                                className="ml-1 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                {t.start}
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}
