"use client";

import { Fragment, useRef, type CSSProperties } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { useLanguage } from "@/components/providers/language-provider";

import { LAB_URL } from "@/lib/lab";

const COPY = {
    es: {
        eyebrow: "Notebooks · Video · Práctica",
        headline: "Aprende haciendo,",
        subline: "con notebooks reales, un tutor de IA a tu lado y práctica que vuelve justo cuando la necesitas.",
        motto: "Escribe. Ejecuta. Recuerda.",
        start: "Empezar a aprender",
        lab: "Abrir mi laboratorio",
    },
    en: {
        eyebrow: "Notebooks · Video · Practice",
        headline: "Learn by doing,",
        subline: "with real notebooks, an AI tutor beside you, and practice that returns right when you need it.",
        motto: "Write. Run. Remember.",
        start: "Start learning",
        lab: "Open my lab",
    },
};

// Each word rises out of a blur, `step` ms after the previous one, starting at `start` ms. Real spaces sit
// between the words so copied text and screen readers get "Learn by doing", not "Learnbydoing".
function Words({ text, start, step }: { text: string; start: number; step: number }) {
    return text.split(" ").map((word, index) => (
        <Fragment key={`${word}-${index}`}>
            {index > 0 && " "}
            <span className="hero-word" style={{ animationDelay: `${start + index * step}ms` }}>
                {word}
            </span>
        </Fragment>
    ));
}

const GUIDES = [
    { x1: "0", y1: "20%", x2: "100%", y2: "20%", delay: 0.5 },
    { x1: "0", y1: "80%", x2: "100%", y2: "80%", delay: 1 },
    { x1: "20%", y1: "0", x2: "20%", y2: "100%", delay: 1.5 },
    { x1: "80%", y1: "0", x2: "80%", y2: "100%", delay: 2 },
];
const DOTS = [
    { cx: "20%", cy: "20%", delay: 3 },
    { cx: "80%", cy: "20%", delay: 3.2 },
    { cx: "20%", cy: "80%", delay: 3.4 },
    { cx: "80%", cy: "80%", delay: 3.6 },
];
const PARTICLES = [
    { top: "25%", left: "15%", delay: 0.5 },
    { top: "60%", left: "85%", delay: 1 },
    { top: "40%", left: "10%", delay: 1.5 },
    { top: "75%", left: "90%", delay: 2 },
];
const CORNERS = [
    "top-4 left-4 border-l border-t sm:top-6 sm:left-6",
    "top-4 right-4 border-r border-t sm:top-6 sm:right-6",
    "bottom-4 left-4 border-b border-l sm:bottom-6 sm:left-6",
    "bottom-4 right-4 border-b border-r sm:bottom-6 sm:right-6",
];

