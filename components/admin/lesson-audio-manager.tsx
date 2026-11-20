"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CircleStop, Headphones, Mic, PenLine, RefreshCw, Repeat, Sparkles, Volume2 } from "lucide-react";
import {
  approveCourseScripts,
  approveLessonScript,
  getAudioForAdmin,
  getAudioOverview,
  getAudioScript,
  previewVoice,
  removeLessonAudio,
  revoiceCourse,
  requestCourseScripts,
  requestLessonScript,
  retryFailedAudio,
  retryLessonAudio,
  saveLessonScript,
  stopCourseAudio,
  type AudioLessonRow,
  type AudioOverview,
  type getAudioOptions,
} from "@/actions/lesson-audio";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DotLoader } from "@/components/ui/dot-loader";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { LessonAudio, type LessonAudioTrack } from "@/components/courses/lesson-audio";
import { cn } from "@/lib/utils";

// Admin → Audio (docs/lesson-audio.md): a course's lessons with their audio. One lesson at a time (write its script,
// read it, approve it) or the whole course (every missing script, voiced at once or after review). The practice worker
// does the work; the page polls while anything is queued or in progress.

type Options = NonNullable<Awaited<ReturnType<typeof getAudioOptions>>>;

const POLL_MS = 4_000;
// v2: ElevenLabs became the default voice, so a Deepgram voice remembered from before doesn't stick.
const CHOICES_KEY = "adc.lessonAudio.admin.v2";
/** Script characters per lesson text character: what scripts came to in the first runs (a guide for estimates). */
const SCRIPT_PER_SOURCE = 0.9;
/** Speaking rates by provider (lib/lesson-audio/voice.ts CHARS_PER_SECOND). */
const RATE = { deepgram: 14, elevenlabs: 16.5 } as const;
const PROVIDER_LABEL = { elevenlabs: "ElevenLabs Eleven v4", deepgram: "Deepgram Aura-2" } as const;

