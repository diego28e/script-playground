"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLessonVideo } from "@/lib/lesson-video";
import { MEDIA_PREFIX } from "@/lib/media";
import { mediaUploadsConfigured, presignUpload, putMediaFile, type PresignedUpload } from "@/lib/media-aws";
import { CAPTION_TRACKS, TRANSLATION_BATCH, cuesFromWords, toVtt, transcribe, translateLines, type CaptionLanguage, type Cue } from "@/lib/captions";

// Changes to a lesson video that is already on its lesson (docs/lesson-videos.md), from the admin page:
// - captions: English from Deepgram's transcript, Spanish translated from it, each step one request (Amplify stops a
//   request after about 30 s), run in turn by the page: transcribeVideo, then translateCaptions batch by batch, then
//   saveCaptions writes both tracks; the page starts them by itself when an upload finishes encoding;
// - the poster: an image of the admin's own, or a frame of the video, sent from the browser (startPosterChange, then
//   setVideoPoster).
// New files get new keys under courses/<course>/<lesson>/<video id>/: media files are cached for a year and never
// change in place.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

const REQUEST_BUDGET_MS = 25_000;

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.role === "ADMIN" ? session : null;
}

const message = (error: unknown) => (error instanceof Error ? error.message : "Unknown error").slice(0, 500);

async function findPart(partId: string) {
  return prisma.lessonVideoPart.findUnique({
    where: { id: partId },
    select: { id: true, video: true, lesson: { select: { slug: true, module: { select: { course: { select: { slug: true } } } } } } },
  });
}

/** Where a video's newer files go: its own folder beside the lesson's other videos. */
const folderOf = (part: NonNullable<Awaited<ReturnType<typeof findPart>>>) => `courses/${part.lesson.module.course.slug}/${part.lesson.slug}/${part.id}/`;

type StoredMedia = { url?: unknown; poster?: unknown; tracks?: { kind?: unknown; srclang?: unknown }[] } & Record<string, unknown>;

/** The media object inside a stored video: the video itself when plain, its stimulus's when interactive. */
function storedMedia(video: unknown): StoredMedia | null {
  if (!video || typeof video !== "object") return null;
  const stored = video as { type?: unknown; stimulus?: { media?: StoredMedia } };
  return stored.type === "item-group" ? (stored.stimulus?.media ?? null) : (video as StoredMedia);
}

/** Changes a video's media (the stored JSON, so nothing else in it moves), checks the result, and saves it. */
async function editMedia(partId: string, edit: (media: StoredMedia) => StoredMedia) {
  const part = await prisma.lessonVideoPart.findUniqueOrThrow({ where: { id: partId }, select: { video: true } });
  const video = structuredClone(part.video) as Record<string, unknown>;
  const media = storedMedia(video);
  if (!media) throw new Error("This video has no media to change");
  const next = edit(media);
  const updated = video.type === "item-group" ? { ...video, stimulus: { ...(video.stimulus as object), media: next } } : next;
  parseLessonVideo(updated); // Throws, with every problem, before anything is saved.
  await prisma.lessonVideoPart.update({ where: { id: partId }, data: { video: updated as Prisma.InputJsonValue } });
  revalidatePath("/courses", "layout");
}

/** Step 1: the English cues, from Deepgram's transcript of the video's narration. */
export async function transcribeVideo(partId: string): Promise<Result<{ cues: Cue[] }>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Only admins can caption videos." };
  const part = await findPart(partId);
  if (!part) return { success: false, error: "That video is gone. Reload the page." };
  const url = storedMedia(part.video)?.url;
  if (typeof url !== "string" || !url.startsWith(MEDIA_PREFIX)) return { success: false, error: "This video's file isn't on the media host." };
  try {
    const words = await transcribe(url, AbortSignal.timeout(REQUEST_BUDGET_MS));
    return { success: true, cues: cuesFromWords(words) };
  } catch (error) {
    console.error("Failed to transcribe a video:", error);
    return { success: false, error: message(error) };
  }
}

const LinesSchema = z.array(z.string().trim().min(1).max(300)).min(1).max(TRANSLATION_BATCH);

