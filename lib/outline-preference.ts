// The lesson outline's saved width and fold (components/courses/lesson-outline.tsx), kept in a cookie so the lesson
// page, on the server, renders it as the learner left it. Plain code, shared by the page and the outline.

export const OUTLINE_COOKIE = "adc_outline";
export const OUTLINE_WIDTH = { min: 240, default: 300, max: 480 } as const;

export type OutlinePreference = { collapsed: boolean; width: number };

export function clampOutlineWidth(width: number) {
    return Math.round(Math.min(OUTLINE_WIDTH.max, Math.max(OUTLINE_WIDTH.min, width)));
}

/** The cookie's value, "<0|1>:<width>"; anything else is the default. */
export function readOutlinePreference(value: string | undefined): OutlinePreference {
    const [collapsed, width] = (value ?? "").split(":");
    const parsed = Number(width);
    return {
        collapsed: collapsed === "1",
        width: Number.isFinite(parsed) && parsed > 0 ? clampOutlineWidth(parsed) : OUTLINE_WIDTH.default,
    };
}
