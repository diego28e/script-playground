"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { ArrowLeft, Brain, Compass, ExternalLink, FlaskConical, LibraryBig, LogOut, Repeat, Shield, SquareCode, X } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { LAB_URL } from "@/lib/lab";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DotLoader } from "@/components/ui/dot-loader";
import { CourseHeading, OutlineTree } from "@/components/courses/lesson-outline";
import { PracticeDueBadge } from "@/components/practice/practice-nav-link";
import { closeSiteMenu, openSiteMenu, setSiteMenuView, useSiteMenu, type MenuView } from "@/components/layout/site-menu-store";

// The site menu on phones and tablets: everything the header holds on a wide screen, in one panel from the right
// edge. "Menu" has the site's sections (Courses, the Python guide, Practice with what's due, Challenges, the Lab)
// and the account; in a lesson, "This course" has the course's progress and its whole outline, the current lesson
// in view, and the way back to every course. Opened by the header's menu button, or at "This course" by the lesson
// page's Course outline button (site-menu-store.ts). A tap on any link closes it.

const COPY = {
    en: {
        menu: "Menu",
        open: "Open the menu",
        close: "Close the menu",
        views: "Menu sections",
        thisCourse: "This course",
        learn: "Learn",
        account: "Account",
        courses: "Courses",
        allCourses: "All courses",
        python: "Python guide",
        challenges: "Challenges",
        practice: "Practice",
        due: (n: number) => `${n} due today`,
        lab: "Lab",
        newTab: "opens in a new tab",
        howILearn: "How I learn",
        admin: "Admin dashboard",
        signOut: "Log out",
        signingOut: "Logging out…",
        signOutError: "We couldn't log you out. Try again.",
        signIn: "Sign in",
        start: "Get started",
    },
    es: {
        menu: "Menú",
        open: "Abrir el menú",
        close: "Cerrar el menú",
        views: "Secciones del menú",
        thisCourse: "Este curso",
        learn: "Aprender",
        account: "Cuenta",
        courses: "Cursos",
        allCourses: "Todos los cursos",
        python: "Guía de Python",
        challenges: "Retos",
        practice: "Práctica",
        due: (n: number) => `${n} para hoy`,
        lab: "Laboratorio",
        newTab: "se abre en una pestaña nueva",
        howILearn: "Cómo aprendo",
        admin: "Panel de administración",
        signOut: "Cerrar sesión",
        signingOut: "Cerrando sesión…",
        signOutError: "No pudimos cerrar tu sesión. Inténtalo de nuevo.",
        signIn: "Entrar",
        start: "Empezar",
    },
};

type MenuUser = { name: string; email: string; image: string | null; admin: boolean };

const ROW =
    "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] text-foreground/90 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ROW_ACTIVE = "bg-accent font-medium text-foreground";
const ICON = "size-[18px] shrink-0 text-muted-foreground";
const GROUP = "px-3 pb-1.5 pt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground first:pt-1";

function Row({ href, icon, label, active, trailing, external, newTab }: { href: string; icon: ReactNode; label: string; active?: boolean; trailing?: ReactNode; external?: boolean; newTab?: string }) {
    const body = (
        <>
            {icon}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {trailing}
        </>
    );
    if (external) {
        return (
            <a href={href} target="_blank" rel="noopener noreferrer" className={ROW}>
                {body}
                <span className="sr-only">({newTab})</span>
            </a>
        );
    }
    return (
        <Link href={href} aria-current={active ? "page" : undefined} className={cn(ROW, active && ROW_ACTIVE)}>
            {body}
        </Link>
    );
}

/** The header's menu button on phones; the dot says practice is waiting. */
export function SiteMenuButton({ language, due }: { language: "es" | "en"; due: number }) {
    const { open } = useSiteMenu();
    const t = COPY[language];
    return (
        <button
            type="button"
            onClick={() => openSiteMenu("menu")}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={due > 0 ? `${t.open} (${t.due(due)})` : t.open}
            className="relative flex size-11 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            {/* Two lines, not three: the menu's mark, drawn to sit with the header's other 16px icons. */}
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="M3 7h14M3 13h14" />
            </svg>
            {due > 0 && <span aria-hidden="true" className="absolute right-2 top-2 size-2 rounded-full bg-ring ring-2 ring-background" />}
        </button>
    );
}

