"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Captions, Check, FileText, Film, GitBranch, ImageIcon, ImageUp, Plus, Trash2, Upload, X } from "lucide-react";
import {
  markUploadFailed,
  moveLessonVideo,
  refreshUpload,
  removeLessonVideo,
  startEncoding,
  startVideoUpload,
  type UploadSummary,
  type VideoLessonList,
  type VideoTarget,
} from "@/actions/videos";
import { setVideoPoster, startPosterChange } from "@/actions/video-media";
import { frameToJpeg, generateCaptions, imageToJpeg, put, type CaptionStep } from "@/components/admin/video-media-client";
import { VideoProgress } from "@/components/admin/video-progress";
import { Tip } from "@/components/ui/tip";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Lesson = VideoLessonList["courses"][number]["modules"][number]["lessons"][number];
type Part = Lesson["videos"][number];

const LANGUAGES: Record<string, string> = { es: "Español", en: "English", pt: "Português", fr: "Français" };
const POLL_MS = 5000;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function VideoManager({ data }: { data: VideoLessonList }) {
  if (data.courses.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No courses yet. Import one first.</p>;
  }
  return (
    <div className="space-y-6">
      {!data.configured && (
        <p className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Uploads aren&apos;t set up on this server: MEDIA_BUCKET and MEDIA_CONVERT_ROLE_ARN are missing (infra/media/README.md).
          You can still see and remove lesson videos.
        </p>
      )}
      {data.courses.map((course) => (
        <section key={course.id} className="space-y-3">
          <h3 className="font-semibold">
            {course.title}
            {course.status === "DRAFT" && <span className="ml-2 text-xs font-normal text-muted-foreground">draft</span>}
          </h3>
          <div className="divide-y divide-border rounded-xl border border-border">
            {course.modules.map((courseModule) => {
              const withVideo = courseModule.lessons.filter((lesson) => lesson.videos.length > 0).length;
              return (
                <details key={courseModule.id} className="group" open={courseModule.position === 0}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
                    <span className="w-6 font-mono text-xs text-muted-foreground">{String(courseModule.position).padStart(2, "0")}</span>
                    <span className="flex-1 font-medium">{courseModule.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {withVideo}/{courseModule.lessons.length} with video
                    </span>
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {courseModule.lessons.map((lesson) => (
                      <LessonRow key={lesson.id} lesson={lesson} configured={data.configured} />
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function VideoBadge({ video }: { video: Part["video"] }) {
  if (!video) return <span className="text-xs text-muted-foreground">No video</span>;
  if (video.kind === "invalid") return <span className="text-xs text-destructive">Invalid video: {video.error}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 text-foreground">
        <Film className="h-3.5 w-3.5" />
        {video.kind === "interactive" ? `Interactive · ${video.quizzes} quiz${video.quizzes === 1 ? "" : "zes"}` : "Video"}
      </span>
      {video.tracks.length > 0 && (
        <span className="inline-flex items-center gap-1">
          <Captions className="h-3.5 w-3.5" />
          {video.tracks.join(", ")}
        </span>
      )}
    </span>
  );
}

/** An upload still running, or the last one that failed, with what it's for. */
function UploadStatus({ upload, label }: { upload: UploadSummary; label: string }) {
  if (upload.status === "READY") return null;
  if (upload.status === "FAILED") {
    return (
      <p className="text-xs text-destructive">
        Upload for {label} failed: {upload.error ?? "unknown error"}
      </p>
    );
  }
  // MediaConvert reports 0% for a while before it measures anything: the encode sweeps until then.
  const encodeShare = upload.percent ? upload.percent : null;
  return (
    <VideoProgress
      title={label}
      subtitle={upload.fileName}
      steps={[
        upload.status === "UPLOADING"
          ? { label: "Upload", state: "active", percent: null, detail: "Waiting for the upload to finish" }
          : { label: "Upload", state: "done" },
        upload.status === "ENCODING"
          ? { label: "Encode", state: "active", percent: encodeShare, detail: encodeShare ? "Encoding" : "Starting the encode" }
          : { label: "Encode", state: "waiting" },
        ...(upload.ownCaptions ? [] : [{ label: "Captions", state: "waiting" as const }]),
      ]}
    />
  );
}

/** What is open under the lesson: the uploader (replacing one of its videos, or adding one), or a video's poster. */
type Opened = { kind: "replace"; part: Part } | { kind: "add" } | { kind: "poster"; part: Part } | null;

/** A caption run on one of the lesson's videos: where it is (and whether it follows an upload), or why it stopped. */
type Captioning = { step: CaptionStep; afterUpload: boolean } | { error: string };

function LessonRow({ lesson, configured }: { lesson: Lesson; configured: boolean }) {
  const router = useRouter();
  const [opened, setOpened] = useState<Opened>(null);
  const [uploads, setUploads] = useState<UploadSummary[]>(lesson.uploads);
  const [pending, startPending] = useTransition();

  // Caption runs on this lesson's videos, by video id: the step each is on, or why it stopped.
  const [captioning, setCaptioning] = useState<Record<string, Captioning>>({});
  const runCaptions = useCallback(
    async (partId: string, afterUpload = false) => {
      const show = (state: Captioning) => setCaptioning((all) => ({ ...all, [partId]: state }));
      show({ step: { detail: "Starting", percent: null }, afterUpload });
      const result = await generateCaptions(partId, (step) => show({ step, afterUpload }));
      if (!result.ok) {
        show({ error: result.error });
        toast.error("The captions couldn't be made. The reason is under the video.");
        return;
      }
      setCaptioning((all) => {
        const rest = { ...all };
        delete rest[partId];
        return rest;
      });
      toast.success(`Captions ready: ${result.labels.join(", ")}.`);
      router.refresh();
    },
    [router],
  );

  const labelOf = useCallback((upload: UploadSummary) => {
    if (upload.partId) return lesson.videos.find((part) => part.id === upload.partId)?.title ?? "a video";
    if (upload.skillKey) return lesson.skills.find((skill) => skill.key === upload.skillKey)?.label ?? upload.skillKey;
    return upload.titleEn ?? "a new video";
  }, [lesson.videos, lesson.skills]);

  // Encodes started earlier (or in another tab) are followed here until they finish.
  useEffect(() => {
    const encoding = uploads.filter((upload) => upload.status === "ENCODING");
    if (!encoding.length) return;
    const timer = setTimeout(async () => {
      const results = await Promise.all(encoding.map((upload) => refreshUpload(upload.id).catch(() => null)));
      let changed = false;
      // A video that has just finished encoding with no caption files gets its captions made right away.
      const toCaption: string[] = [];
      const next = uploads.map((upload) => {
        const result = results[encoding.indexOf(upload)];
        if (!result?.success) return upload;
        if (result.upload.status !== upload.status) changed = true;
        if (result.upload.status === "READY") {
          toast.success(`Video ready: ${labelOf(result.upload)}.`);
          if (result.needsCaptions && result.upload.partId) toCaption.push(result.upload.partId);
        }
        if (result.upload.status === "FAILED") toast.error("An encode failed. The reason is under the lesson.");
        return result.upload;
      });
      setUploads(next.filter((upload) => upload.status !== "READY"));
      if (changed) router.refresh();
      for (const partId of toCaption) void runCaptions(partId, true);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [uploads, router, labelOf, runCaptions]);

  const { confirm, dialog } = useConfirm();
  const remove = async (part: Part) => {
    const ok = await confirm({
      title: "Take this video off the lesson?",
      detail: part.title,
      description:
        part.source === "REPOSITORY"
          ? "Learners stop seeing it. It comes from the course repository, so the next import brings it back while its .video.json is there."
          : "Learners stop seeing it. The files stay in the media bucket, and you can upload it again.",
      confirmLabel: "Remove video",
      tone: "danger",
    });
    if (!ok) return;
    startPending(async () => {
      const result = await removeLessonVideo(part.id).catch(() => null);
      if (!result?.success) {
        toast.error(result?.error ?? "We couldn't reach the server. Try again.");
        return;
      }
      toast.success("Video removed from the lesson.");
      router.refresh();
    });
  };
  const remakeCaptions = async (part: Part) => {
    const has = part.video && part.video.kind !== "invalid" && part.video.tracks.length > 0;
    if (has) {
      const ok = await confirm({
        title: "Make this video's captions again?",
        detail: part.title,
        description: "The English captions are transcribed from the narration again and translated to Spanish. They replace the video's English and Spanish tracks.",
        confirmLabel: "Make captions",
      });
      if (!ok) return;
    }
    void runCaptions(part.id);
  };
  const move = (part: Part, direction: "up" | "down") =>
    startPending(async () => {
      const result = await moveLessonVideo(part.id, direction).catch(() => null);
      if (!result?.success) toast.error(result?.error ?? "We couldn't reach the server. Try again.");
      router.refresh();
    });

  const busy = uploads.some((upload) => upload.status === "UPLOADING" || upload.status === "ENCODING");
  const firstPoster = lesson.videos.find((part) => part.video && part.video.kind !== "invalid" && part.video.poster)?.video;
  const missing = lesson.skills.filter((skill) => !skill.hasVideo).length;
  return (
    <li className="px-4 py-3">
      {dialog}
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 md:grid-cols-[3rem_minmax(0,1fr)_auto]">
        {firstPoster && firstPoster.kind !== "invalid" && firstPoster.poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed CloudFront URL, not an optimisable asset
          <img src={firstPoster.poster} alt="" className="h-12 w-12 shrink-0 rounded-md bg-black object-cover" />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <Film className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <p className="text-sm">
            {lesson.code && <span className="mr-2 font-mono text-xs text-muted-foreground">{lesson.code}</span>}
            {lesson.title.replaceAll("`", "")}
          </p>
          <p className="text-xs text-muted-foreground">
            {lesson.videos.length === 0 ? "No videos" : `${lesson.videos.length} video${lesson.videos.length === 1 ? "" : "s"}`}
            {lesson.skills.length > 0 && ` · ${lesson.skills.length - missing} of ${lesson.skills.length} skills have one`}
          </p>
          {uploads.map((upload) => (
            <UploadStatus key={upload.id} upload={upload} label={labelOf(upload)} />
          ))}
        </div>
        <div className="col-start-2 flex flex-wrap gap-2 md:col-start-3 md:justify-end">
          {/* What the session that makes this lesson's videos reads (lib/video-brief.ts). */}
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/admin/videos/brief/${lesson.id}`}>
              <FileText className="mr-1.5 h-4 w-4" />
              Video brief
            </Link>
          </Button>
          <Button variant={opened?.kind === "add" ? "secondary" : "outline"} size="sm" onClick={() => setOpened(opened?.kind === "add" ? null : { kind: "add" })} disabled={!configured}>
            {opened?.kind === "add" ? <X className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
            {opened?.kind === "add" ? "Close" : "Add video"}
          </Button>
        </div>
      </div>

      {lesson.videos.length > 0 && (
        <ol className="mt-3 divide-y divide-border rounded-lg border border-border md:ml-[3.75rem]">
          {lesson.videos.map((part, index) => (
            <li key={part.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="w-5 font-mono text-xs text-muted-foreground">{index + 1}</span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm">
                  {part.title}
                  {part.skillKey === null && part.source !== "REPOSITORY" && <span className="ml-2 text-xs text-muted-foreground">(own title)</span>}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <VideoBadge video={part.video} />
                  {part.durationSeconds ? <span className="font-mono">{clock(part.durationSeconds)}</span> : null}
                  {part.source === "REPOSITORY" && (
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="h-3.5 w-3.5" /> From the course repository
                    </span>
                  )}
                </div>
                {captioning[part.id] && "error" in captioning[part.id] && (
                  <p className="text-xs text-destructive">Captions failed: {(captioning[part.id] as { error: string }).error}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Tip content="Move up">
                  <Button variant="ghost" size="icon" aria-label="Move up" disabled={index === 0 || pending} onClick={() => move(part, "up")}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </Tip>
                <Tip content="Move down">
                  <Button variant="ghost" size="icon" aria-label="Move down" disabled={index === lesson.videos.length - 1 || pending} onClick={() => move(part, "down")}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </Tip>
                <Button
                  variant={opened?.kind === "replace" && opened.part.id === part.id ? "secondary" : "ghost"}
                  size="sm"
                  disabled={!configured || busy}
                  onClick={() => setOpened(opened?.kind === "replace" && opened.part.id === part.id ? null : { kind: "replace", part })}
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  Replace
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!configured || !part.video || part.video.kind === "invalid" || (captioning[part.id] !== undefined && "step" in captioning[part.id])}
                  onClick={() => void remakeCaptions(part)}
                >
                  <Captions className="mr-1.5 h-4 w-4" />
                  Captions
                </Button>
                <Button
                  variant={opened?.kind === "poster" && opened.part.id === part.id ? "secondary" : "ghost"}
                  size="sm"
                  disabled={!configured || !part.video || part.video.kind === "invalid"}
                  onClick={() => setOpened(opened?.kind === "poster" && opened.part.id === part.id ? null : { kind: "poster", part })}
                >
                  <ImageUp className="mr-1.5 h-4 w-4" />
                  Poster
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void remove(part)} disabled={pending}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Remove
                </Button>
              </div>
              {(() => {
                const run = captioning[part.id];
                if (!run || !("step" in run)) return null;
                const captions = { label: "Captions", state: "active" as const, percent: run.step.percent, detail: run.step.detail };
                return (
                  <div className="basis-full pb-1 pt-1.5">
                    <VideoProgress
                      title={run.afterUpload ? part.title : "English captions and Spanish subtitles"}
                      subtitle={run.afterUpload ? "English captions and Spanish subtitles, made from the narration" : part.title}
                      steps={run.afterUpload ? [{ label: "Upload", state: "done" }, { label: "Encode", state: "done" }, captions] : [captions]}
                    />
                  </div>
                );
              })()}
            </li>
          ))}
        </ol>
      )}

      {opened?.kind === "replace" && (
        <Uploader
          lessonId={lesson.id}
          target={{ partId: opened.part.id }}
          heading={`Replace “${opened.part.title}”`}
          keepsQuizzes={opened.part.video?.kind === "interactive"}
          onStarted={(summary) => setUploads((list) => [summary, ...list.filter((upload) => upload.partId !== summary.partId)])}
          onDone={() => setOpened(null)}
        />
      )}
      {opened?.kind === "add" && (
        <AddVideo
          lesson={lesson}
          onStarted={(summary) =>
            setUploads((list) => [
              summary,
              ...list.filter((upload) => upload.partId !== null || upload.skillKey !== summary.skillKey || upload.titleEn !== summary.titleEn),
            ])
          }
          onDone={() => setOpened(null)}
        />
      )}
      {opened?.kind === "poster" && (
        <PosterChanger
          key={opened.part.id}
          part={opened.part}
          onDone={() => {
            setOpened(null);
            router.refresh();
          }}
        />
      )}
    </li>
  );
}

/** A new poster for a video on the lesson: an image of the admin's own, or a frame of the video. */
function PosterChanger({ part, onDone }: { part: Part; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [poster, setPoster] = useState<{ blob: Blob; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => () => void (poster && URL.revokeObjectURL(poster.url)), [poster]);
  const media = part.video && part.video.kind !== "invalid" ? part.video : null;

  const take = async (make: () => Promise<Blob>) => {
    try {
      const blob = await make();
      setPoster({ blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const save = async () => {
    if (!poster) return;
    setSaving(true);
    const unreachable = { success: false as const, error: "We couldn't reach the server. Try again." };
    const started = await startPosterChange(part.id).catch(() => unreachable);
    if (!started.success) {
      setSaving(false);
      toast.error(started.error);
      return;
    }
    try {
      await put(started.upload.url, started.upload.headers, poster.blob);
    } catch (error) {
      setSaving(false);
      toast.error(`The poster couldn't be uploaded: ${(error as Error).message}`);
      return;
    }
    const saved = await setVideoPoster(part.id, started.key).catch(() => unreachable);
    setSaving(false);
    if (!saved.success) {
      toast.error(saved.error);
      return;
    }
    toast.success("Poster changed.");
    onDone();
  };

  return (
    <div className="mt-4 grid gap-5 rounded-xl border border-border bg-card p-4 md:ml-[3.75rem] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <p className="text-sm font-medium md:col-span-2">Poster for “{part.title}”</p>
      <div className="space-y-2">
        {media?.src ? (
          <video
            ref={videoRef}
            src={media.src}
            // The media host allows this origin (CORS), so the frame on screen can be drawn into the poster.
            crossOrigin="anonymous"
            controls
            muted
            playsInline
            preload="metadata"
            poster={media.poster ?? undefined}
            className="aspect-video w-full rounded-lg bg-black"
          />
        ) : null}
        <p className="text-xs text-muted-foreground">Play or seek to the frame you want, or upload an image of your own (PNG, JPEG or WebP, 16:9 looks best).</p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {poster || media?.poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview, or the current signed poster
            <img src={poster?.url ?? media?.poster ?? ""} alt={poster ? "New poster" : "Current poster"} className="h-24 rounded-md bg-black object-contain" />
          ) : (
            <span className="grid h-24 w-24 place-items-center rounded-md bg-muted text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </span>
          )}
          <span className="text-xs text-muted-foreground">{poster ? "New poster" : media?.poster ? "Current poster" : "No poster yet"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={saving || !media?.src} onClick={() => videoRef.current && void take(() => frameToJpeg(videoRef.current!))}>
            Use the frame on screen
          </Button>
          <ImagePicker disabled={saving} onPick={(file) => void take(() => imageToJpeg(file))} />
        </div>
        <Button onClick={save} disabled={!poster} loading={saving} loadingLabel="Saving the poster">
          <Check className="mr-1.5 h-4 w-4" />
          Save poster
        </Button>
      </div>
    </div>
  );
}

/** A button that opens the file picker for an image. */
function ImagePicker({ disabled, onPick }: { disabled?: boolean; onPick: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onPick(file);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <ImageUp className="mr-1.5 h-4 w-4" />
        Upload an image
      </Button>
    </>
  );
}

/**
 * A new video for the lesson: for one of its skills (those without a video first; one that has a video gets it
 * replaced), or another video with its own title.
 */
function AddVideo({ lesson, onStarted, onDone }: { lesson: Lesson; onStarted: (upload: UploadSummary) => void; onDone: () => void }) {
  const ordered = [...lesson.skills.filter((skill) => !skill.hasVideo), ...lesson.skills.filter((skill) => skill.hasVideo)];
  const [choice, setChoice] = useState<string>(ordered[0]?.key ?? "__own");
  const [titleEn, setTitleEn] = useState("");
  const [titleEs, setTitleEs] = useState("");
  const own = choice === "__own";
  const skill = lesson.skills.find((entry) => entry.key === choice);
  const target: VideoTarget | null = own ? (titleEn.trim() && titleEs.trim() ? { titleEn: titleEn.trim(), titleEs: titleEs.trim() } : null) : { skillKey: choice };
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-border bg-card p-4 md:ml-[3.75rem]">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor={`target-${lesson.id}`}>What it teaches</Label>
          <select id={`target-${lesson.id}`} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={choice} onChange={(event) => setChoice(event.target.value)}>
            {ordered.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
                {entry.hasVideo ? " (has a video: replaces it)" : ""}
              </option>
            ))}
            <option value="__own">Another video, with its own title</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {lesson.skills.length
              ? "One video per skill, in the lesson's order; reorder them in the list afterwards."
              : "This lesson has no skills yet (Admin → Practice): give the video its own title."}
          </p>
        </div>
        {own && (
          <div className="grid gap-2">
            <Input aria-label="Title in English" placeholder="Title in English" value={titleEn} onChange={(event) => setTitleEn(event.target.value)} maxLength={200} />
            <Input aria-label="Title in Spanish" placeholder="Título en español" value={titleEs} onChange={(event) => setTitleEs(event.target.value)} maxLength={200} />
          </div>
        )}
      </div>
      {target ? (
        <Uploader
          key={own ? "own" : choice}
          lessonId={lesson.id}
          target={target}
          heading={own ? "Upload the video" : `Video for “${skill?.label ?? choice}”`}
          keepsQuizzes={false}
          onStarted={onStarted}
          onDone={onDone}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Give the video a title in both languages to upload it.</p>
      )}
    </div>
  );
}

type CaptionDraft = { id: number; file: File | null; srclang: string; label: string; kind: "captions" | "subtitles"; default: boolean; error: string | null };

function Uploader({
  lessonId,
  target,
  heading,
  keepsQuizzes,
  onStarted,
  onDone,
}: {
  lessonId: string;
  target: VideoTarget;
  heading: string;
  keepsQuizzes: boolean;
  onStarted: (upload: UploadSummary) => void;
  onDone: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ width: number; height: number; duration: number } | null>(null);
  const [poster, setPoster] = useState<{ blob: Blob; url: string } | null>(null);
  const [captions, setCaptions] = useState<CaptionDraft[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  // The first seek (to a tenth of the way in) picks a poster; later seeks are the admin's.
  const autoPoster = useRef(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  useEffect(() => () => void (poster && URL.revokeObjectURL(poster.url)), [poster]);

  const choose = (chosen: File | null) => {
    setFile(chosen);
    setMeta(null);
    setPoster(null);
    autoPoster.current = false;
    setPreview(chosen ? URL.createObjectURL(chosen) : null);
  };

  const takePoster = async (make: () => Promise<Blob>) => {
    try {
      const blob = await make();
      setPoster({ blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  /** The frame on screen, as the poster. */
  const capturePoster = () => {
    const video = videoRef.current;
    if (video?.videoWidth) void takePoster(() => frameToJpeg(video));
  };

  const addCaption = () =>
    setCaptions((list) => [...list, { id: Date.now(), file: null, srclang: "es", label: LANGUAGES.es, kind: "subtitles", default: list.length === 0, error: null }]);
  const updateCaption = (id: number, change: Partial<CaptionDraft>) =>
    setCaptions((list) => list.map((caption) => (caption.id === id ? { ...caption, ...change } : caption)));
  const readCaption = async (id: number, chosen: File | null) => {
    if (!chosen) return updateCaption(id, { file: null, error: null });
    const text = await chosen.text();
    updateCaption(id, { file: chosen, error: /^﻿?WEBVTT/.test(text) ? null : "Not a WebVTT file: it must start with WEBVTT." });
  };

  const ready = file && meta && captions.every((caption) => caption.file && !caption.error && caption.label.trim());

  const upload = async () => {
    if (!file || !meta) return;
    setStage("Preparing…");
    const result = await startVideoUpload(lessonId, target, {
      fileName: file.name,
      contentType: file.type || "video/mp4",
      size: file.size,
      width: meta.width || undefined,
      height: meta.height || undefined,
      durationSeconds: meta.duration || undefined,
      poster: Boolean(poster),
      captions: captions.map((caption) => ({ kind: caption.kind, srclang: caption.srclang, label: caption.label.trim(), default: caption.default })),
    }).catch(() => ({ success: false as const, error: "We couldn't reach the server. Try again." }));
    if (!result.success) {
      setStage(null);
      toast.error(result.error);
      return;
    }
    try {
      setStage("Uploading");
      await put(result.source.url, result.source.headers, file, setSent);
      if (poster && result.poster) await put(result.poster.url, result.poster.headers, poster.blob);
      await Promise.all(captions.map((caption, index) => put(result.captions[index].url, result.captions[index].headers, caption.file!)));
    } catch (error) {
      const message = (error as Error).message;
      await markUploadFailed(result.uploadId, message).catch(() => undefined);
      setStage(null);
      onStarted({
        id: result.uploadId,
        status: "FAILED",
        fileName: file.name,
        percent: null,
        error: message,
        createdAt: new Date().toISOString(),
        partId: "partId" in target ? target.partId : null,
        skillKey: "skillKey" in target ? target.skillKey : null,
        titleEn: "titleEn" in target ? target.titleEn : null,
        ownCaptions: captions.length > 0,
      });
      toast.error(`The upload failed: ${message}`);
      return;
    }
    setStage("Starting the encode…");
    const encoding = await startEncoding(result.uploadId).catch(() => null);
    setStage(null);
    if (!encoding?.success) {
      toast.error(encoding?.error ?? "We couldn't reach the server. Try again.");
      return;
    }
    onStarted(encoding.upload);
    if (encoding.upload.status === "FAILED") {
      toast.error("The encode couldn't start. The reason is under the lesson.");
    } else {
      toast.success("Uploaded. Encoding now; you can leave this page and come back.");
      onDone();
    }
  };

  const uploading = stage !== null;
  return (
    <div className="mt-4 grid gap-5 rounded-xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <p className="text-sm font-medium md:col-span-2">{heading}</p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`file-${lessonId}`}>Video file</Label>
          <Input
            id={`file-${lessonId}`}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-m4v,.mp4,.mov,.webm,.mkv,.m4v"
            disabled={uploading}
            onChange={(event) => choose(event.currentTarget.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">MP4, MOV, WebM or MKV, up to 5 GB. It is encoded to a web MP4 (1080p at most).</p>
        </div>
        {preview && (
          <>
            <video
              ref={videoRef}
              src={preview}
              controls
              muted
              playsInline
              className={cn("w-full rounded-lg bg-black", meta && meta.height > meta.width ? "mx-auto max-h-80 w-auto" : "aspect-video")}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                setMeta({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
                // A first poster from a tenth of the way in; pick another frame with the button.
                video.currentTime = Math.min(video.duration * 0.1, 10);
              }}
              onSeeked={() => {
                if (autoPoster.current) return;
                autoPoster.current = true;
                capturePoster();
              }}
            />
            {meta && file && (
              <p className="text-xs text-muted-foreground">
                {meta.width}×{meta.height} · {meta.height > meta.width ? "vertical" : "horizontal"} · {clock(meta.duration)} · {megabytes(file.size)}
              </p>
            )}
          </>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Poster</Label>
          <div className="flex items-center gap-3">
            {poster ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview of the captured frame
              <img src={poster.url} alt="Poster preview" className="h-20 rounded-md bg-black object-contain" />
            ) : (
              <span className="grid h-20 w-20 place-items-center rounded-md bg-muted text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
              </span>
            )}
            <div className="flex flex-col items-start gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!meta || uploading} onClick={capturePoster}>
                Use the frame on screen
              </Button>
              <ImagePicker disabled={uploading} onPick={(picked) => void takePoster(() => imageToJpeg(picked))} />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Captions</Label>
            <Button type="button" variant="ghost" size="sm" onClick={addCaption} disabled={uploading || captions.length >= 6}>
              <Plus className="mr-1 h-4 w-4" />
              Use my own file
            </Button>
          </div>
          {captions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Made for you once it&apos;s encoded: English captions transcribed from the narration, and Spanish subtitles
              translated from them. Learners pick one in the player, or turn them off.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">With your own WebVTT files, no captions are made for this video. Captions transcribe the audio; subtitles translate it.</p>
          )}
          {captions.map((caption) => (
            <div key={caption.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Input type="file" accept=".vtt,text/vtt" disabled={uploading} onChange={(event) => readCaption(caption.id, event.currentTarget.files?.[0] ?? null)} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove this caption file"
                  disabled={uploading}
                  onClick={() => setCaptions((list) => list.filter((entry) => entry.id !== caption.id))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {caption.error && <p className="text-xs text-destructive">{caption.error}</p>}
              <div className="grid grid-cols-[5rem_minmax(0,1fr)_7rem] gap-2">
                <select
                  aria-label="Language"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={caption.srclang}
                  disabled={uploading}
                  onChange={(event) => updateCaption(caption.id, { srclang: event.target.value, label: LANGUAGES[event.target.value] ?? caption.label })}
                >
                  {Object.keys(LANGUAGES).map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <Input aria-label="Label" value={caption.label} disabled={uploading} onChange={(event) => updateCaption(caption.id, { label: event.target.value })} />
                <select
                  aria-label="Kind"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={caption.kind}
                  disabled={uploading}
                  onChange={(event) => updateCaption(caption.id, { kind: event.target.value as CaptionDraft["kind"] })}
                >
                  <option value="captions">captions</option>
                  <option value="subtitles">subtitles</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name={`default-${lessonId}`}
                  checked={caption.default}
                  disabled={uploading}
                  onChange={() => setCaptions((list) => list.map((entry) => ({ ...entry, default: entry.id === caption.id })))}
                />
                Shown by default
              </label>
            </div>
          ))}
        </div>

        {keepsQuizzes && (
          <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs">
            This video has quizzes. The new file replaces the old one and keeps the quizzes at their times; check they
            still fit.
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={upload} disabled={!ready} loading={uploading} loadingLabel={stage === "Uploading" && file ? `Uploading ${Math.round((sent / file.size) * 100)}%` : (stage ?? undefined)}>
            <Check className="mr-1.5 h-4 w-4" />
            Upload and encode
          </Button>
        </div>
        {uploading && file && (
          <VideoProgress
            title={heading}
            subtitle={file.name}
            steps={[
              stage === "Uploading"
                ? { label: "Upload", state: "active", percent: (sent / file.size) * 100, detail: `Uploading ${megabytes(sent)} of ${megabytes(file.size)}` }
                : stage === "Preparing…"
                  ? { label: "Upload", state: "active", percent: null, detail: "Preparing" }
                  : { label: "Upload", state: "done" },
              stage === "Starting the encode…" ? { label: "Encode", state: "active", percent: null, detail: "Starting the encode" } : { label: "Encode", state: "waiting" },
              ...(captions.length ? [] : [{ label: "Captions", state: "waiting" as const }]),
            ]}
          />
        )}
      </div>
    </div>
  );
}
