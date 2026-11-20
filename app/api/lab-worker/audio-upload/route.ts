import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { mediaUploadsConfigured, presignUpload } from "@/lib/media-aws";
import { verifiedWorkerBody } from "@/lib/lesson-audio/worker-auth";

export const runtime = "nodejs";

// The practice worker's way to store a lesson's audio (docs/lesson-audio.md): it holds no AWS credentials, so it asks
// here for an address to PUT the MP3 to, signing the request with LAB_WORKER_SECRET (the same value on the worker and
// in Amplify). The platform names the file from the database, so a signed request can only ever write the audio of a
// lesson that has some, under courses/<course>/<lesson>/audio/.

const Body = z.object({ audioId: z.string().min(1).max(40), revision: z.number().int().min(1) });

const refuse = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const verified = await verifiedWorkerBody(request);
  if (!verified.ok) return verified.response;
  if (!mediaUploadsConfigured()) return refuse(503, "The media bucket isn't configured on the platform.");

  const parsed = Body.safeParse(JSON.parse(verified.body || "null"));
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
