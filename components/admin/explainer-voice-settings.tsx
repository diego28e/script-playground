"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Square, Volume2 } from "lucide-react";
import { previewExplainerVoice, setExplainerVoice, setLessonTutorOwnVoice, type ExplainerVoiceSettings } from "@/actions/explainer-voice";
import { Button } from "@/components/ui/button";
import { DotLoader } from "@/components/ui/dot-loader";
import { EXPLAINER_VOICES } from "@/lib/voice/explainer-voices";
import { cn } from "@/lib/utils";

// Admin → Audio: the voice the AI explainers speak in (docs/voice.md, "The explainer's voice"). One choice for the
// whole platform: the lesson tutor ("Ask the teacher"), the practice coach ("Talk it through") and the lab's tutor all
// read their replies in it. Each voice can be heard before it's chosen.

export function ExplainerVoiceSettingsCard({ settings }: { settings: ExplainerVoiceSettings }) {
  const router = useRouter();
  const group = useId();
  // What is being saved or loaded: a voice's id (its sample or its choice), or the switch.
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };

  const hear = async (voice: string) => {
    if (playing === voice) return stop();
    stop();
    setBusy(`hear-${voice}`);
    const result = await previewExplainerVoice(voice).catch(() => null);
    setBusy(null);
    if (!result || !result.success) {
      toast.error(result && !result.success ? result.error : "We couldn't reach the server. Try again.");
      return;
    }
    const player = new Audio(result.src);
    audio.current = player;
    setPlaying(voice);
    player.onended = () => setPlaying((current) => (current === voice ? null : current));
    void player.play().catch(() => setPlaying(null));
  };

  const choose = async (voice: string, name: string) => {
    if (voice === settings.voice || busy) return;
    setBusy(`choose-${voice}`);
    const result = await setExplainerVoice(voice).catch(() => null);
    setBusy(null);
    if (!result || !result.success) {
      toast.error(result && !result.success ? result.error : "We couldn't reach the server. Try again.");
      return;
    }
    toast.success(`The explainers now speak as ${name}. Conversations pick it up within a minute.`);
    startRefresh(() => router.refresh());
  };

  const toggleOwnVoice = async () => {
    if (busy) return;
    const on = !settings.lessonOwnVoice;
    setBusy("own-voice");
    const result = await setLessonTutorOwnVoice(on).catch(() => null);
    setBusy(null);
    if (!result || !result.success) {
      toast.error(result && !result.success ? result.error : "We couldn't reach the server. Try again.");
      return;
    }
    toast.success(on ? "On lessons, the teacher answers in the lesson's own voice." : "On lessons, the teacher answers in the explainers' voice.");
    startRefresh(() => router.refresh());
  };

  return (
    <section aria-labelledby={`${group}-title`} className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h3 id={`${group}-title`} className="text-lg font-semibold tracking-tight">
        The AI explainers&apos; voice
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        One voice for every reply read aloud: &ldquo;Ask the teacher&rdquo; on a lesson, &ldquo;Talk it through&rdquo; in practice, and the lab&apos;s tutor. Deepgram Flux,
        read at {settings.speed}× (each learner can change the speed on the voice sheet). Spanish replies are read by a Spanish Flux voice.
      </p>
      {!settings.configured && (
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-100">
          DEEPGRAM_API_KEY isn&apos;t set on the platform, so the samples can&apos;t play here. The lab&apos;s services speak with their own key.
        </p>
      )}

      <div role="radiogroup" aria-labelledby={`${group}-title`} className="mt-4 grid gap-2 sm:grid-cols-2">
        {EXPLAINER_VOICES.map((voice) => {
          const chosen = settings.voice === voice.id;
          return (
            <div key={voice.id} className={cn("flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors", chosen ? "border-primary bg-primary/5" : "border-border")}>
              <button
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={Boolean(busy)}
                onClick={() => void choose(voice.id, voice.name)}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default"
              >
                <span className={cn("mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border", chosen ? "border-primary" : "border-muted-foreground/50")} aria-hidden="true">
                  {chosen && <span className="size-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {voice.name}
                    {busy === `choose-${voice.id}` && <DotLoader className="ml-2 inline-block" />}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{voice.about}</span>
                </span>
              </button>
              <Button variant="outline" size="sm" onClick={() => void hear(voice.id)} disabled={!settings.configured || (Boolean(busy) && busy !== `hear-${voice.id}`)} aria-label={`${playing === voice.id ? "Stop" : "Hear"} ${voice.name}`}>
                {busy === `hear-${voice.id}` ? <DotLoader className="mr-2" /> : playing === voice.id ? <Square className="mr-2 size-3 fill-current" /> : <Volume2 className="mr-2 size-4" />}
                {playing === voice.id ? "Stop" : "Hear it"}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-start gap-3 border-t border-border pt-4">
        <div className="min-w-0 flex-1">
          <p id={`${group}-own`} className="text-sm font-medium">
            On lessons, answer in the lesson&apos;s own voice
          </p>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            Off: &ldquo;Ask the teacher&rdquo; uses the voice above. On: it answers in the voice that recorded the lesson, which for an ElevenLabs lesson spends
            ElevenLabs credits on every answer.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.lessonOwnVoice}
          aria-labelledby={`${group}-own`}
          disabled={Boolean(busy)}
          onClick={() => void toggleOwnVoice()}
          className={cn(
            "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60",
            settings.lessonOwnVoice ? "bg-primary" : "bg-muted-foreground/30",
          )}
        >
          <span className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", settings.lessonOwnVoice ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
        </button>
      </div>
    </section>
  );
}
