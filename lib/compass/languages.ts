// The Compass's languages (docs/compass.md): Python for the LangChain course, JavaScript (with TypeScript's type
// syntax) for the TypeScript course. Each has its own concepts, cards and signals, kept apart by `language` in the
// tables. This file is read by the browser too: names only. What each language runs and links to is lib/compass/kit.ts.

export const COMPASS_LANGUAGES = ["python", "javascript"] as const;
export type CompassLanguage = (typeof COMPASS_LANGUAGES)[number];

export const isCompassLanguage = (value: unknown): value is CompassLanguage => (COMPASS_LANGUAGES as readonly unknown[]).includes(value);

export const COMPASS: Record<CompassLanguage, { name: string; admin: string; docs: string; runtime: string }> = {
  python: { name: "Python", admin: "/admin/python", docs: "the official Python 3.12 docs", runtime: "Python 3.12" },
  javascript: { name: "JavaScript", admin: "/admin/javascript", docs: "MDN and the Node.js 26 docs", runtime: "Node.js 26 and TypeScript 7" },
};
