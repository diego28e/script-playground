import pythonInventory from "./course-inventory.json";
import javascriptInventory from "./javascript/course-inventory.json";
import { DOCS_VERSION, docCandidates as pythonCandidates, docLink as pythonLink, type DocLink } from "@/lib/compass/docs";
import { docCandidates as javascriptCandidates, docLink as javascriptLink } from "@/lib/compass/javascript/docs";
import { RUNTIME as JAVASCRIPT_RUNTIME } from "@/lib/compass/javascript/cards";
import type { CompassLanguage } from "@/lib/compass/languages";

// What each Compass language brings (docs/compass.md): its course inventory, the docs index its cards may link to, and
// the runtime its examples are proven on. Server only: the inventories and indexes are large.

export type InventoryConcept = {
  key: string;
  group: string;
  label: string;
  labelEs: string;
  lessonCount: number;
  firstLesson: string | null;
  rank: number;
  lessons: string[];
  example: { lesson: string; line: string } | null;
};
export type CourseInventory = {
  course: string;
  commit: string;
  /** Lessons that teach with code: notebooks for Python, Markdown lessons for JavaScript. */
  taughtNotebooks: number;
  concepts: InventoryConcept[];
  unusedConcepts: { key: string; group: string; label: string; labelEs: string }[];
  lessons: { path: string; code: string; kind: "lesson" | "project" | "solution"; module: string; concepts: string[] }[];
};

export type CompassKit = {
  language: CompassLanguage;
  inventory: CourseInventory;
  docLink: (key: string) => DocLink | null;
  docCandidates: (concept: { key: string; labelEn: string }, limit?: number) => DocLink[];
  /** Stored with each card (CompassCard.runtimeVersion): what its examples ran on. */
  runtime: string;
};

const KITS: Record<CompassLanguage, CompassKit> = {
  python: { language: "python", inventory: pythonInventory as unknown as CourseInventory, docLink: pythonLink, docCandidates: pythonCandidates, runtime: DOCS_VERSION },
  javascript: { language: "javascript", inventory: javascriptInventory as unknown as CourseInventory, docLink: javascriptLink, docCandidates: javascriptCandidates, runtime: JAVASCRIPT_RUNTIME },
};

export const compassKit = (language: CompassLanguage): CompassKit => KITS[language];
