"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { UserDropdown } from "@/components/auth/user-dropdown";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

export function Navbar() {
    const { data: session, isPending, error } = authClient.useSession();
    const pathname = usePathname();

    return (
        <header className="sticky top-0 z-50 w-full border-b border-zinc-200 bg-white/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/80">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <div className="flex items-center gap-6">
                    <Link href="/" className="flex items-center gap-2">
                        <Image
                            src="/logo.png"
                            alt="Script Playground Logo"
                            width={32}
                            height={32}
                            className="rounded-lg"
                        />
                        <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                            Script Playground
                        </span>
                    </Link>
                    {session && !error && pathname !== "/challenges" && (
                        <Link
                            href="/challenges"
                            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                        >
                            Challenges
                        </Link>
                    )}
                </div>
                <nav className="flex items-center gap-4">
                    {isPending ? (
                        <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
                    ) : session && !error ? (
                        <>
                            <LanguageSwitcher />
                            <UserDropdown />
                        </>
                    ) : (
                        <>
                            <LanguageSwitcher />
                            <Link
                                href="/login"
                                className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                            >
                                Sign In
                            </Link>
                            <Link
                                href="/challenges"
                                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                            >
                                Get Started
                            </Link>
                        </>
                    )}
                </nav>
            </div>
        </header>
    );
}
