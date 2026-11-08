import { saveCaptions, transcribeVideo, translateCaptions } from "@/actions/video-media";
import { TRANSLATION_BATCH } from "@/lib/caption-limits";

// The admin page's side of a video's captions and poster (actions/video-media.ts): the steps of a caption run, each
// one request, and turning an image or a video frame into the poster's JPEG.

type Cue = { start: number; end: number; text: string };
export type CaptionRun = { ok: true; labels: string[] } | { ok: false; error: string };
/** Where a caption run is: what it is doing, and how far along overall (null while that can't be measured). */
export type CaptionStep = { detail: string; percent: number | null };

/** Batches translated at the same time: fast, without asking every model at once. */
const PARALLEL = 3;

/**
 * English captions from the video's narration, Spanish translated from them, saved on the video. `onStep` hears what
 * is happening, for the page to show: transcribing has no measure, translating runs from 10% to 90%, saving is the rest.
 */
export async function generateCaptions(partId: string, onStep: (step: CaptionStep) => void): Promise<CaptionRun> {
  const unreachable = { success: false as const, error: "We couldn't reach the server. Try again." };
  onStep({ detail: "Transcribing the narration", percent: null });
  let heard = await transcribeVideo(partId).catch(() => unreachable);
  // A first try can run out of time while the media host fetches a new file for Deepgram (seen: 25 s, then 7 s once
  // cached), so it is tried once more.
  if (!heard.success) {
    onStep({ detail: "Transcribing the narration (second try)", percent: null });
    heard = await transcribeVideo(partId).catch(() => unreachable);
  }
  if (!heard.success) return { ok: false, error: heard.error };
  const english = heard.cues;

  const batches: number[] = [];
  for (let at = 0; at < english.length; at += TRANSLATION_BATCH) batches.push(at);
  const spanish: (string | undefined)[] = new Array(english.length);
  let done = 0;
  const translating = () => onStep({ detail: `Translating ${done} of ${english.length} lines`, percent: 10 + (80 * done) / english.length });
  translating();
  const translate = async (at: number) => {
    const lines = english.slice(at, at + TRANSLATION_BATCH).map((cue) => cue.text);
    const context = english.slice(Math.max(0, at - 3), at).map((cue) => cue.text);
    // A batch that fails is tried once more: a model can come back with the wrong number of lines.
    let result = await translateCaptions(lines, context).catch(() => unreachable);
    if (!result.success) result = await translateCaptions(lines, context).catch(() => unreachable);
    if (!result.success) throw new Error(result.error);
    result.lines.forEach((line, index) => (spanish[at + index] = line));
    done += lines.length;
    translating();
  };
  try {
    const queue = [...batches];
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
        for (let at = queue.shift(); at !== undefined; at = queue.shift()) await translate(at);
      }),
    );
  } catch (error) {
    return { ok: false, error: `The Spanish translation failed: ${(error as Error).message}` };
  }

  onStep({ detail: "Saving the captions", percent: 95 });
  const es: Cue[] = english.map((cue, index) => ({ ...cue, text: spanish[index] ?? cue.text }));
  const saved = await saveCaptions(partId, { en: english, es }).catch(() => unreachable);
  return saved.success ? { ok: true, labels: saved.labels } : { ok: false, error: saved.error };
}

/** PUTs a file to a presigned URL, reporting progress. fetch can't report upload progress; XHR can. */
export function put(url: string, headers: Record<string, string>, body: Blob, onProgress?: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => onProgress?.(event.loaded);
    request.onload = () => (request.status < 300 ? resolve() : reject(new Error(`S3 answered ${request.status}`)));
    request.onerror = () => reject(new Error("The connection to S3 failed (check the bucket's CORS for this site)."));
    request.send(body);
  });
}

/** Posters are JPEGs at most 1920 px on their long side, like the encoded video. */
const POSTER_MAX = 1920;

function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const scale = Math.min(1, POSTER_MAX / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture couldn't be made"))), "image/jpeg", 0.88));
}

/** The frame on screen in a video. A video from the media host needs crossOrigin="anonymous" (its CORS allows it). */
export function frameToJpeg(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth) return Promise.reject(new Error("The video hasn't loaded yet"));
  return toJpeg(video, video.videoWidth, video.videoHeight);
}

/** An image of the admin's own (PNG, JPEG, WebP…), as the poster's JPEG. */
export async function imageToJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (PNG, JPEG or WebP).");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read.");
  });
  try {
    return await toJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
