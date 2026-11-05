"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Captions, Check, Film, ImageIcon, Plus, Trash2, Upload, X } from "lucide-react";
import {
  markUploadFailed,
  refreshUpload,
  removeLessonVideo,
  startEncoding,
  startVideoUpload,
  type UploadSummary,
  type VideoLessonList,
} from "@/actions/videos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

type Lesson = VideoLessonList["courses"][number]["modules"][number]["lessons"][number];

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
              const withVideo = courseModule.lessons.filter((lesson) => lesson.video).length;
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

function VideoBadge({ video }: { video: Lesson["video"] }) {
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

function UploadStatus({ upload }: { upload: UploadSummary }) {
  if (upload.status === "READY") return null;
  if (upload.status === "FAILED") {
    return <p className="text-xs text-destructive">Last upload failed: {upload.error ?? "unknown error"}</p>;
  }
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <DotLoader size={12} />
      {upload.status === "UPLOADING" ? "Waiting for the upload to finish" : `Encoding ${upload.percent ?? 0}%`} · {upload.fileName}
    </p>
  );
}

function LessonRow({ lesson, configured }: { lesson: Lesson; configured: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [upload, setUpload] = useState<UploadSummary | null>(lesson.upload);
  const [removing, startRemoving] = useTransition();

  // An encode started earlier (or in another tab) is followed here until it finishes.
  useEffect(() => {
    if (upload?.status !== "ENCODING") return;
    const timer = setTimeout(async () => {
      const result = await refreshUpload(upload.id).catch(() => null);
      if (!result?.success) return setUpload({ ...upload });
      setUpload(result.upload);
      if (result.upload.status === "READY") {
        toast.success(`Video ready on “${lesson.title.replaceAll("`", "")}”.`);
        setOpen(false);
        router.refresh();
      } else if (result.upload.status === "FAILED") {
        toast.error("The encode failed. The reason is under the lesson.");
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [upload, lesson.title, router]);

  const remove = () => {
    if (!window.confirm("Take the video off this lesson? The files stay in S3.")) return;
    startRemoving(async () => {
      const result = await removeLessonVideo(lesson.id).catch(() => null);
      if (!result?.success) {
        toast.error(result?.error ?? "We couldn't reach the server. Try again.");
        return;
      }
      toast.success("Video removed from the lesson.");
      router.refresh();
    });
  };

  const busy = upload?.status === "UPLOADING" || upload?.status === "ENCODING";
  return (
    <li className="px-4 py-3">
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 md:grid-cols-[3rem_minmax(0,1fr)_auto]">
        {lesson.video && lesson.video.kind !== "invalid" && lesson.video.poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed CloudFront URL, not an optimisable asset
          <img src={lesson.video.poster} alt="" className="h-12 w-12 shrink-0 rounded-md bg-black object-cover" />
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
          <VideoBadge video={lesson.video} />
          {upload && <UploadStatus upload={upload} />}
        </div>
        <div className="col-start-2 flex flex-wrap gap-2 md:col-start-3 md:justify-end">
          {lesson.video && (
            <Button variant="ghost" size="sm" onClick={remove} loading={removing} loadingLabel="Removing…" disabled={busy}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Remove
            </Button>
          )}
          <Button variant={open ? "secondary" : "outline"} size="sm" onClick={() => setOpen(!open)} disabled={!configured || busy}>
            {open ? <X className="mr-1.5 h-4 w-4" /> : <Upload className="mr-1.5 h-4 w-4" />}
            {open ? "Close" : lesson.video ? "Replace video" : "Upload video"}
          </Button>
        </div>
      </div>
      {open && (
        <Uploader
          lesson={lesson}
          onStarted={(summary) => setUpload(summary)}
          onDone={() => setOpen(false)}
        />
      )}
    </li>
  );
}

type CaptionDraft = { id: number; file: File | null; srclang: string; label: string; kind: "captions" | "subtitles"; default: boolean; error: string | null };

/** PUTs a file to a presigned URL, reporting progress. fetch can't report upload progress; XHR can. */
function put(url: string, headers: Record<string, string>, body: Blob, onProgress?: (sent: number) => void): Promise<void> {
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

function Uploader({ lesson, onStarted, onDone }: { lesson: Lesson; onStarted: (upload: UploadSummary) => void; onDone: () => void }) {
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

  /** Draws the frame on screen into a JPEG, at most 1280 px on its long side. */
  const capturePoster = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && setPoster({ blob, url: URL.createObjectURL(blob) }), "image/jpeg", 0.85);
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
    const result = await startVideoUpload(lesson.id, {
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
      onStarted({ id: result.uploadId, status: "FAILED", fileName: file.name, percent: null, error: message, createdAt: new Date().toISOString() });
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
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`file-${lesson.id}`}>Video file</Label>
          <Input
            id={`file-${lesson.id}`}
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
            <Button type="button" variant="outline" size="sm" disabled={!meta || uploading} onClick={capturePoster}>
              Use the frame on screen
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Captions (WebVTT)</Label>
            <Button type="button" variant="ghost" size="sm" onClick={addCaption} disabled={uploading || captions.length >= 6}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
          {captions.length === 0 && <p className="text-xs text-muted-foreground">Optional. Captions transcribe the audio; subtitles translate it.</p>}
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
                  name={`default-${lesson.id}`}
                  checked={caption.default}
                  disabled={uploading}
                  onChange={() => setCaptions((list) => list.map((entry) => ({ ...entry, default: entry.id === caption.id })))}
                />
                Shown by default
              </label>
            </div>
          ))}
        </div>

        {lesson.video?.kind === "interactive" && (
          <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs">
            This lesson&apos;s video has quizzes. The new video replaces the old one and keeps the quizzes at their times; check
            they still fit.
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={upload} disabled={!ready} loading={uploading} loadingLabel={stage === "Uploading" && file ? `Uploading ${Math.round((sent / file.size) * 100)}%` : (stage ?? undefined)}>
            <Check className="mr-1.5 h-4 w-4" />
            Upload and encode
          </Button>
          {stage === "Uploading" && file && (
            <span className="text-xs text-muted-foreground">
              {megabytes(sent)} of {megabytes(file.size)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
