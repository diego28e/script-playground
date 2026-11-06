"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Language = "en" | "es";

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguage] = useState<Language>("en");

    useEffect(() => {
        const saved = localStorage.getItem("language") as Language;
        if (saved && (saved === "en" || saved === "es")) {
            setLanguage(saved);
        }
    }, []);

    // The lab (lab.academiadelcodigo.com) follows the language picked here (docs/notebook-embed.md): it can't read this
    // site's localStorage, so the choice also goes in a cookie for the whole domain.
    useEffect(() => {
        const shared = window.location.hostname.endsWith("academiadelcodigo.com") ? "; Domain=.academiadelcodigo.com; Secure" : "";
        document.cookie = `adc_lang=${language}; Path=/; Max-Age=31536000; SameSite=Lax${shared}`;
    }, [language]);

    const handleSetLanguage = (lang: Language) => {
        setLanguage(lang);
        localStorage.setItem("language", lang);
    };

    return (
        <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error("useLanguage must be used within a LanguageProvider");
    }
    return context;
}
