"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLessonVideo, storedVideoTitle, type LessonVideo } from "@/lib/lesson-video";
import { MEDIA_PREFIX, resolveMediaUrls } from "@/lib/media";
import { deleteUpload, getEncodeJob, mediaUploadsConfigured, presignUpload, startEncodeJob, type PresignedUpload } from "@/lib/media-aws";

// Lesson videos uploaded from the admin page (/admin/videos):
//   1. startVideoUpload: a VideoUpload row and presigned URLs; the browser PUTs the original to uploads/<id>/,
//      and the poster and caption files straight to their final place under courses/<course>/<lesson>/<id>/.
//   2. startEncoding: a MediaConvert job writes <prefix>video.mp4.
//   3. refreshUpload, polled by the page: when the job completes, the video it was uploaded for points at the new
//      files (the quizzes of an interactive video are kept), or a new video joins the lesson's list; the original is
//      deleted.
// A lesson has several videos (docs/lesson-videos.md), in order, one per skill as a rule. The course repository's
// video (NN-MM-slug.video.json) is the lesson's REPOSITORY video, rewritten on every import; uploaded ones are kept.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

const IMMUTABLE = "public, max-age=31536000, immutable";
const MAX_BYTES = 5 * 1024 ** 3; // A single presigned PUT takes up to 5 GB.

const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-m4v": "m4v",
};

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  return session?.user.role === "ADMIN" ? session : null;
}

/** AWS errors say what is wrong (no credentials, a missing permission); keep that, minus the request ids. */
function awsMessage(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    return `${name}${error.message}`.slice(0, 500);
  }
  return "Unknown error";
}

const plainTitle = (title: string) => title.replaceAll("`", "");

/** What the admin page shows of one of a lesson's videos. */
function describeVideo(stored: unknown) {
  if (!stored) return null;
  let video: LessonVideo;
  try {
    video = parseLessonVideo(stored);
  } catch (error) {
    return { kind: "invalid" as const, error: (error as Error).message.split("\n")[0] };
  }
  const media = video.kind === "interactive" ? video.group.stimulus?.media : video.media;
  const signed = resolveMediaUrls({ poster: media?.poster ?? null });
  return {
    kind: video.kind,
    url: media?.url ?? null,
    poster: signed.poster,
    tracks: (media?.tracks ?? []).map((track) => track.label),
    quizzes: video.kind === "interactive" ? (video.group.timeline?.cues.length ?? 0) : 0,
  };
}

function describeUpload(upload: {
  id: string;
  status: string;
  fileName: string;
  percent: number | null;
  error: string | null;
  createdAt: Date;
  partId: string | null;
  skillKey: string | null;
  titleEn: string | null;
}) {
  return {
    id: upload.id,
    status: upload.status,
    fileName: upload.fileName,
    percent: upload.percent,
    error: upload.error,
    createdAt: upload.createdAt.toISOString(),
    partId: upload.partId,
    skillKey: upload.skillKey,
    titleEn: upload.titleEn,
  };
}
export type UploadSummary = ReturnType<typeof describeUpload>;

/**
 * Every course's lessons, each with its videos in order (a video per skill as a rule), the lesson's skills to make
 * videos for, and the uploads still in progress or that failed last.
 */
export async function listVideoLessons() {
  if (!(await requireAdmin())) return { configured: false, courses: [] };
  const courses = await prisma.course.findMany({
    orderBy: { title: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      modules: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          slug: true,
          position: true,
          title: true,
          lessons: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              slug: true,
              code: true,
              title: true,
              kind: true,
              videos: { orderBy: { position: "asc" } },
              practiceSkills: { orderBy: { position: "asc" }, select: { key: true, labelEn: true } },
              videoUploads: { orderBy: { createdAt: "desc" }, take: 10 },
            },
          },
        },
      },
    },
  });
  return {
    configured: mediaUploadsConfigured(),
    courses: courses.map((course) => ({
      ...course,
      modules: course.modules.map((courseModule) => ({
        ...courseModule,
        lessons: courseModule.lessons.map(({ videos, practiceSkills, videoUploads, ...lesson }) => {
          const skillLabel = new Map(practiceSkills.map((skill) => [skill.key, skill.labelEn]));
          // Per target (a video, or a new one for a skill or a title), only its latest upload, and only while not done.
          const latest = new Map<string, (typeof videoUploads)[number]>();
          for (const upload of videoUploads) {
            const target = upload.partId ?? `new:${upload.skillKey ?? upload.titleEn ?? ""}`;
            if (!latest.has(target)) latest.set(target, upload);
          }
          return {
            ...lesson,
            skills: practiceSkills.map((skill) => ({ key: skill.key, label: skill.labelEn, hasVideo: videos.some((video) => video.skillKey === skill.key) })),
            videos: videos.map((part) => ({
              id: part.id,
              position: part.position,
              skillKey: part.skillKey,
              title:
                part.titleEn ??
                (part.skillKey ? (skillLabel.get(part.skillKey) ?? part.skillKey) : (storedVideoTitle(part.video) ?? plainTitle(lesson.title))),
              source: part.source,
              durationSeconds: part.durationSeconds,
              video: describeVideo(part.video),
            })),
            uploads: [...latest.values()].filter((upload) => upload.status !== "READY").map(describeUpload),
          };
        }),
      })),
    })),
  };
}
export type VideoLessonList = Awaited<ReturnType<typeof listVideoLessons>>;

