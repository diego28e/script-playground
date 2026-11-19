import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { mediaUploadsConfigured, presignUpload } from "@/lib/media-aws";
import { workerSignature } from "@/lib/lesson-audio/voice";

export const runtime = "nodejs";

// The practice worker's way to store a lesson's audio (docs/lesson-audio.md): it holds no AWS credentials, so it asks
// here for an address to PUT the MP3 to, signing the request with LAB_WORKER_SECRET (the same value on the worker and
// in Amplify). The platform names the file from the database, so a signed request can only ever write the audio of a
// lesson that has some, under courses/<course>/<lesson>/audio/.

/** A signed request older than this is refused, so a captured one can't be replayed later. */
const MAX_AGE_MS = 5 * 60_000;

const Body = z.object({ audioId: z.string().min(1).max(40), revision: z.number().int().min(1) });

const refuse = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const secret = process.env.LAB_WORKER_SECRET;
  if (!secret) return refuse(503, "LAB_WORKER_SECRET is not set on the platform.");
  if (!mediaUploadsConfigured()) return refuse(503, "The media bucket isn't configured on the platform.");

  const time = request.headers.get("x-worker-time") ?? "";
  const signature = request.headers.get("x-worker-signature") ?? "";
  const body = await request.text();
  const age = Date.now() - Number(time);
  if (!time || !Number.isFinite(age) || Math.abs(age) > MAX_AGE_MS) return refuse(401, "The request is too old or has no time.");
  const expected = Buffer.from(workerSignature(secret, time, body), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return refuse(401, "The signature doesn't match.");

  const parsed = Body.safeParse(JSON.parse(body || "null"));
  if (!parsed.success) return refuse(400, "Send audioId and revision.");
  const audio = await prisma.lessonAudio.findUnique({
    where: { id: parsed.data.audioId },
    select: { id: true, revision: true, lesson: { select: { slug: true, module: { select: { course: { select: { slug: true } } } } } } },
  });
  if (!audio) return refuse(404, "There's no such lesson audio.");
  // Only the next revision: the worker names it before it saves the row.
  if (parsed.data.revision !== audio.revision + 1) return refuse(409, `Expected revision ${audio.revision + 1}.`);

  const key = `courses/${audio.lesson.module.course.slug}/${audio.lesson.slug}/audio/${audio.id}-${parsed.data.revision}.mp3`;
  const upload = await presignUpload(key, "audio/mpeg", "public, max-age=31536000, immutable");
  return Response.json({ ...upload, path: `/media/${key}` });
}
