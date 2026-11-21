import { createHmac, timingSafeEqual } from "node:crypto";

// The lesson tutor's pass (docs/lesson-tutor.md): the platform, which knows the signed-in learner, gives their browser
// a pass for one lesson; the browser shows it to the lab's learning service, which answers there (streaming, with no
// request time limit, unlike Amplify). Signed with LESSON_TUTOR_SECRET, the same value in Amplify and on the learning
// service; the service checks the signature and the time, and nothing else is trusted from the browser.

/** A pass lasts this long: a lesson's listening, with its questions. The page asks for a new one after. */
export const PASS_MS = 3 * 60 * 60_000;

/** A pass is for one lesson (the lesson tutor) or for one course's practice (the practice coach, lib/practice/coach.ts). */
export type TutorPass = { userId: string; expiresAt: number } & ({ kind: "lesson"; lessonId: string } | { kind: "practice"; courseId: string });

const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

function issue(secret: string, body: Record<string, string>, now: number): { pass: string; expiresAt: number } {
  const expiresAt = now + PASS_MS;
  const payload = Buffer.from(JSON.stringify({ ...body, e: expiresAt })).toString("base64url");
  return { pass: `${payload}.${sign(secret, payload)}`, expiresAt };
}

export function issuePass(secret: string, userId: string, lessonId: string, now = Date.now()): { pass: string; expiresAt: number } {
  return issue(secret, { u: userId, l: lessonId }, now);
}

/** A pass for the practice coach of one course. */
export function issuePracticePass(secret: string, userId: string, courseId: string, now = Date.now()): { pass: string; expiresAt: number } {
  return issue(secret, { u: userId, c: courseId }, now);
}

/** The pass's learner and what it is for, if its signature holds and it hasn't expired; else null. */
export function readPass(secret: string, pass: string, now = Date.now()): TutorPass | null {
  const [payload, signature, extra] = pass.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; l?: unknown; c?: unknown; e?: unknown };
    if (typeof data.u !== "string" || typeof data.e !== "number" || data.e < now) return null;
    if (typeof data.l === "string") return { kind: "lesson", userId: data.u, lessonId: data.l, expiresAt: data.e };
    if (typeof data.c === "string") return { kind: "practice", userId: data.u, courseId: data.c, expiresAt: data.e };
    return null;
  } catch {
    return null;
  }
}