export function Hero() {
    const { language } = useLanguage();
    const t = COPY[language];
    const { data: session } = authClient.useSession();
    const spotRef = useRef<HTMLDivElement>(null);

    // The cursor light follows the pointer inside the hero only; it moves the element directly, no re-render.
    const moveSpot = (event: React.PointerEvent<HTMLElement>) => {
        const spot = spotRef.current;
        if (!spot || event.pointerType !== "mouse") return;
        const box = event.currentTarget.getBoundingClientRect();
        spot.style.left = `${event.clientX - box.left}px`;
        spot.style.top = `${event.clientY - box.top}px`;
        spot.style.opacity = "1";
    };
    const hideSpot = () => {
        if (spotRef.current) spotRef.current.style.opacity = "0";
    };

    return (
        <section
            onPointerMove={moveSpot}
            onPointerLeave={hideSpot}
            className="relative isolate flex min-h-[calc(100svh-4rem)] flex-col items-center justify-between overflow-hidden bg-gradient-to-br from-hero-from via-hero-via to-hero-to px-6 py-10 text-foreground sm:px-8 sm:py-12 md:px-16 md:py-16"
        >
            <svg className="pointer-events-none absolute inset-0 -z-10 size-full" aria-hidden="true">
                <defs>
                    <pattern id="hero-grid" width="60" height="60" patternUnits="userSpaceOnUse">
                        <path d="M 60 0 L 0 0 0 60" fill="none" stroke="var(--hero-grid)" strokeWidth="0.5" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#hero-grid)" />
                {GUIDES.map((line) => (
                    <line key={`${line.x1}-${line.y1}`} {...line} className="hero-line" style={{ animationDelay: `${line.delay}s` }} />
                ))}
                {DOTS.map((dot) => (
                    <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r="2" className="hero-dot" style={{ animationDelay: `${dot.delay}s` }} />
                ))}
                <circle cx="50%" cy="50%" r="1.5" className="hero-dot" style={{ animationDelay: "4s" }} />
            </svg>

            {CORNERS.map((position, index) => (
                <span
                    key={position}
                    aria-hidden="true"
                    className={`hero-reveal pointer-events-none absolute size-10 border-hero-detail/25 ${position}`}
                    style={{ animationDelay: `${4 + index * 0.2}s` }}
                />
            ))}
            {PARTICLES.map((particle) => (
                <span
                    key={`${particle.top}-${particle.left}`}
                    aria-hidden="true"
                    className="hero-particle"
                    style={{ top: particle.top, left: particle.left, animationDelay: `${particle.delay}s` } as CSSProperties}
                />
            ))}
            <div
                ref={spotRef}
                aria-hidden="true"
                className="hero-spot pointer-events-none absolute -z-10 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 blur-2xl sm:size-96 sm:blur-3xl"
            />

            <div className="text-center">
                <p className="font-mono text-xs font-light uppercase tracking-[0.2em] text-muted-foreground sm:text-sm">
                    <Words text={t.eyebrow} start={0} step={300} />
                </p>
                <div className="mx-auto mt-4 h-px w-12 bg-gradient-to-r from-transparent via-hero-detail/40 to-transparent sm:w-16" />
            </div>

            <div className="relative mx-auto max-w-5xl text-center">
                <h1 className="font-extralight leading-tight tracking-tight">
                    <span className="hero-underline mb-4 inline-block text-4xl sm:text-5xl md:mb-6 md:text-6xl lg:text-7xl">
                        <Words text={t.headline} start={700} step={150} />
                    </span>
                    <span className="block text-xl font-thin leading-relaxed tracking-wide text-muted-foreground sm:text-2xl md:text-3xl lg:text-4xl">
                        <Words text={t.subline} start={1400} step={110} />
                    </span>
                </h1>
                <span
                    aria-hidden="true"
                    className="hero-reveal absolute -left-6 top-1/2 h-px w-3 -translate-y-1/2 bg-hero-detail/60 sm:-left-8 sm:w-4"
                    style={{ animationDelay: "3.2s" }}
                />
                <span
                    aria-hidden="true"
                    className="hero-reveal absolute -right-6 top-1/2 h-px w-3 -translate-y-1/2 bg-hero-detail/60 sm:-right-8 sm:w-4"
                    style={{ animationDelay: "3.4s" }}
                />
                <div className="hero-reveal mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ animationDelay: "3.6s" }}>
                    {/* The page's one main call to action: the only button that sweeps on its own. */}
                    <ShimmerButton href="/courses" tone="signal" size="lg">
                        {t.start}
                        <ArrowRight className="size-4 transition-transform group-hover/shimmer:translate-x-0.5" strokeWidth={2.5} aria-hidden="true" />
                    </ShimmerButton>
                    {session && (
                        <ShimmerButton href={LAB_URL} external tone="glass" size="lg" onHover>
                            {t.lab}
                            <ExternalLink className="size-4" strokeWidth={2.25} aria-hidden="true" />
                        </ShimmerButton>
                    )}
                </div>
            </div>

            <div className="text-center">
                <div className="mx-auto mb-4 h-px w-12 bg-gradient-to-r from-transparent via-hero-detail/40 to-transparent sm:w-16" />
                <p className="font-mono text-xs font-light uppercase tracking-[0.2em] text-muted-foreground sm:text-sm">
                    <Words text={t.motto} start={3000} step={200} />
                </p>
                <div className="hero-reveal mt-6 flex justify-center gap-4" style={{ animationDelay: "4.2s" }} aria-hidden="true">
                    <span className="size-1 rounded-full bg-hero-detail/40" />
                    <span className="size-1 rounded-full bg-hero-detail/60" />
                    <span className="size-1 rounded-full bg-hero-detail/40" />
                </div>
            </div>
        </section>
    );
}
