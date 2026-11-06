"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, Repeat, Shield, SquareCode } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useLanguage } from "@/components/providers/language-provider";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DotLoader } from "@/components/ui/dot-loader";

const COPY = {
    en: { challenges: "Challenges", practice: "Practice", admin: "Admin dashboard", signOut: "Log out", signingOut: "Logging out…", signOutError: "We couldn't log you out. Try again.", menu: "Account menu" },
    es: { challenges: "Retos", practice: "Práctica", admin: "Panel de administración", signOut: "Cerrar sesión", signingOut: "Cerrando sesión…", signOutError: "No pudimos cerrar tu sesión. Inténtalo de nuevo.", menu: "Menú de la cuenta" },
};

export function UserDropdown() {
    const { data: session } = authClient.useSession();
    const router = useRouter();
    const { language } = useLanguage();
    const t = COPY[language];
    const [signingOut, setSigningOut] = useState(false);

    if (!session) return null;

    const handleSignOut = async (event: Event) => {
        // Keep the menu open so the item can show that it is working.
        event.preventDefault();
        if (signingOut) return;
        setSigningOut(true);
        try {
            const { error } = await authClient.signOut();
            if (error) throw error;
            router.push("/login");
            router.refresh();
        } catch {
            toast.error(t.signOutError);
            setSigningOut(false);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full" aria-label={t.menu}>
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={session.user.image || ""} alt={session.user.name || ""} />
                        <AvatarFallback>{session.user.name?.charAt(0) || "U"}</AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{session.user.name}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                            {session.user.email}
                        </p>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link href="/challenges">
                        <SquareCode className="mr-2 h-4 w-4" />
                        <span>{t.challenges}</span>
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href="/practice">
                        <Repeat className="mr-2 h-4 w-4" />
                        <span>{t.practice}</span>
                    </Link>
                </DropdownMenuItem>
                {(session.user as { role?: string }).role === "ADMIN" && (
                    <DropdownMenuItem asChild>
                        <Link href="/admin/challenges">
                            <Shield className="mr-2 h-4 w-4" />
                            <span>{t.admin}</span>
                        </Link>
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSignOut} disabled={signingOut} aria-busy={signingOut || undefined}>
                    {signingOut ? (
                        <DotLoader size={16} className="mr-2" />
                    ) : (
                        <LogOut className="mr-2 h-4 w-4" />
                    )}
                    <span>{signingOut ? t.signingOut : t.signOut}</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