/** What an upload is for: replacing one of the lesson's videos, or a new one for a skill or with its own title. */
const TargetSchema = z.union([
  z.object({ partId: z.string().min(1) }),
  z.object({ skillKey: z.string().min(1).max(200) }),
  z.object({ titleEn: z.string().trim().min(1).max(200), titleEs: z.string().trim().min(1).max(200) }),
]);
export type VideoTarget = z.infer<typeof TargetSchema>;

const CaptionSchema = z.object({
  kind: z.enum(["captions", "subtitles"]),
  srclang: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  label: z.string().trim().min(1).max(60),
  default: z.boolean(),
});

const StartSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().refine((type) => type in VIDEO_TYPES, "Upload an MP4, MOV, WebM, MKV or M4V video."),
  size: z.number().int().positive().max(MAX_BYTES, "Videos up to 5 GB can be uploaded."),
  width: z.number().int().positive().max(8192).optional(),
  height: z.number().int().positive().max(8192).optional(),
  durationSeconds: z.number().positive().max(6 * 3600).optional(),
  poster: z.boolean(),
  captions: z
    .array(CaptionSchema)
    .max(6)
    .refine((list) => list.filter((caption) => caption.default).length <= 1, "Only one caption file can be the default.")
    .refine(
      (list) => new Set(list.map((caption) => `${caption.kind}.${caption.srclang}`)).size === list.length,
      "Two caption files have the same kind and language.",
    ),
});
export type StartVideoUploadInput = z.infer<typeof StartSchema>;

export async function startVideoUpload(
  lessonId: string,
  target: VideoTarget,
  input: StartVideoUploadInput,
): Promise<Result<{ uploadId: string; source: PresignedUpload; poster: PresignedUpload | null; captions: PresignedUpload[] }>> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "Only admins can upload videos." };
  if (!mediaUploadsConfigured()) {
    return { success: false, error: "Video uploads aren't set up here: MEDIA_BUCKET and MEDIA_CONVERT_ROLE_ARN are missing." };
  }
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid upload." };
  const data = parsed.data;
  const aim = TargetSchema.safeParse(target);
  if (!aim.success) return { success: false, error: "Say which video this is: one of the lesson's, a skill, or a title." };
  if ("partId" in aim.data) {
    const part = await prisma.lessonVideoPart.findFirst({ where: { id: aim.data.partId, lessonId }, select: { id: true } });
    if (!part) return { success: false, error: "That video isn't on this lesson any more. Reload the page." };
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { slug: true, module: { select: { course: { select: { slug: true } } } } },
  });
  if (!lesson) return { success: false, error: "Lesson not found." };

  try {
    // The row's id names the folders, so it is created first and its keys filled in after.
    const upload = await prisma.videoUpload.create({
      data: {
        lessonId,
        ...aim.data,
        fileName: data.fileName,
        sourceKey: "",
        outputPrefix: "",
        width: data.width,
        height: data.height,
        durationSeconds: data.durationSeconds,
        createdById: session.user.id,
      },
    });
    const outputPrefix = `courses/${lesson.module.course.slug}/${lesson.slug}/${upload.id}/`;
    const sourceKey = `uploads/${upload.id}/source.${VIDEO_TYPES[data.contentType]}`;
    const posterKey = data.poster ? `${outputPrefix}poster.jpg` : null;
    const captions = data.captions.map((caption) => ({ ...caption, key: `${outputPrefix}${caption.kind}.${caption.srclang}.vtt` }));
    await prisma.videoUpload.update({
      where: { id: upload.id },
      data: { sourceKey, outputPrefix, posterKey, captions: captions as Prisma.InputJsonArray },
    });

    const [source, poster, ...captionUploads] = await Promise.all([
      presignUpload(sourceKey, data.contentType),
      posterKey ? presignUpload(posterKey, "image/jpeg", IMMUTABLE) : Promise.resolve(null),
      ...captions.map((caption) => presignUpload(caption.key, "text/vtt; charset=utf-8", IMMUTABLE)),
    ]);
    return { success: true, uploadId: upload.id, source, poster, captions: captionUploads as PresignedUpload[] };
  } catch (error) {
    console.error("Failed to start a video upload:", error);
    return { success: false, error: `Couldn't prepare the upload. ${awsMessage(error)}` };
  }
}