/** The voice choices, grouped by provider, the expressive one first. */
function VoiceOptions({ voices, prices }: { voices: Options["voices"]; prices: Options["prices"] }) {
  return (
    <>
      {(["elevenlabs", "deepgram"] as const).map((provider) => {
        const group = voices.filter((voice) => voice.provider === provider);
        if (!group.length) return null;
        return (
          <optgroup key={provider} label={`${PROVIDER_LABEL[provider]} · US$${prices[provider].toFixed(2)} per 1,000 characters`}>
            {group.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
                {voice.note ? ` · ${voice.note}` : ""}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";
const count = (value: number) => value.toLocaleString("en-US");
const dollars = (amount: number) => (amount < 0.1 ? "under US$0.10" : `about US$${amount.toFixed(amount < 10 ? 2 : 0)}`);
const minutes = (seconds: number) => (seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} min` : `${(seconds / 3600).toFixed(1)} h`);

type Choices = { courseId: string; model: string; voices: Record<string, string>; autoVoice: boolean; delivery: boolean };

function readChoices(): Partial<Choices> {
  try {
    return JSON.parse(window.localStorage.getItem(CHOICES_KEY) ?? "{}") as Partial<Choices>;
  } catch {
    return {};
  }
}

const STATUS: Record<string, { label: string; tone: "muted" | "busy" | "review" | "done" | "failed" }> = {
  SCRIPT_QUEUED: { label: "Script queued", tone: "busy" },
  WRITING: { label: "Writing", tone: "busy" },
  REVIEW: { label: "Ready for review", tone: "review" },
  VOICE_QUEUED: { label: "Voice queued", tone: "busy" },
  VOICING: { label: "Voicing", tone: "busy" },
  DONE: { label: "Live", tone: "done" },
  FAILED: { label: "Failed", tone: "failed" },
};
const TONE = {
  muted: "border-border text-muted-foreground",
  busy: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  review: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function LessonAudioManager({ options }: { options: Options }) {
  const { confirm, dialog } = useConfirm();
  const [choices, setChoices] = useState<Choices>({
    courseId: options.courses[0].id,
    model: options.defaults.model,
    voices: options.defaults.voices,
    autoVoice: false,
    delivery: true,
  });
  const [overview, setOverview] = useState<AudioOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ voice: string; src: string } | null>(null);
  const previewRef = useRef<HTMLAudioElement>(null);

  // The admin's last choices, read after mounting (the server has no storage), then kept.
  useEffect(() => {
    const read = setTimeout(() => {
      const stored = readChoices();
      setChoices((current) => ({
        courseId: options.courses.some((course) => course.id === stored.courseId) ? stored.courseId! : current.courseId,
        model: options.models.some((model) => model.id === stored.model) ? stored.model! : current.model,
        voices: { ...current.voices, ...Object.fromEntries(Object.entries(stored.voices ?? {}).filter(([, voice]) => options.voices.some((entry) => entry.id === voice))) },
        autoVoice: Boolean(stored.autoVoice),
        delivery: stored.delivery !== false,
      }));
    }, 0);
    return () => clearTimeout(read);
  }, [options]);
  const choose = (patch: Partial<Choices>) =>
    setChoices((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
      } catch {
        // Storage refused: the choice holds for this visit.
      }
      return next;
    });

  const course = options.courses.find((entry) => entry.id === choices.courseId) ?? options.courses[0];
  const language = course.language === "es" ? "es" : "en";
  const voices = options.voices.filter((voice) => voice.language === "any" || voice.language === language);
  const voice = voices.some((entry) => entry.id === choices.voices[language]) ? choices.voices[language] : voices[0]?.id;
  const voiceInfo = (id: string | null | undefined) => options.voices.find((entry) => entry.id === id);
  const expressive = voiceInfo(voice)?.provider === "elevenlabs";
  // The delivery only applies to the expressive voice.
  const delivery = expressive && choices.delivery;

  const refresh = useCallback(async () => {
    const next = await getAudioOverview(course.id).catch(() => undefined);
    if (next !== undefined) setOverview(next);
  }, [course.id]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(first);
  }, [refresh]);
  const active = Boolean(overview && overview.course.id === course.id && overview.counts.queued + overview.counts.working > 0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  /** Runs an action, says how it went, and reads the page again. */
  const run = async (key: string, work: () => Promise<{ success: true } | { success: false; error: string }>, done?: string) => {
    setBusy(key);
    try {
      const result = await work();
      if (!result.success) toast.error(result.error);
      else if (done) toast.success(done);
      await refresh();
      return result.success;
    } catch {
      toast.error("We couldn't reach the server. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const hearVoice = async () => {
    if (!voice) return;
    if (preview?.voice === voice) {
      void previewRef.current?.play();
      return;
    }
    setBusy("preview");
    try {
      const result = await previewVoice(voice, language);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setPreview({ voice, src: result.src });
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (preview) void previewRef.current?.play().catch(() => undefined);
  }, [preview]);

  const view = overview?.course.id === course.id ? overview : null;
  const rows = useMemo(() => view?.modules.flatMap((courseModule) => courseModule.lessons) ?? [], [view]);
  const missing = rows.filter((row) => !row.audio || (!row.audio.scriptWords && !["SCRIPT_QUEUED", "WRITING"].includes(row.audio.status)));
  const missingChars = missing.reduce((sum, row) => sum + (row.sourceChars ?? 0) * SCRIPT_PER_SOURCE, 0);
  const missingUnknown = missing.filter((row) => row.sourceChars === null).length;
  const voiceCostFor = (chars: number, id = voice) => (chars / 1000) * options.prices[voiceInfo(id)?.provider ?? "deepgram"];
  // Lessons whose audio another voice read: what "record again" would do, and cost (the script, plus about 5% for the delivery).
  const otherVoice = view?.totals.voiced.filter((entry) => entry.voice !== voice) ?? [];
  const otherVoiceChars = otherVoice.reduce((sum, entry) => sum + entry.chars, 0) * (delivery ? 1.05 : 1);

  const writeAll = async () => {
    if (!view || !missing.length || !voice) return;
    const estimate = `${missing.length} ${missing.length === 1 ? "lesson" : "lessons"}${missingUnknown ? ` (${missingUnknown} of them notebooks, read from the repository)` : ""}`;
    const ok = await confirm({
      title: choices.autoVoice ? "Write and voice every missing lesson?" : "Write every missing script?",
      description: choices.autoVoice
        ? `Each script goes straight to the voice, without your review, and learners hear it as soon as it's ready. Voicing will cost ${dollars(voiceCostFor(missingChars))}${missingUnknown ? " plus the notebooks" : ""} with ${voiceInfo(voice)?.label}, and the scripts a few cents each.`
        : "The scripts wait for your review; nothing is voiced until you approve. Writing costs a few cents a lesson.",
      detail: estimate,
      confirmLabel: choices.autoVoice ? "Write and voice" : "Write scripts",
      icon: choices.autoVoice ? Mic : PenLine,
    });
    if (!ok) return;
    await run("all", () => requestCourseScripts(course.id, choices.model, voice, choices.autoVoice, delivery), "Queued. The worker writes them in course order.");
  };

  const approveAll = async () => {
    if (!view || !voice) return;
    const ok = await confirm({
      title: `Voice the ${view.counts.review} ${view.counts.review === 1 ? "script" : "scripts"} waiting for review?`,
      description: `They're approved as they are, read by ${options.voices.find((entry) => entry.id === voice)?.label}, and learners hear each one as soon as it's ready. About ${minutes(view.totals.reviewSeconds)} of audio for ${dollars(view.totals.reviewCost)}.`,
      confirmLabel: "Approve and voice",
      icon: Mic,
    });
    if (!ok) return;
    await run("approve-all", () => approveCourseScripts(course.id, voice, delivery), "Queued for voicing.");
  };

  const retryAll = async () => {
    if (!view?.counts.failed) return;
    const failed = rows.filter((row) => row.audio?.status === "FAILED");
    const toVoice = failed.filter((row) => row.audio?.scriptWords);
    const chars = toVoice.reduce((sum, row) => sum + (row.audio?.scriptChars ?? 0), 0) * (delivery ? 1.05 : 1);
    const ok = await confirm({
      title: `Retry the ${failed.length} failed ${failed.length === 1 ? "lesson" : "lessons"}?`,
      description: `Each goes back to the step that failed${toVoice.length ? `: ${toVoice.length} to voice, about ${dollars(toVoice.reduce((sum, row) => sum + voiceCostFor((row.audio?.scriptChars ?? 0) * (delivery ? 1.05 : 1), row.audio!.voice), 0))}` : ""}. If they failed on the voice's credit limit, raise it first, or they'll fail again.`,
      detail: chars ? `${count(Math.round(chars))} characters` : undefined,
      confirmLabel: "Retry them",
      icon: RefreshCw,
    });
    if (!ok) return;
    await run("retry-all", () => retryFailedAudio(course.id), "Queued again.");
  };

  const recordAgain = async () => {
    if (!view || !voice || !otherVoice.length) return;
    const ok = await confirm({
      title: `Record ${otherVoice.length} ${otherVoice.length === 1 ? "lesson" : "lessons"} again with ${voiceInfo(voice)?.label}?`,
      description: `Every lesson read by another voice is voiced again from its script${delivery ? ", with a teacher's delivery added" : ""}. Learners keep hearing the current audio until each new one is ready. It costs ${dollars(voiceCostFor(otherVoiceChars))}.`,
      confirmLabel: "Record again",
      icon: Repeat,
    });
    if (!ok) return;
    await run("revoice", () => revoiceCourse(course.id, voice, delivery, false), "Queued. Each lesson is replaced as soon as its new audio is ready.");
  };

  const stop = async () => {
    const ok = await confirm({
      title: "Stop the queue?",
      description: "Lessons that haven't started go back to where they were; the ones in progress finish. You can queue them again any time.",
      confirmLabel: "Stop",
      icon: CircleStop,
    });
    if (!ok) return;
    await run("stop", () => stopCourseAudio(course.id), "Stopped.");
  };

  const writeOne = async (row: AudioLessonRow) => {
    if (!voice) return;
    if (row.audio?.hasAudio) {
      const ok = await confirm({
        title: "Write this script again?",
        description: "Learners keep hearing the current audio until a new one is approved and voiced.",
        confirmLabel: "Write again",
        icon: PenLine,
      });
      if (!ok) return;
    }
    await run(row.lessonId, () => requestLessonScript(course.id, row.lessonId, choices.model, voice, delivery), "Queued first. It's ready for review in a few minutes.");
  };

  return (
    <div className="space-y-5">
      {dialog}
      {preview && <audio ref={previewRef} src={preview.src} className="hidden" />}

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Course
          <select className={cn(SELECT, "font-semibold")} value={course.id} onChange={(event) => choose({ courseId: event.target.value })}>
            {options.courses.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
                {entry.visibility === "PRIVATE" ? " (private)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Script written by
          <select className={SELECT} value={choices.model} onChange={(event) => choose({ model: event.target.value })}>
            {options.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} · {model.price}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          <label htmlFor="audio-voice">Voice</label>
          <div className="flex gap-2">
            <select id="audio-voice" className={cn(SELECT, "max-w-[22rem]")} value={voice} onChange={(event) => choose({ voices: { ...choices.voices, [language]: event.target.value } })}>
              <VoiceOptions voices={voices} prices={options.prices} />
            </select>
            <Button type="button" variant="outline" size="sm" onClick={() => void hearVoice()} loading={busy === "preview"} loadingLabel="Making a sample…">
              <Volume2 className="mr-1.5 size-4" aria-hidden="true" />
              Hear it
            </Button>
          </div>
        </div>
        {expressive && (
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={choices.delivery} onChange={(event) => choose({ delivery: event.target.checked })} className="size-4 accent-[var(--signal-strong)]" />
            <Tip content="Before voicing, the script model marks tone and pauses with Eleven v4's audio tags ([warmly], [short pause], [slower, deliberate]) and never changes a word. You review the plain script; the tagged version is kept to read after.">
              <span>Teacher&apos;s delivery: tone and pauses</span>
            </Tip>
          </label>
        )}
      </div>

      {expressive && !options.elevenConfigured && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ELEVENLABS_API_KEY isn&apos;t set on the platform, so &ldquo;Hear it&rdquo; can&apos;t play an ElevenLabs voice here. The worker voices lessons with its own key.
        </p>
      )}

      {!view ? (
        <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <DotLoader /> Reading the course…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="tabular-nums">{view.counts.lessons}</span> lessons · <span className="tabular-nums text-foreground">{view.counts.done}</span> with audio
              {view.totals.seconds > 0 ? ` (${minutes(view.totals.seconds)})` : ""} · <span className="tabular-nums">{view.counts.review}</span> to review ·{" "}
              <span className="tabular-nums">{view.counts.queued + view.counts.working}</span> in the queue
              {view.counts.failed ? (
                <>
                  {" "}
                  · <span className="tabular-nums text-destructive">{view.counts.failed}</span> failed
                </>
              ) : null}
            </p>
            <span className="flex-1" />
            {active && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void stop()} loading={busy === "stop"} loadingLabel="Stopping…">
                <CircleStop className="mr-1.5 size-4" aria-hidden="true" />
                Stop the queue
              </Button>
            )}
            {view.counts.failed > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => void retryAll()} loading={busy === "retry-all"} loadingLabel="Queueing…" disabled={Boolean(busy) && busy !== "retry-all"}>
                <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
                Retry the {view.counts.failed} failed
              </Button>
            )}
            {otherVoice.length > 0 && (
              <Tip content={`Lessons read by another voice than ${voiceInfo(voice)?.label}, voiced again from their scripts: ${dollars(voiceCostFor(otherVoiceChars))}.`}>
                <Button type="button" variant="outline" size="sm" onClick={() => void recordAgain()} loading={busy === "revoice"} loadingLabel="Queueing…" disabled={Boolean(busy) && busy !== "revoice"}>
                  <Repeat className="mr-1.5 size-4" aria-hidden="true" />
                  Record {otherVoice.length} again with {voiceInfo(voice)?.label}
                </Button>
              </Tip>
            )}
            {view.counts.review > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => void approveAll()} loading={busy === "approve-all"} loadingLabel="Queueing…" disabled={Boolean(busy) && busy !== "approve-all"}>
                <Mic className="mr-1.5 size-4" aria-hidden="true" />
                Approve and voice all {view.counts.review}
              </Button>
            )}
          </div>

          {view.workerQuiet && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Nothing has moved for a few minutes. Check the practice worker on the lab server is running:
              <code className="rounded bg-background/60 px-1">docker logs practice-worker</code>. The queue waits; nothing is lost.
            </p>
          )}

          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-dashed border-border px-4 py-3">
              <Button type="button" onClick={() => void writeAll()} loading={busy === "all"} loadingLabel="Queueing…" disabled={Boolean(busy) && busy !== "all"}>
                <Sparkles className="mr-1.5 size-4" aria-hidden="true" />
                Write the {missing.length} missing {missing.length === 1 ? "script" : "scripts"}
              </Button>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={choices.autoVoice} onChange={(event) => choose({ autoVoice: event.target.checked })} className="size-4 accent-[var(--signal-strong)]" />
                Voice them too, without review
              </label>
              <span className="text-xs text-muted-foreground">
                {choices.autoVoice
                  ? `Voicing ${dollars(voiceCostFor(missingChars))}${missingUnknown ? " plus the notebooks" : ""}, about ${minutes(missingChars / RATE[voiceInfo(voice)?.provider ?? "deepgram"])} of audio.`
                  : "Test one lesson first: write its script below, read it, then decide."}
              </span>
            </div>
          )}

          <div className="space-y-6">
            {view.modules.filter((courseModule) => courseModule.lessons.length > 0).map((courseModule) => (
              <section key={courseModule.id}>
                <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Module {String(courseModule.position).padStart(2, "0")} · {courseModule.title}
                </h3>
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                  {courseModule.lessons.map((row) => (
                    <LessonRow
                      key={row.lessonId}
                      row={row}
                      voiceLabel={voiceInfo(row.audio?.audioVoice)?.label ?? null}
                      busy={busy}
                      onWrite={() => void writeOne(row)}
                      onReview={() => setReviewing(row.audio!.id)}
                      onRetry={() => void run(row.lessonId, () => retryLessonAudio(row.audio!.id), "Queued again.")}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {reviewing && voice && (
        <ReviewDialog
          audioId={reviewing}
          courseId={course.id}
          voice={voice}
          voices={voices}
          prices={options.prices}
          delivery={choices.delivery}
          modelLabels={Object.fromEntries(options.models.map((model) => [model.id, model.label]))}
          row={rows.find((row) => row.audio?.id === reviewing) ?? null}
          onClose={() => setReviewing(null)}
          onChanged={refresh}
          onWriteAgain={(row) => {
            setReviewing(null);
            void writeOne(row);
          }}
        />
      )}
    </div>
  );
}

function LessonRow({
  row,
  voiceLabel,
  busy,
  onWrite,
  onReview,
  onRetry,
}: {
  row: AudioLessonRow;
  /** Who read the lesson's current audio. */
  voiceLabel: string | null;
  busy: string | null;
  onWrite: () => void;
  onReview: () => void;
  onRetry: () => void;
}) {
  const audio = row.audio;
  const status = audio ? STATUS[audio.status] : null;
  const working = audio && ["SCRIPT_QUEUED", "WRITING", "VOICE_QUEUED", "VOICING"].includes(audio.status);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{row.code}</span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate font-medium">{row.title}</p>
        <p className={cn("truncate text-xs", audio?.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>
          {audio?.status === "FAILED"
            ? audio.error
            : working
              ? (audio.progress ?? (audio.status.endsWith("QUEUED") ? "Waiting for the worker" : "Starting"))
              : audio?.hasAudio
                ? `${minutes(audio.audioSeconds ?? 0)} of audio${voiceLabel ? `, ${voiceLabel}` : ""}${audio.status === "REVIEW" ? " · a new script waits for review" : ""}`
                : audio?.scriptWords
                  ? `${audio.scriptWords.toLocaleString()} words, about ${minutes((audio.scriptChars ?? 0) / RATE.deepgram)}`
                  : row.sourceChars === null
                    ? "Notebook: read from the repository"
                    : `${Math.round(row.sourceChars / 1000)}k characters of lesson text`}
        </p>
      </div>
      {status && (
        <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", TONE[status.tone])}>
          {working && <DotLoader />}
          {audio?.hasAudio && audio.status !== "DONE" && !working ? "Live · " : ""}
          {status.label}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {audio && audio.scriptWords && !working && (
          <Button type="button" variant={audio.status === "REVIEW" ? "default" : "outline"} size="sm" onClick={onReview}>
            {audio.hasAudio && audio.status === "DONE" ? <Headphones className="mr-1.5 size-4" aria-hidden="true" /> : <PenLine className="mr-1.5 size-4" aria-hidden="true" />}
            {audio.status === "REVIEW" ? "Review" : audio.hasAudio ? "Listen" : "Open"}
          </Button>
        )}
        {audio?.status === "FAILED" && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} loading={busy === row.lessonId} loadingLabel="Queueing…">
            <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
            Retry
          </Button>
        )}
        {!working && !audio?.scriptWords && audio?.status !== "FAILED" && (
          <Button type="button" variant="outline" size="sm" onClick={onWrite} loading={busy === row.lessonId} loadingLabel="Queueing…">
            <Sparkles className="mr-1.5 size-4" aria-hidden="true" />
            Write script
          </Button>
        )}
      </div>
    </li>
  );
}

function ReviewDialog({
  audioId,
  courseId,
  voice: initialVoice,
  voices,
  prices,
  delivery: initialDelivery,
  modelLabels,
  row,
  onClose,
  onChanged,
  onWriteAgain,
}: {
  audioId: string;
  courseId: string;
  voice: string;
  voices: Options["voices"];
  prices: Options["prices"];
  delivery: boolean;
  /** Model ids to labels; a script written by a fallback lists them all ("a, b"). */
  modelLabels: Record<string, string>;
  row: AudioLessonRow | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onWriteAgain: (row: AudioLessonRow) => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [script, setScript] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [meta, setMeta] = useState<{ title: string; model: string | null; status: string } | null>(null);
  const [voice, setVoice] = useState(initialVoice);
  const [delivery, setDelivery] = useState(initialDelivery);
  // What the voice read last time, with its delivery, when it had one.
  const [directed, setDirected] = useState<string | null>(null);
  const [showDirected, setShowDirected] = useState(false);
  const [track, setTrack] = useState<LessonAudioTrack | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAudioScript(audioId).then((result) => {
      if (cancelled || !result) return;
      setScript(result.script ?? "");
      setOriginal(result.script ?? "");
      setMeta({ title: `${result.lesson.code ? `${result.lesson.code} · ` : ""}${result.lesson.title}`, model: result.scriptModel, status: result.status });
      setDirected(result.audioDirected);
    });
    if (row?.audio?.hasAudio) {
      void getAudioForAdmin(audioId).then((result) => {
        if (!cancelled && result.success) setTrack({ src: result.url, seconds: result.seconds, transcript: null, key: audioId });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [audioId, row?.audio?.hasAudio]);

  const chars = script?.length ?? 0;
  const expressive = voices.find((entry) => entry.id === voice)?.provider === "elevenlabs";
  const per1000 = prices[expressive ? "elevenlabs" : "deepgram"];
  const words = script ? script.split(/\s+/).filter(Boolean).length : 0;
  const edited = script !== null && script !== original;

  const act = async (key: string, work: () => Promise<{ success: true } | { success: false; error: string }>, done: string, close = false) => {
    setBusy(key);
    try {
      const result = await work();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      await onChanged();
      if (close) onClose();
      else setOriginal(script ?? "");
    } catch {
      toast.error("We couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!script?.trim()) return;
    const ok = await confirm({
      title: row?.audio?.hasAudio ? "Voice this script and replace the audio?" : "Approve and voice this script?",
      description: `${voices.find((entry) => entry.id === voice)?.label} reads it: about ${minutes(chars / RATE[expressive ? "elevenlabs" : "deepgram"])} of audio, ${dollars((chars / 1000) * per1000 * (expressive && delivery ? 1.05 : 1))}${expressive && delivery ? ", with a teacher's delivery added" : ""}. Learners hear it as soon as it's ready${row?.audio?.hasAudio ? "; until then they hear the current one" : ""}.`,
      confirmLabel: "Approve and voice",
      icon: Mic,
    });
    if (!ok) return;
    await act("approve", () => approveLessonScript(courseId, audioId, script, voice, expressive && delivery), "Approved. It's voiced next, usually in a few minutes.", true);
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Take the audio off this lesson?",
      description: "Learners stop hearing it at once. The script stays, so you can voice it again later.",
      confirmLabel: "Take it off",
      tone: "danger",
    });
    if (!ok) return;
    await act("remove", () => removeLessonAudio(courseId, audioId), "The audio is off the lesson.", true);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-4">
        {dialog}
        <DialogHeader>
          <DialogTitle>{meta?.title ?? "Script"}</DialogTitle>
          <DialogDescription>
            {meta?.model ? `Written by ${meta.model.split(", ").map((model) => modelLabels[model] ?? model).join(" and ")}. ` : ""}
            Read it as a learner would hear it. Fix anything wrong or unclear; your edits are what gets voiced.
          </DialogDescription>
        </DialogHeader>
        {track && <LessonAudio track={track} lessonId={`admin:${audioId}`} lessonTitle={meta?.title ?? ""} language="en" />}
        {script === null ? (
          <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <DotLoader /> Reading the script…
          </div>
        ) : showDirected && directed ? (
          <div className="min-h-[45vh] flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-input bg-muted/40 px-3 py-2 text-[15px] leading-relaxed">
            {directed.split(/(\[[^\]\n]{1,80}\])/).map((piece, index) =>
              /^\[[^\]]+\]$/.test(piece) ? (
                <span key={index} className="rounded bg-amber-500/15 px-1 font-mono text-[12px] text-amber-800 dark:text-amber-200">
                  {piece}
                </span>
              ) : (
                piece
              ),
            )}
          </div>
        ) : (
          <Textarea
            value={script}
            onChange={(event) => setScript(event.target.value)}
            aria-label="Script"
            className="min-h-[45vh] flex-1 resize-none text-[15px] leading-relaxed"
          />
        )}
        <p className="text-xs tabular-nums text-muted-foreground">
          {words.toLocaleString()} words · about {minutes(chars / RATE[expressive ? "elevenlabs" : "deepgram"])} · voicing {dollars((chars / 1000) * per1000 * (expressive && delivery ? 1.05 : 1))}
          {edited ? " · edited" : ""}
          {directed && (
            <>
              {" · "}
              <button type="button" onClick={() => setShowDirected(!showDirected)} className="font-medium text-foreground underline-offset-4 hover:underline">
                {showDirected ? "Back to the script" : "What the voice read, with its delivery"}
              </button>
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-3">
          {expressive && (
            <label className="mr-2 flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={delivery} onChange={(event) => setDelivery(event.target.checked)} className="size-4 accent-[var(--signal-strong)]" />
              Teacher&apos;s delivery
            </label>
          )}
          <select aria-label="Voice" className={cn(SELECT, "max-w-[16rem]")} value={voice} onChange={(event) => setVoice(event.target.value)}>
            <VoiceOptions voices={voices} prices={prices} />
          </select>
          {row && (
            <Tip content="A new script from the lesson, for your review. The current audio stays until a new one is voiced.">
              <Button type="button" variant="ghost" size="sm" onClick={() => onWriteAgain(row)} disabled={Boolean(busy)}>
                <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
                Write again
              </Button>
            </Tip>
          )}
          {row?.audio?.hasAudio && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove()} loading={busy === "remove"} loadingLabel="Removing…" disabled={Boolean(busy) && busy !== "remove"}>
              Take off the lesson
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void act("save", () => saveLessonScript(audioId, script ?? ""), "Saved.")}
            loading={busy === "save"}
            loadingLabel="Saving…"
            disabled={!edited || (Boolean(busy) && busy !== "save")}
          >
            Save edits
          </Button>
          <Button type="button" size="sm" onClick={() => void approve()} loading={busy === "approve"} loadingLabel="Queueing…" disabled={!script?.trim() || (Boolean(busy) && busy !== "approve")}>
            <Mic className="mr-1.5 size-4" aria-hidden="true" />
            {row?.audio?.hasAudio ? "Voice again" : "Approve and voice"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