export function SiteMenu({ language, pathname, signedIn, user, due }: { language: "es" | "en"; pathname: string; signedIn: boolean; user: MenuUser | null; due: number }) {
    const { open, view, course } = useSiteMenu();
    const t = COPY[language];
    const router = useRouter();
    const body = useRef<HTMLDivElement>(null);
    const [signingOut, setSigningOut] = useState(false);
    const shown: MenuView = view === "course" && course ? "course" : "menu";
    const at = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

    // A page change closes it (the browser's back button included).
    useEffect(() => {
        closeSiteMenu();
    }, [pathname]);

    // At "This course", the current lesson is in view, not the top of a 129-lesson list.
    useEffect(() => {
        if (!open || shown !== "course") return;
        const frame = requestAnimationFrame(() => {
            body.current?.querySelector("[data-current-lesson]")?.scrollIntoView({ block: "center" });
        });
        return () => cancelAnimationFrame(frame);
    }, [open, shown]);

    // A tap on a link closes the menu (the page underneath is about to change).
    const onClick = (event: MouseEvent) => {
        if ((event.target as Element).closest("a")) closeSiteMenu();
    };

    const signOut = async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
            const { error } = await authClient.signOut();
            if (error) throw error;
            closeSiteMenu();
            router.push("/login");
            router.refresh();
        } catch {
            toast.error(t.signOutError);
        } finally {
            setSigningOut(false);
        }
    };

    return (
        <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? openSiteMenu(view) : closeSiteMenu())}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="site-menu-overlay fixed inset-0 z-[70] bg-foreground/25 dark:bg-black/60" />
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    onClick={onClick}
                    // The panel takes the focus on opening, not its first control: a ring on the Menu tab would say
                    // that's where the learner is, at "This course" too. Tab still moves through it, kept inside.
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
                    }}
                    className="site-menu fixed inset-y-0 right-0 z-[70] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col border-l border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-[-24px_0_60px_-24px_rgba(15,21,32,0.35)] focus:outline-none"
                >
                    <DialogPrimitive.Title className="sr-only">{t.menu}</DialogPrimitive.Title>
                    <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-3">
                        {course ? (
                            <div role="tablist" aria-label={t.views} className="flex flex-1 rounded-xl bg-muted p-1 text-sm">
                                {(["menu", "course"] as const).map((entry) => (
                                    <button
                                        key={entry}
                                        type="button"
                                        role="tab"
                                        aria-selected={shown === entry}
                                        onClick={() => setSiteMenuView(entry)}
                                        className={cn(
                                            "min-h-9 flex-1 rounded-lg px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            shown === entry ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        {entry === "menu" ? t.menu : t.thisCourse}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <span className="flex-1 px-2 text-sm font-medium">{t.menu}</span>
                        )}
                        <DialogPrimitive.Close
                            aria-label={t.close}
                            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <X className="size-5" aria-hidden="true" />
                        </DialogPrimitive.Close>
                    </div>

                    {/* At "This course", the way back to every course and the course itself stay above the outline,
                        which scrolls under them to the current lesson. */}
                    {shown === "course" && course && (
                        <div className="flex shrink-0 flex-col gap-2 border-b border-border px-5 pb-4 pt-2">
                            <Link href="/courses" className="-ml-2 inline-flex min-h-10 items-center gap-2 self-start rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <ArrowLeft className="size-4" aria-hidden="true" />
                                {t.allCourses}
                            </Link>
                            <CourseHeading data={course.data} progress={course.progress} />
                        </div>
                    )}

                    <div ref={body} className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
                        {shown === "course" && course ? (
                            <nav aria-label={course.t.outline}>
                                <OutlineTree {...course} />
                            </nav>
                        ) : (
                            <nav aria-label={t.menu} className="flex flex-col">
                                <p className={GROUP}>{t.learn}</p>
                                <Row href="/courses" icon={<LibraryBig className={ICON} aria-hidden="true" />} label={t.courses} active={at("/courses")} />
                                <Row href="/python" icon={<Compass className={ICON} aria-hidden="true" />} label={t.python} active={at("/python")} />
                                {signedIn && (
                                    <>
                                        <Row
                                            href="/practice"
                                            icon={<Repeat className={ICON} aria-hidden="true" />}
                                            label={t.practice}
                                            active={at("/practice")}
                                            trailing={
                                                due > 0 ? (
                                                    <>
                                                        <PracticeDueBadge due={due} />
                                                        <span className="sr-only">{t.due(due)}</span>
                                                    </>
                                                ) : null
                                            }
                                        />
                                        <Row href="/challenges" icon={<SquareCode className={ICON} aria-hidden="true" />} label={t.challenges} active={at("/challenges")} />
                                        <Row href={LAB_URL} icon={<FlaskConical className={ICON} aria-hidden="true" />} label={t.lab} external newTab={t.newTab} trailing={<ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />} />
                                    </>
                                )}
                                {signedIn && user && (
                                    <>
                                        <p className={GROUP}>{t.account}</p>
                                        <Row href="/how-i-learn" icon={<Brain className={ICON} aria-hidden="true" />} label={t.howILearn} active={at("/how-i-learn")} />
                                        {user.admin && <Row href="/admin/challenges" icon={<Shield className={ICON} aria-hidden="true" />} label={t.admin} active={at("/admin")} />}
                                    </>
                                )}
                            </nav>
                        )}
                    </div>

                    {/* Who's signed in and the way out; or the way in. Always at the bottom, within the thumb's reach. */}
                    <div className="shrink-0 border-t border-border p-3">
                        {signedIn && user ? (
                            <div className="flex items-center gap-3 px-1">
                                <Avatar className="size-9">
                                    <AvatarImage src={user.image ?? ""} alt="" />
                                    <AvatarFallback>{user.name.charAt(0) || "U"}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{user.name}</p>
                                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void signOut()}
                                    disabled={signingOut}
                                    aria-busy={signingOut || undefined}
                                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                                >
                                    {signingOut ? <DotLoader size={16} /> : <LogOut className="size-4" aria-hidden="true" />}
                                    {signingOut ? t.signingOut : t.signOut}
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                <Link href="/login" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    {t.signIn}
                                </Link>
                                <Link href="/courses" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-foreground text-sm font-medium text-background transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    {t.start}
                                </Link>
                            </div>
                        )}
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
