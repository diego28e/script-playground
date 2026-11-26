"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, SquarePen } from "lucide-react";
import { toast } from "sonner";
import { startNewBoard } from "@/actions/board";
import { useLanguage } from "@/components/providers/language-provider";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tip } from "@/components/ui/tip";
import type { SkillStateName } from "@/lib/board/context";
import { cn } from "@/lib/utils";

// The board page's frame (docs/whiteboard.md): a bar with the lesson, the skill being learned (and the others of the
// lesson, to switch to), and "New board"; under it, Didactra fills the rest of the screen.

const COPY = {
  es: {
    back: "Volver a la lección",
    skill: "Habilidad",
    wholeLesson: "Toda la lección",
    newBoard: "Pizarra nueva",
    newBoardTip: "Empieza esta habilidad en una pizarra en blanco. La de ahora queda guardada.",
    confirmTitle: "¿Empezar una pizarra nueva?",
    confirmText: "La pizarra de ahora se cierra y queda guardada con su historia. El profesor empieza de nuevo esta habilidad.",
    confirmLabel: "Pizarra nueva",
    failed: "No se pudo empezar una pizarra nueva.",
    frame: "Pizarra con el profesor",
    states: { new: "Nueva", learning: "Aprendiendo", reviewing: "Repasando", secure: "Dominada" },
  },
  en: {
    back: "Back to the lesson",
    skill: "Skill",
    wholeLesson: "The whole lesson",
    newBoard: "New board",
    newBoardTip: "Start this skill on a blank board. The current one is kept.",
    confirmTitle: "Start a new board?",
    confirmText: "The current board is closed and kept with its history. The teacher starts this skill again.",
    confirmLabel: "New board",
    failed: "A new board couldn't be started.",
    frame: "Whiteboard with the teacher",
    states: { new: "New", learning: "Learning", reviewing: "Reviewing", secure: "Secure" },
  },
};

type Skill = { key: string; labelEs: string; labelEn: string; state: SkillStateName };

export function BoardFrame({
  src,
  lessonHref,
  lessonId,
  lessonTitle,
  skillKey,
  skills,
}: {
  src: string;
  lessonHref: string;
  lessonId: string;
  lessonTitle: string;
  skillKey: string | null;
  skills: Skill[];
}) {
  const { language } = useLanguage();
  const t = COPY[language];
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [starting, setStarting] = useState(false);
  const label = (skill: Skill) => (language === "es" ? skill.labelEs : skill.labelEn);

  const newBoard = async () => {
    const ok = await confirm({ title: t.confirmTitle, description: t.confirmText, confirmLabel: t.confirmLabel, icon: SquarePen });
    if (!ok) return;
    setStarting(true);
    const result = await startNewBoard({ lessonId, skillKey, language }).catch(() => null);
    setStarting(false);
    if (!result?.success) {
      toast.error(result && !result.success ? result.error : t.failed);
      return;
    }
    startTransition(() => router.push(`${lessonHref}/board?session=${encodeURIComponent(result.sessionId)}`));
  };

  return (
    <div className="flex h-[calc(100svh-4rem-1px)] flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-4">
        <Tip content={t.back}>
          <Link
            href={lessonHref}
            aria-label={t.back}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        </Tip>
        <p className="hidden min-w-0 shrink truncate text-sm font-medium lg:block lg:max-w-[22rem]">{lessonTitle}</p>
        {skills.length > 0 && (
          <label className="flex min-w-0 flex-1 items-center gap-2 lg:max-w-[28rem]">
            <span className="sr-only">{t.skill}</span>
            <select
              value={skillKey ?? ""}
              onChange={(event) => startTransition(() => router.push(`${lessonHref}/board?skill=${encodeURIComponent(event.target.value)}`))}
              disabled={pending}
              className="h-9 w-full min-w-0 truncate rounded-full border border-input bg-background px-3 text-sm"
            >
              {skills.map((skill) => (
                <option key={skill.key} value={skill.key}>
                  {label(skill)} · {t.states[skill.state]}
                </option>
              ))}
            </select>
          </label>
        )}
        {!skills.length && <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t.wholeLesson}</p>}
        <span className="hidden flex-1 lg:block" />
        <Tip content={t.newBoardTip}>
          <button
            type="button"
            onClick={() => void newBoard()}
            disabled={starting || pending}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              (starting || pending) && "opacity-60",
            )}
          >
            <SquarePen className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t.newBoard}</span>
            <span className="sr-only sm:hidden">{t.newBoard}</span>
          </button>
        </Tip>
      </div>
      <iframe
        // A new launch is signed for each visit: the key makes a new frame when it changes.
        key={src}
        src={src}
        aria-label={t.frame}
        allow="microphone; clipboard-write; autoplay; fullscreen"
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
      {dialog}
    </div>
  );
}
