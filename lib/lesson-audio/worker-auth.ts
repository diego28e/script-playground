import { timingSafeEqual } from "node:crypto";
import { workerSignature } from "@/lib/lesson-audio/voice";

// The practice worker's requests to the platform (docs/lesson-audio.md) are signed with LAB_WORKER_SECRET, the same
// value on the worker and in Amplify, over the time and the body.

/** A signed request older than this is refused, so a captured one can't be replayed later. */
const MAX_AGE_MS = 5 * 60_000;

/** The request's body when its signature holds, else the refusal to send. */
export async function verifiedWorkerBody(request: Request): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
  const refuse = (status: number, error: string) => ({ ok: false as const, response: Response.json({ error }, { status }) });
  const secret = process.env.LAB_WORKER_SECRET;
  if (!secret) return refuse(503, "LAB_WORKER_SECRET is not set on the platform.");
  const time = request.headers.get("x-worker-time") ?? "";
  const signature = request.headers.get("x-worker-signature") ?? "";
  const body = await request.text();
  const age = Date.now() - Number(time);
  if (!time || !Number.isFinite(age) || Math.abs(age) > MAX_AGE_MS) return refuse(401, "The request is too old or has no time.");
  const expected = Buffer.from(workerSignature(secret, time, body), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return refuse(401, "The signature doesn't match.");
  return { ok: true, body };
}
