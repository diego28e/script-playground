"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, LogOut } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The admin area's bar: every section, the way back to the site and out. On wide screens the sections sit in the bar;
// on phones and tablets they're a strip under it that scrolls sideways, the current one in view, so every section is
// one tap away on any screen. It stays at the top while a long admin page scrolls.

const SECTIONS = [
    { href: "/admin/courses", label: "Courses" },
    { href: "/admin/challenges", label: "Challenges" },
    { href: "/admin/videos", label: "Videos" },
    { href: "/admin/audio", label: "Audio" },
    { href: "/admin/practice", label: "Practice" },
    { href: "/admin/python", label: "Python" },
    { href: "/admin/javascript", label: "JavaScript" },
    { href: "/admin/stops", label: "Stops" },
    { href: "/admin/lab-access", label: "Lab access" },
    { href: "/admin/spend", label: "Spend" },
];

const INLINE_LINK =
    "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const STRIP_LINK =
    "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AdminNav() {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [signingOut, setSigningOut] = useState(false);
    const strip = useRef<HTMLElement>(null);
    const current = SECTIONS.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`))?.href ?? null;

    // The strip opens at the current section, not at its start.
    useEffect(() => {
        strip.current?.querySelector<HTMLElement>("[aria-current='page']")?.scrollIntoView({ inline: "center", block: "nearest" });
    }, [current]);

    const handleSignOut = async () => {
        setSigningOut(true);
        try {
            const { error } = await authClient.signOut();
            if (error) throw error;
            router.push("/");
            router.refresh();
        } catch {
            toast.error("We couldn't sign you out. Try again.");
            setSigningOut(false);
        }
    };

    return (
        <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
            <div className="flex h-14 items-center gap-2 px-4 md:px-8">
                <Link href="/admin/challenges" className="mr-4 shrink-0 rounded-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Admin<span className="hidden sm:inline"> Dashboard</span>
                </Link>
                <nav aria-label="Admin sections" className="hidden items-center gap-0.5 xl:flex">
                    {SECTIONS.map((section) => (
                        <Link
                            key={section.href}
                            href={section.href}
                            aria-current={current === section.href ? "page" : undefined}
                            className={cn(INLINE_LINK, current === section.href ? "text-foreground" : "text-foreground/60 hover:text-foreground")}
                        >
                            {section.label}
                        </Link>
                    ))}
                </nav>
                <div className="ml-auto flex items-center gap-1">
                    <Link
                        href="/"
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        Back to site
                        <ArrowUpRight className="size-4" aria-hidden="true" />
                    </Link>
                    <Button variant="ghost" size="sm" onClick={handleSignOut} loading={signingOut} loadingLabel="Signing out…" aria-label="Sign out" className="min-h-10">
                        <LogOut className="size-4 sm:mr-2" aria-hidden="true" />
                        <span className="hidden sm:inline">Sign out</span>
                    </Button>
                </div>
            </div>
            <nav
                ref={strip}
                aria-label="Admin sections"
                className="flex gap-1 overflow-x-auto border-t border-border/60 px-4 py-2 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-28px),transparent)] [scrollbar-width:none] md:px-8 xl:hidden [&::-webkit-scrollbar]:hidden"
            >
                {SECTIONS.map((section) => (
                    <Link
                        key={section.href}
                        href={section.href}
                        aria-current={current === section.href ? "page" : undefined}
                        className={cn(STRIP_LINK, current === section.href ? "bg-foreground text-background" : "text-foreground/70 hover:bg-accent hover:text-foreground")}
                    >
                        {section.label}
                    </Link>
                ))}
            </nav>
        </header>
    );
}
