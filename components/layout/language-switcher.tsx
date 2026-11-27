"use client";

import { useLanguage } from "@/components/providers/language-provider";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Languages } from "lucide-react";

export function LanguageSwitcher() {
    const { language, setLanguage } = useLanguage();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {/* 40px on phones, for the thumb; 36px beside the header's links. */}
                <Button variant="ghost" size="icon" className="size-10 md:size-9">
                    <Languages className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">{language === "es" ? "Cambiar idioma" : "Change language"}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem
                    onClick={() => setLanguage("en")}
                    className={language === "en" ? "bg-accent text-accent-foreground" : ""}
                >
                    English
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => setLanguage("es")}
                    className={language === "es" ? "bg-accent text-accent-foreground" : ""}
                >
                    Español
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