/** The browser could not finish sending the files. */
export async function markUploadFailed(uploadId: string, message: string): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can upload videos." };
  await prisma.videoUpload.updateMany({
    where: { id: uploadId, status: "UPLOADING" },
    data: { status: "FAILED", error: message.slice(0, 500) },
  });
  return { success: true };
}

/** Called once the browser has sent every file: starts MediaConvert on the original. */
export async function startEncoding(uploadId: string): Promise<Result<{ upload: UploadSummary }>> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can upload videos." };
  const upload = await prisma.videoUpload.findUnique({ where: { id: uploadId } });
  if (!upload) return { success: false, error: "Upload not found." };
  if (upload.status !== "UPLOADING") return { success: true, upload: describeUpload(upload) };
  try {
    const jobId = await startEncodeJob({
      sourceKey: upload.sourceKey,
      outputPrefix: upload.outputPrefix,
      width: upload.width,
      height: upload.height,
      metadata: { uploadId: upload.id, lessonId: upload.lessonId, ...(upload.partId ? { partId: upload.partId } : {}) },
    });
    const updated = await prisma.videoUpload.update({ where: { id: upload.id }, data: { status: "ENCODING", jobId, percent: 0 } });
    return { success: true, upload: describeUpload(updated) };
  } catch (error) {
    console.error("Failed to start encoding:", error);
    const updated = await prisma.videoUpload.update({
      where: { id: upload.id },
      data: { status: "FAILED", error: `Encoding couldn't start. ${awsMessage(error)}` },
    });
    return { success: true, upload: describeUpload(updated) };
  }
}

/**
 * Puts the encoded files in the lesson: in the video it was uploaded for (an interactive one keeps its quizzes; only
 * its media changes), or as a new video at the end of the lesson's list (a second upload for the same skill replaces
 * that skill's video instead).
 */
async function attach(upload: Prisma.VideoUploadGetPayload<object>) {
  const lesson = await prisma.lesson.findUniqueOrThrow({ where: { id: upload.lessonId }, select: { title: true, module: { select: { courseId: true } } } });
  const existing = upload.partId
    ? await prisma.lessonVideoPart.findUnique({ where: { id: upload.partId } })
    : upload.skillKey
      ? await prisma.lessonVideoPart.findFirst({ where: { lessonId: upload.lessonId, skillKey: upload.skillKey }, orderBy: { position: "asc" } })
      : null;
  const skillKey = existing?.skillKey ?? upload.skillKey;
  const skill = skillKey
    ? await prisma.practiceSkill.findFirst({ where: { courseId: lesson.module.courseId, key: skillKey }, select: { labelEn: true } })
    : null;
  const title = existing?.titleEn ?? upload.titleEn ?? skill?.labelEn ?? plainTitle(lesson.title);
  const captions = z.array(CaptionSchema.extend({ key: z.string() })).parse(upload.captions);
  const path = (key: string) => `${MEDIA_PREFIX}${key}`;
  const media = {
    type: "video" as const,
    url: path(`${upload.outputPrefix}video.mp4`),
    alt: plainTitle(title),
    ...(upload.posterKey ? { poster: path(upload.posterKey) } : {}),
    ...(captions.length
      ? {
          tracks: captions.map((caption) => ({
            kind: caption.kind,
            src: path(caption.key),
            srclang: caption.srclang,
            label: caption.label,
            ...(caption.default ? { default: true } : {}),
          })),
        }
      : {}),
  };
  let next: unknown = media;
  if (existing) {
    try {
      const current = parseLessonVideo(existing.video);
      if (current.kind === "interactive") {
        next = { ...current.group, stimulus: { ...current.group.stimulus, media } };
      }
    } catch {
      // A stored video that no longer validates is replaced by the plain one.
    }
  }
  parseLessonVideo(next); // Throws, with every problem, before anything is saved.
  const video = next as Prisma.InputJsonValue;
  if (existing) {
    await prisma.lessonVideoPart.update({ where: { id: existing.id }, data: { video, source: "UPLOAD", durationSeconds: upload.durationSeconds } });
    if (!upload.partId) await prisma.videoUpload.update({ where: { id: upload.id }, data: { partId: existing.id } });
    return;
  }
  const last = await prisma.lessonVideoPart.findFirst({ where: { lessonId: upload.lessonId }, orderBy: { position: "desc" }, select: { position: true } });
  const part = await prisma.lessonVideoPart.create({
    data: {
      lessonId: upload.lessonId,
      position: (last?.position ?? -1) + 1,
      skillKey: upload.skillKey,
      titleEs: upload.titleEs,
      titleEn: upload.titleEn,
      video,
      source: "UPLOAD",
      durationSeconds: upload.durationSeconds,
    },
  });
  await prisma.videoUpload.update({ where: { id: upload.id }, data: { partId: part.id } });
}

