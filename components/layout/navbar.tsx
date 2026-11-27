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
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { PracticeNavLink, usePracticeDue } from "@/components/practice/practice-nav-link";
import { SiteMenu, SiteMenuButton } from "@/components/layout/site-menu";
import { cn } from "@/lib/utils";
import { LAB_URL } from "@/lib/lab";

const COPY = {
    en: { courses: "Courses", challenges: "Challenges", practice: "Practice", lab: "Lab", signIn: "Sign in", start: "Get started" },
    es: { courses: "Cursos", challenges: "Retos", practice: "Práctica", lab: "Laboratorio", signIn: "Entrar", start: "Empezar" },
};

const NAV_LINK =
    "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Navbar() {
    const { data: session, isPending, error } = authClient.useSession();
    const pathname = usePathname();
    const { language } = useLanguage();
    const t = COPY[language];
    const signedIn = Boolean(session && !error);
    const fullWidth = /^\/courses\/[^/]+\/[^/]+\/[^/]+/.test(pathname);
    const due = usePracticeDue(pathname, signedIn);
    const user = signedIn && session
        ? { name: session.user.name ?? "", email: session.user.email, image: session.user.image ?? null, admin: (session.user as { role?: string }).role === "ADMIN" }
        : null;

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-xl">
            {/* A lesson page uses the window's full width, its outline on the left edge: the bar lines up with it. */}
            <div className={cn("mx-auto flex h-16 items-center justify-between gap-4 px-4", fullWidth ? "w-full" : "container")}>
                <div className="flex items-center gap-6">
                    <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <BrandMark />
                        {/* Below wide screens the mark stands alone; the name needs the room the links use. */}
                        <span className="sr-only text-[15px] font-semibold tracking-tight whitespace-nowrap text-foreground lg:not-sr-only">
                            Academia del Código
                        </span>
                    </Link>
                    <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
                        <Link
                            href="/courses"
                            aria-current={pathname.startsWith("/courses") ? "page" : undefined}
                            className={cn(NAV_LINK, pathname.startsWith("/courses") && "text-foreground")}
                        >
                            {t.courses}
                        </Link>
                        {/* The Python guide (docs/compass.md) is open to everyone; running its examples needs an account. */}
                        <Link
                            href="/python"
                            aria-current={pathname.startsWith("/python") ? "page" : undefined}
                            className={cn(NAV_LINK, pathname.startsWith("/python") && "text-foreground")}
                        >
                            Python
                        </Link>
                        {signedIn && (
                            <>
                                <Link
                                    href="/challenges"
                                    aria-current={pathname.startsWith("/challenges") ? "page" : undefined}
                                    className={cn(NAV_LINK, pathname.startsWith("/challenges") && "text-foreground")}
                                >
                                    {t.challenges}
                                </Link>
                                <PracticeNavLink label={t.practice} className={NAV_LINK} active={pathname.startsWith("/practice")} due={due} />
                                <a href={LAB_URL} target="_blank" rel="noopener noreferrer" className={cn(NAV_LINK, "inline-flex items-center gap-1.5")}>
                                    {t.lab}
                                    <ExternalLink className="size-3.5" aria-hidden="true" />
                                </a>
                            </>
                        )}
                    </nav>
                </div>
                <div className="flex items-center gap-1">
                    <LanguageSwitcher />
                    <ThemeToggle />
                    {/* On phones and small tablets the account and the section links live in the menu (site-menu.tsx). */}
                    {isPending ? (
                        <div className="ml-2 hidden size-8 animate-pulse rounded-full bg-muted md:block" />
                    ) : signedIn ? (
                        <div className="ml-2 hidden md:block">
                            <UserDropdown />
                        </div>
                    ) : (
                        <>
                            <Link href="/login" className={cn(NAV_LINK, "hidden md:inline-flex")}>
                                {t.signIn}
                            </Link>
                            <ShimmerButton href="/courses" tone="ink" size="sm" onHover className="ml-1 whitespace-nowrap">
                                {t.start}
                            </ShimmerButton>
                        </>
                    )}
                    <div className="md:hidden">
                        <SiteMenuButton language={language} due={due} />
                    </div>
                </div>
            </div>
            <SiteMenu language={language} pathname={pathname} signedIn={signedIn} user={user} due={due} />
        </header>
    );
}
