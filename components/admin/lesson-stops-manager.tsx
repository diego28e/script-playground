"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { deleteLessonStop, generateLessonStops, saveLessonStop, setCourseStops, type StopRecording, type StopsOverview } from "@/actions/lesson-stops";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DotLoader } from "@/components/ui/dot-loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { PlayerStop } from "@/lib/lesson-stops/shared";
import { cn } from "@/lib/utils";

// Admin → Stops (docs/lesson-stops.md): per course, whether its audio and video lessons pause at hands-on steps; per
// recording, writing its stops with a model and reviewing them by hand (time, words, commands).

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const fromClock = (value: string): number | null => {
  const match = value.trim().match(/^(\d+):(\d{1,2})(?:\.(\d))?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number(match[3]) / 10 : 0) : null;
};

export function LessonStopsManager({ data }: { data: StopsOverview }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [model, setModel] = useState(data.models[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [run, setRun] = useState<{ done: number; total: number; written: number } | null>(null);
  const course = data.courses.find((entry) => entry.id === data.courseId);
  const recordings = data.modules.flatMap((courseModule) => courseModule.lessons.flatMap((lesson) => lesson.recordings.map((recording) => ({ lesson, recording }))));
  const missing = recordings.filter(({ recording }) => recording.ready && !recording.stops.length);

  const pickCourse = (id: string) => startRefresh(() => router.push(`/admin/stops?course=${id}`));

  const toggle = async () => {
    if (!course) return;
    setBusy("switch");
    const result = await setCourseStops(course.id, !course.on).catch(() => null);
    setBusy(null);
    if (!result?.success) return toast.error(result?.error ?? "That couldn't be saved.");
    toast.success(course.on ? "Learners' recordings in this course no longer pause." : "Learners' recordings in this course now pause at their stops.");
    startRefresh(() => router.refresh());
  };

  const generate = async (lessonId: string, media: string) => {
    setBusy(`${lessonId}:${media}`);
    const result = await generateLessonStops(lessonId, media, model).catch(() => null);
    setBusy(null);
    if (!result?.success) {
      toast.error(result?.error ?? "The stops couldn't be written.", { duration: 10000 });
      return null;
    }
    toast.success(`${result.written} ${result.written === 1 ? "stop" : "stops"} written by ${result.model}.${result.dropped ? ` ${result.dropped} suggestions dropped (a command not in the lesson, or a sentence that doesn't exist).` : ""}`);
    startRefresh(() => router.refresh());
    return result.written;
  };

  // Every recording without stops, one after another (each is its own request).
  const generateMissing = async () => {
    let written = 0;
    setRun({ done: 0, total: missing.length, written });
    for (const [index, { lesson, recording }] of missing.entries()) {
      const result = await generateLessonStops(lesson.id, recording.media, model).catch(() => null);
      if (result?.success) written += result.written;
      setRun({ done: index + 1, total: missing.length, written });
    }
    setRun(null);
    toast.success(`${written} ${written === 1 ? "stop" : "stops"} written in ${missing.length} ${missing.length === 1 ? "recording" : "recordings"}.`);
    startRefresh(() => router.refresh());
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <select value={data.courseId ?? ""} onChange={(event) => pickCourse(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-base font-semibold" aria-label="Course">
          {data.courses.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
        {refreshing && <DotLoader />}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Model
          <select value={model} onChange={(event) => setModel(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            {data.models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={() => void generateMissing()} disabled={!missing.length || Boolean(run) || Boolean(busy)}>
          <Sparkles className="mr-2 h-4 w-4" />
          {run ? `Writing ${run.done} of ${run.total}…` : missing.length ? `Write stops for ${missing.length} ${missing.length === 1 ? "recording" : "recordings"}` : recordings.length ? "Every recording has stops" : "No recordings to write"}
        </Button>
      </div>

      {course && (
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Pause at hands-on steps</p>
            <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
              When on, this course&apos;s audio and video lessons pause at each stop below and show the step, with its exact commands, until the learner continues.
              Each learner can still turn the pauses off for themselves on the player (when they&apos;re listening away from their computer).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={course.on}
            aria-label="Pause at hands-on steps"
            disabled={busy === "switch"}
            onClick={() => void toggle()}
            className={cn(
              "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              course.on ? "bg-primary" : "bg-muted-foreground/30",
            )}
          >
            <span className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", course.on ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
          </button>
        </div>
      )}

      {data.modules.length === 0 && <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">This course has no voiced audio or videos yet.</p>}

      {data.modules.map((courseModule) => (
        <section key={courseModule.id} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">{courseModule.title}</h3>
          {courseModule.lessons.map((lesson) => (
            <div key={lesson.id} className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-medium">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{lesson.code}</span>
                {lesson.title.replaceAll("`", "")}
              </p>
              <div className="mt-2 space-y-2">
                {lesson.recordings.map((recording) => (
                  <Recording
                    key={recording.media}
                    lessonId={lesson.id}
                    recording={recording}
                    generating={busy === `${lesson.id}:${recording.media}`}
                    disabled={Boolean(busy) || Boolean(run)}
                    onGenerate={() => void generate(lesson.id, recording.media)}
                    onChanged={() => startRefresh(() => router.refresh())}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function Recording({
  lessonId,
  recording,
  generating,
  disabled,
  onGenerate,
  onChanged,
}: {
  lessonId: string;
  recording: StopRecording;
  generating: boolean;
  disabled: boolean;
  onGenerate: () => void;
  onChanged: () => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const regenerate = async () => {
    if (recording.stops.length) {
      const ok = await confirm({
        title: "Write this recording's stops again?",
        detail: `${recording.stops.length} stops replaced`,
        description: "The model reads the transcript again and its stops replace these, your edits included.",
        confirmLabel: "Write again",
        tone: "danger",
      });
      if (!ok) return;
    }
    onGenerate();
    setOpen(true);
  };

  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left text-sm" aria-expanded={open}>
          <span className="font-medium">{recording.label}</span>
          <span className="ml-2 text-muted-foreground">
            {recording.seconds ? clock(recording.seconds) : ""} · {recording.stops.length} {recording.stops.length === 1 ? "stop" : "stops"}
            {recording.author ? ` · by ${recording.author}` : ""}
          </span>
        </button>
        {recording.ready ? (
          <Button size="sm" variant="outline" onClick={() => void regenerate()} disabled={disabled} loading={generating} loadingLabel="Writing">
            <Sparkles className="mr-1.5 h-4 w-4" /> {recording.stops.length ? "Write again" : "Write stops"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{recording.why}</span>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          {recording.stops.map((stop) => (
            <StopEditor key={stop.id} lessonId={lessonId} media={recording.media} stop={stop} onChanged={onChanged} />
          ))}
          {adding ? (
            <StopEditor lessonId={lessonId} media={recording.media} stop={null} onChanged={() => (setAdding(false), onChanged())} onCancel={() => setAdding(false)} />
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Add a stop
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StopEditor({ lessonId, media, stop, onChanged, onCancel }: { lessonId: string; media: string; stop: PlayerStop | null; onChanged: () => void; onCancel?: () => void }) {
  const { confirm, dialog } = useConfirm();
  const [at, setAt] = useState(stop ? clock(stop.at) : "0:00");
  const [draft, setDraft] = useState({
    titleEn: stop?.titleEn ?? "",
    titleEs: stop?.titleEs ?? "",
    stepEn: stop?.stepEn ?? "",
    stepEs: stop?.stepEs ?? "",
    commands: (stop?.commands ?? []).join("\n"),
  });
  const [saving, setSaving] = useState(false);
  const dirty = !stop || at !== clock(stop.at) || draft.titleEn !== stop.titleEn || draft.titleEs !== stop.titleEs || draft.stepEn !== stop.stepEn || draft.stepEs !== stop.stepEs || draft.commands !== stop.commands.join("\n");

  const save = async () => {
    const seconds = fromClock(at);
    if (seconds === null) return toast.error("Write the time as minutes:seconds, like 3:25.");
    setSaving(true);
    const result = await saveLessonStop({
      id: stop?.id,
      lessonId,
      media,
      stop: { at: seconds, titleEn: draft.titleEn, titleEs: draft.titleEs, stepEn: draft.stepEn, stepEs: draft.stepEs, commands: draft.commands.split("\n").map((line) => line.trim()).filter(Boolean) },
    }).catch(() => null);
    setSaving(false);
    if (!result?.success) return toast.error(result?.error ?? "The stop couldn't be saved.");
    toast.success(stop ? "Stop saved." : "Stop added.");
    onChanged();
  };

  const remove = async () => {
    if (!stop) return onCancel?.();
    const ok = await confirm({ title: "Delete this stop?", detail: stop.titleEn, description: "The recording won't pause here any more.", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    const result = await deleteLessonStop(stop.id).catch(() => null);
    if (!result?.success) return toast.error("The stop couldn't be deleted.");
    onChanged();
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Pause at
          <Input value={at} onChange={(event) => setAt(event.target.value)} className="h-8 w-20 font-mono" aria-label="Pause at (minutes:seconds)" />
        </label>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label={stop ? "Delete this stop" : "Cancel"}>
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving} loading={saving} loadingLabel="Saving">
          {stop ? "Save" : "Add"}
        </Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <p className="hidden text-xs font-medium text-muted-foreground md:block">English</p>
        <p className="hidden text-xs font-medium text-muted-foreground md:block">Español</p>
        <Input value={draft.titleEn} onChange={(event) => setDraft({ ...draft, titleEn: event.target.value })} placeholder="Title (English)" aria-label="Title in English" />
        <Input value={draft.titleEs} onChange={(event) => setDraft({ ...draft, titleEs: event.target.value })} placeholder="Título (español)" aria-label="Title in Spanish" />
        <Textarea value={draft.stepEn} onChange={(event) => setDraft({ ...draft, stepEn: event.target.value })} rows={4} placeholder="What to do (English)" aria-label="Step in English" />
        <Textarea value={draft.stepEs} onChange={(event) => setDraft({ ...draft, stepEs: event.target.value })} rows={4} placeholder="Qué hacer (español)" aria-label="Step in Spanish" />
      </div>
      <Textarea
        value={draft.commands}
        onChange={(event) => setDraft({ ...draft, commands: event.target.value })}
        rows={Math.max(1, draft.commands.split("\n").length)}
        placeholder="Exact commands, one per line (optional)"
        aria-label="Commands, one per line"
        className="font-mono text-xs"
      />
    </div>
  );
}
