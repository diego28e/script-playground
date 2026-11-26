import { prisma } from "@/lib/prisma";
import type { PlayerStop } from "@/lib/lesson-stops/shared";

/**
 * A lesson's hands-on stops for its players, by recording ("audio" or "video:<id>"), when its course pauses at them
 * (docs/lesson-stops.md). Empty when the course's switch is off, so stops being reviewed never reach learners.
 */
export async function lessonPlayerStops(lessonId: string): Promise<Map<string, PlayerStop[]>> {
  const stops = await prisma.lessonStop.findMany({
    where: { lessonId, lesson: { module: { course: { lessonStops: true } } } },
    orderBy: { at: "asc" },
    select: { id: true, media: true, at: true, titleEs: true, titleEn: true, stepEs: true, stepEn: true, commands: true },
  });
  const byMedia = new Map<string, PlayerStop[]>();
  for (const { media, ...stop } of stops) byMedia.set(media, [...(byMedia.get(media) ?? []), stop]);
  return byMedia;
}
