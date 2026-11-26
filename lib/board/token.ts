import { createHmac, timingSafeEqual } from "node:crypto";

// The whiteboard's signed tokens (docs/whiteboard-contract.md): the launch the platform gives the learner's browser to
// open Didactra at board.academiadelcodigo.com, and the service token Didactra's server shows the platform's endpoints.
// The same format as the lab's tutor pass (lib/lesson-tutor/pass.ts): base64url JSON, a dot, base64url HMAC-SHA256
// of it with BOARD_SECRET, which both sides hold and no browser ever sees.

/** A launch is used at once, by the frame the platform opens. */
export const LAUNCH_MS = 60_000;

export type LaunchView = "board" | "replay" | "transcript";

export type Launch = { sid: string; userId: string; name: string; language: "es" | "en"; role: "USER" | "ADMIN"; view: LaunchView; expiresAt: number };

const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

function encode(secret: string, body: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

/** The payload of a token whose signature holds and which hasn't expired; else null. */
function decode(secret: string, token: string, now: number): Record<string, unknown> | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof data.e === "number" && data.e >= now ? data : null;
  } catch {
    return null;
  }
}

/** The launch for one session, read by Didactra's /launch. `view` other than the board opens its replay or transcript. */
export function issueLaunch(secret: string, launch: Omit<Launch, "expiresAt">, now = Date.now()): string {
  return encode(secret, {
    k: "launch",
    sid: launch.sid,
    u: launch.userId,
    name: launch.name,
    lang: launch.language,
    role: launch.role,
    ...(launch.view === "board" ? {} : { view: launch.view }),
    e: now + LAUNCH_MS,
  });
}

/** Reads a launch (Didactra's side does the same; kept here for the tests and as the reference). */
export function readLaunch(secret: string, token: string, now = Date.now()): Launch | null {
  const data = decode(secret, token, now);
  if (!data || data.k !== "launch" || typeof data.sid !== "string" || typeof data.u !== "string") return null;
  const view = data.view === "replay" || data.view === "transcript" ? data.view : "board";
  return {
    sid: data.sid,
    userId: data.u,
    name: typeof data.name === "string" ? data.name : "",
    language: data.lang === "es" ? "es" : "en",
    role: data.role === "ADMIN" ? "ADMIN" : "USER",
    view,
    expiresAt: data.e as number,
  };
}

/** A service token for one session's calls, valid a minute (Didactra signs these; here for the tests). */
export function issueService(secret: string, sid: string, now = Date.now()): string {
  return encode(secret, { k: "svc", sid, e: now + 60_000 });
}

/** The session a service call is for, from its `Authorization: Bearer` header, if the token holds and names `sid`. */
export function serviceSession(secret: string, header: string | null, sid: string, now = Date.now()): boolean {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return false;
  const data = decode(secret, token, now);
  return Boolean(data && data.k === "svc" && data.sid === sid);
}

/** BOARD_SECRET, when it is long enough to be one; null when the whiteboard isn't set up here. */
export function boardSecret(): string | null {
  const secret = process.env.BOARD_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/** Where Didactra is served, e.g. https://board.academiadelcodigo.com; null when the whiteboard isn't set up. */
export function boardUrl(): string | null {
  const url = process.env.BOARD_URL?.replace(/\/+$/, "");
  return url && /^https?:\/\//.test(url) ? url : null;
}