/** Step 2, once per batch: English caption lines in Spanish, line for line. */
export async function translateCaptions(lines: string[], context: string[]): Promise<Result<{ lines: string[] }>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Only admins can caption videos." };
  const parsedLines = LinesSchema.safeParse(lines);
  const parsedContext = z.array(z.string().max(300)).max(6).safeParse(context);
  if (!parsedLines.success || !parsedContext.success) return { success: false, error: "Those caption lines can't be translated." };
  try {
    return { success: true, lines: await translateLines(parsedLines.data, parsedContext.data, session.user.id, Date.now() + REQUEST_BUDGET_MS) };
  } catch (error) {
    console.error("Failed to translate captions:", error);
    return { success: false, error: message(error) };
  }
}

const CueSchema = z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().trim().min(1).max(300) });
const TracksSchema = z.object({ en: z.array(CueSchema).min(1).max(5000), es: z.array(CueSchema).max(5000).optional() });

/**
 * Step 3: writes the tracks as WebVTT files and puts them on the video, in place of its English and Spanish tracks
 * (a track in another language stays). English is the captions track, Spanish the subtitles track; neither is on by
 * default, so each learner chooses in the player.
 */
export async function saveCaptions(partId: string, tracks: { en: Cue[]; es?: Cue[] }): Promise<Result<{ labels: string[] }>> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can caption videos." };
  if (!mediaUploadsConfigured()) return { success: false, error: "Media uploads aren't set up here: MEDIA_BUCKET is missing." };
  const parsed = TracksSchema.safeParse(tracks);
  if (!parsed.success) return { success: false, error: "Those captions are incomplete." };
  const part = await findPart(partId);
  if (!part) return { success: false, error: "That video is gone. Reload the page." };
  try {
    const version = Date.now().toString(36);
    const written: { language: CaptionLanguage; path: string }[] = [];
    for (const language of ["en", "es"] as const) {
      const cues = parsed.data[language];
      if (!cues?.length) continue;
      const key = `${folderOf(part)}captions-${version}.${language}.vtt`;
      await putMediaFile(key, toVtt(cues), "text/vtt; charset=utf-8");
      written.push({ language, path: `${MEDIA_PREFIX}${key}` });
    }
    const replaced = new Set(written.map((track) => track.language as string));
    let labels: string[] = [];
    await editMedia(partId, (media) => {
      const kept = (media.tracks ?? []).filter((track) => typeof track.srclang !== "string" || !replaced.has(track.srclang.split("-")[0].toLowerCase()));
      const added = written.map((track) => ({ ...CAPTION_TRACKS[track.language], src: track.path }));
      const all = [...added, ...kept];
      labels = all.map((track) => String((track as { label?: unknown }).label ?? track.srclang));
      return { ...media, tracks: all };
    });
    return { success: true, labels };
  } catch (error) {
    console.error("Failed to save captions:", error);
    return { success: false, error: message(error) };
  }
}

/** A poster's upload URL, at a new key in the video's folder. */
export async function startPosterChange(partId: string): Promise<Result<{ key: string; upload: PresignedUpload }>> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change lesson videos." };
  if (!mediaUploadsConfigured()) return { success: false, error: "Media uploads aren't set up here: MEDIA_BUCKET is missing." };
  const part = await findPart(partId);
  if (!part) return { success: false, error: "That video is gone. Reload the page." };
  const key = `${folderOf(part)}poster-${Date.now().toString(36)}.jpg`;
  try {
    return { success: true, key, upload: await presignUpload(key, "image/jpeg", "public, max-age=31536000, immutable") };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}

/** Puts the poster the browser just sent on the video. */
export async function setVideoPoster(partId: string, key: string): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change lesson videos." };
  const part = await findPart(partId);
  if (!part) return { success: false, error: "That video is gone. Reload the page." };
  if (!key.startsWith(`${folderOf(part)}poster-`) || !key.endsWith(".jpg")) return { success: false, error: "That poster isn't this video's." };
  try {
    await editMedia(partId, (media) => ({ ...media, poster: `${MEDIA_PREFIX}${key}` }));
    return { success: true };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}
