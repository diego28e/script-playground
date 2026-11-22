import { createHash } from "node:crypto";

// A fingerprint of what a lesson says (docs/practice.md, "When a lesson changes"): its title, its objectives, and its
// text (a guide's Markdown, or every cell of a notebook). The import stores it on the lesson and notes when it changes,
// so practice skills drafted from an older version of the lesson can be found and redrafted. Line endings are ignored,
// so a checkout on Windows and one on Linux give the same fingerprint.

export function lessonFingerprint(title: string, objectives: string[], text: string | null): string {
  const clean = (value: string) => value.replace(/\r/g, "").trim();
  return createHash("sha256")
    .update(JSON.stringify([clean(title), objectives.map(clean), clean(text ?? "")]))
    .digest("hex")
    .slice(0, 32);
}
