"use client";

import { useSyncExternalStore } from "react";
import type { LessonStatus } from "@/actions/lessons";
import type { OutlineCopy } from "@/components/courses/lesson-outline";
import type { LessonWorkspaceData } from "@/components/courses/lesson-workspace";

// The site menu on phones and tablets (components/layout/site-menu.tsx): whether it's open, at which view, and the
// course the learner is in. The header owns the menu; a lesson page lends it its outline and opens it at "This
// course" from its own Course outline button, so both reach one outline, wherever the learner has scrolled to.

export type MenuCourse = {
    data: LessonWorkspaceData;
    progress: Record<string, LessonStatus>;
    currentHref: string;
    t: OutlineCopy;
};

export type MenuView = "menu" | "course";

type State = { open: boolean; view: MenuView; course: MenuCourse | null };

let state: State = { open: false, view: "menu", course: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const SERVER_STATE: State = { open: false, view: "menu", course: null };

export function useSiteMenu(): State {
    return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** Opens the menu, at the site's links or at the course the learner is in. */
export function openSiteMenu(view: MenuView = "menu") {
    set({ open: true, view: view === "course" && !state.course ? "menu" : view });
}

export function closeSiteMenu() {
    if (state.open) set({ open: false });
}

export function setSiteMenuView(view: MenuView) {
    set({ view });
}

/** The lesson page's outline for the menu; null when the learner leaves the course. */
export function setMenuCourse(course: MenuCourse | null) {
    set({ course, view: course ? state.view : "menu" });
}