/** Reads the encode's progress; when it has finished, attaches the video to its lesson. */
export async function refreshUpload(uploadId: string): Promise<Result<{ upload: UploadSummary }>> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can upload videos." };
  const upload = await prisma.videoUpload.findUnique({ where: { id: uploadId } });
  if (!upload) return { success: false, error: "Upload not found." };
  if (upload.status !== "ENCODING" || !upload.jobId) return { success: true, upload: describeUpload(upload) };

  try {
    const job = await getEncodeJob(upload.jobId);
    if (job.status === "COMPLETE") {
      try {
        await attach(upload);
      } catch (error) {
        const failed = await prisma.videoUpload.update({
          where: { id: upload.id },
          data: { status: "FAILED", error: `Encoded, but the lesson couldn't take it: ${(error as Error).message}`.slice(0, 500) },
        });
        return { success: true, upload: describeUpload(failed) };
      }
      const ready = await prisma.videoUpload.update({ where: { id: upload.id }, data: { status: "READY", percent: 100, error: null } });
      // The original is no longer needed; the bucket's lifecycle rule removes it anyway after 7 days.
      await deleteUpload(upload.sourceKey).catch((error) => console.warn("Couldn't delete the original:", error));
      revalidatePath("/courses", "layout");
      return { success: true, upload: describeUpload(ready) };
    }
    if (job.status === "ERROR" || job.status === "CANCELED") {
      const failed = await prisma.videoUpload.update({
        where: { id: upload.id },
        data: { status: "FAILED", error: job.error ?? `The encode was ${job.status.toLowerCase()}.` },
      });
      return { success: true, upload: describeUpload(failed) };
    }
    const progressing = await prisma.videoUpload.update({ where: { id: upload.id }, data: { percent: job.percent ?? upload.percent } });
    return { success: true, upload: describeUpload(progressing) };
  } catch (error) {
    console.error("Failed to read an encoding job:", error);
    return { success: false, error: `Couldn't read the encode's progress. ${awsMessage(error)}` };
  }
}

/**
 * Takes one video off its lesson. The files stay in S3, so uploading again or restoring by hand is possible. A
 * repository video comes back on the next import while its sidecar is in the repository.
 */
export async function removeLessonVideo(partId: string): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change lesson videos." };
  const part = await prisma.lessonVideoPart.findUnique({ where: { id: partId }, select: { lessonId: true } });
  if (!part) return { success: true };
  await prisma.lessonVideoPart.delete({ where: { id: partId } });
  await renumber(part.lessonId);
  revalidatePath("/courses", "layout");
  return { success: true };
}

/** Moves one of a lesson's videos up or down the lesson's list. */
export async function moveLessonVideo(partId: string, direction: "up" | "down"): Promise<Result> {
  if (!(await requireAdmin())) return { success: false, error: "Only admins can change lesson videos." };
  const part = await prisma.lessonVideoPart.findUnique({ where: { id: partId }, select: { lessonId: true } });
  if (!part) return { success: false, error: "That video is gone. Reload the page." };
  const parts = await prisma.lessonVideoPart.findMany({ where: { lessonId: part.lessonId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const at = parts.findIndex((entry) => entry.id === partId);
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= parts.length) return { success: true };
  [parts[at], parts[to]] = [parts[to], parts[at]];
  await prisma.$transaction(parts.map((entry, position) => prisma.lessonVideoPart.update({ where: { id: entry.id }, data: { position } })));
  revalidatePath("/courses", "layout");
  return { success: true };
}

/** Positions 0, 1, 2… in the current order, after a video was removed. */
async function renumber(lessonId: string) {
  const parts = await prisma.lessonVideoPart.findMany({ where: { lessonId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
  await prisma.$transaction(parts.map((entry, position) => prisma.lessonVideoPart.update({ where: { id: entry.id }, data: { position } })));
}
