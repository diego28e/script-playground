import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveMediaUrls } from "@/lib/media";
import { verifiedWorkerBody } from "@/lib/lesson-audio/worker-auth";

export const runtime = "nodejs";

// The practice worker's way to read a lesson's voiced audio (docs/lesson-audio.md, "Following the audio"): a signed
// address for Deepgram to listen to it, to time the transcript. Signed like audio-upload; only an existing lesson
// audio's current file.

const Body = z.object({ audioId: z.string().min(1).max(40) });

export async function POST(request: Request) {
  const verified = await verifiedWorkerBody(request);
  if (!verified.ok) return verified.response;
  const parsed = Body.safeParse(JSON.parse(verified.body || "null"));
  if (!parsed.success) return Response.json({ error: "Send audioId." }, { status: 400 });
  const audio = await prisma.lessonAudio.findUnique({ where: { id: parsed.data.audioId }, select: { audioPath: true } });
  if (!audio?.audioPath) return Response.json({ error: "That lesson has no voiced audio." }, { status: 404 });
  // A signed CloudFront address in production; on a PC, the /media/ path the platform serves itself.
  return Response.json({ url: resolveMediaUrls(audio.audioPath) });
}
