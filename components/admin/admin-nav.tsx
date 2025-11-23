"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function AdminNav() {
    const pathname = usePathname();
    const router = useRouter();

    const handleSignOut = async () => {
        await authClient.signOut();
        router.push("/");
    };

    return (
        <div className="border-b">
            <div className="flex h-16 items-center px-4 md:px-8">
                <div className="mr-8 hidden md:flex">
                    <Link href="/admin/challenges" className="mr-6 flex items-center space-x-2">
                        <span className="hidden font-bold sm:inline-block">
                            Admin Dashboard
                        </span>
                    </Link>
                    <nav className="flex items-center space-x-6 text-sm font-medium">
                        <Link
                            href="/admin/challenges"
                            className={cn(
                                "transition-colors hover:text-foreground/80",
                                pathname?.startsWith("/admin/challenges")
                                    ? "text-foreground"
                                    : "text-foreground/60"
                            )}
                        >
                            Challenges
                        </Link>
                        <Link
                            href="/"
                            className="text-foreground/60 transition-colors hover:text-foreground/80"
                        >
                            Back to Site
                        </Link>
                    </nav>
                </div>
                <div className="ml-auto flex items-center space-x-4">
                    <Button variant="ghost" size="sm" onClick={handleSignOut}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Sign Out
                    </Button>
                </div>
            </div>
        </div>
    );
}
