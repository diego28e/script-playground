"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, AudioLines, Globe, Lock, SquareTerminal, X } from "lucide-react";
import { addCourseAccess, removeCourseAccess, setCoursePracticeLanguage, setCoursePracticeWidget, setCourseVisibility, type AdminCourse, type CourseAccessEntry } from "@/actions/course-access";
import { LANGUAGE, PRACTICE_LANGUAGES } from "@/lib/practice/language";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DotLoader } from "@/components/ui/dot-loader";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

// Admin → Courses (docs/private-courses.md): each course with who can see it and the widgets beside its practice. Switching a course between public and
// private asks first, because it changes what other people can open; the email list is edited in place.

const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

const ACCOUNT: Record<CourseAccessEntry["account"], string> = {
  ready: "Has an account",
  none: "Hasn't signed in yet",
  unverified: "Email not verified by their sign-in",
};

const VISIBILITY = [
  { value: "PUBLIC", label: "Everyone", icon: Globe },
  { value: "PRIVATE", label: "Only people I add", icon: Lock },
] as const;

// The widgets beside a course's practice (docs/practice.md, "Widgets"): each one a switch, on or off per course.
const WIDGETS = [
  {
    widget: "scratchbook",
    field: "practiceScratchbook",
    label: "Python scratchbook",
    about: "A place to run Python beside a task, with an AI that explains the learner's code. For courses whose tasks are code.",
    icon: SquareTerminal,
  },
  {
    widget: "voice",
    field: "practiceVoice",
    label: "Talk it through",
    about: "A voice coach: the learner says an answer out loud, hears what was missing and gets an interviewer's follow-ups. For courses about explaining.",
    icon: AudioLines,
  },
] as const;

export function CourseAccessManager({ courses }: { courses: AdminCourse[] }) {
  if (courses.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No courses yet. Import one with <code className="font-mono">pnpm course:import --repo &lt;path&gt;</code>; add{" "}
        <code className="font-mono">--private</code> to keep it to the people you choose from the start.
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </ul>
  );
}

function CourseCard({ course }: { course: AdminCourse }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const group = useId();
  const [emails, setEmails] = useState("");
  // What is being saved: the visibility, an add, or the id of the entry being removed.
  const [busy, setBusy] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const isPrivate = course.visibility === "PRIVATE";
  const draft = course.status === "DRAFT";

  const run = async (what: string, work: () => Promise<{ success: true } | { success: false; error: string }>) => {
    setBusy(what);
    try {
      const result = await work();
      if (!result.success) {
        toast.error(result.error);
        return false;
      }
      startRefresh(() => router.refresh());
      return true;
    } catch {
      toast.error("We couldn't reach the server. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const changeVisibility = async (next: "PUBLIC" | "PRIVATE") => {
    if (next === course.visibility || busy) return;
    const ok =
      next === "PRIVATE"
        ? await confirm({
            title: `Make “${course.title}” private?`,
            description: course.enrolledOutside
              ? `${people(course.enrolledOutside)} enrolled in it ${course.enrolledOutside === 1 ? "isn't" : "aren't"} on its list and will lose it at once: the course, its practice and its lab notebooks. Their progress is kept, and comes back if you add them.`
              : "Only the people on its list, and admins, will be able to see it. For everyone else it won't exist.",
            detail: course.access.length ? `${people(course.access.length)} on the list` : "Nobody on the list yet",
            confirmLabel: "Make private",
            icon: Lock,
          })
        : await confirm({
            title: `Open “${course.title}” to everyone?`,
            description: draft
              ? "Once it is published, anyone will see it in the catalog and can enrol. Its list is kept, in case you make it private again."
              : "Anyone will see it in the catalog and can enrol. Its list is kept, in case you make it private again.",
            confirmLabel: "Open to everyone",
            icon: Globe,
          });
    if (!ok) return;
    if (await run("visibility", () => setCourseVisibility(course.id, next))) {
      toast.success(next === "PRIVATE" ? "The course is private now." : "The course is open to everyone now.");
    }
  };

  const toggleWidget = async (widget: "scratchbook" | "voice", label: string, on: boolean) => {
    if (busy) return;
    if (await run(widget, () => setCoursePracticeWidget(course.id, widget, on))) toast.success(`${label}: ${on ? "on" : "off"} for ${course.title}.`);
  };

  const add = async () => {
    if (!emails.trim() || busy) return;
    setBusy("add");
    try {
      const result = await addCourseAccess(course.id, emails);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      // What couldn't be read stays in the box, to be fixed.
      setEmails(result.invalid.join(", "));
      const parts = [
        result.added ? `Added ${people(result.added)}.` : "",
        result.already ? `${result.already} already on the list.` : "",
        result.invalid.length ? `${result.invalid.length === 1 ? "This isn't an email" : "These aren't emails"}: ${result.invalid.join(", ")}.` : "",
      ].filter(Boolean);
      (result.invalid.length ? toast.warning : toast.success)(parts.join(" "));
      startRefresh(() => router.refresh());
    } catch {
      toast.error("We couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: CourseAccessEntry) => {
    if (busy) return;
    if (
      isPrivate &&
      !(await confirm({
        title: `Remove ${entry.email}?`,
        description: entry.enrolled
          ? "The course closes for them at once. Their progress is kept, and comes back if you add them again."
          : "They won't be able to see the course.",
        confirmLabel: "Remove",
        tone: "danger",
      }))
    )
      return;
    await run(entry.id, () => removeCourseAccess(entry.id));
  };

  return (
    <li className="rounded-xl border border-border bg-card p-5 sm:p-6">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-tight text-balance">{course.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{course.slug}</span> · {course.moduleCount} modules · {course.lessonCount} lessons ·{" "}
            <span className="tabular-nums">{course.enrolledCount}</span> enrolled
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs font-medium",
              draft ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-border text-muted-foreground",
            )}
          >
            {draft ? "Draft" : "Published"}
          </span>
          {!draft && (
            <Link href={`/courses/${course.slug}`} className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
              Open
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <fieldset className="contents" disabled={Boolean(busy)}>
          <legend className="sr-only">Who can see {course.title}</legend>
          <span className="text-sm font-medium" aria-hidden="true">
            Who can see it
          </span>
          <div className="inline-flex rounded-full border border-border bg-background p-0.5">
            {VISIBILITY.map(({ value, label, icon: Icon }) => (
              <label
                key={value}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                  course.visibility === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  busy && "cursor-default",
                )}
              >
                <input type="radio" name={group} value={value} checked={course.visibility === value} onChange={() => void changeVisibility(value)} className="sr-only" />
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {busy === "visibility" && <DotLoader />}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {draft
          ? isPrivate
            ? "A draft: nobody sees it yet. Once published, only the people below and admins will."
            : "A draft: nobody sees it yet. Once published, it is in the catalog for everyone."
          : isPrivate
            ? "Only the people below, and admins, can see it. For everyone else it doesn't exist."
            : "In the catalog for everyone; anyone signed in can enrol."}
      </p>

      <div className="mt-5 border-t border-border pt-5">
        <h4 className="text-sm font-medium">Practice widgets</h4>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">What learners get beside this course&apos;s practice. A change shows the next time the practice page loads.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Code practice in</span>
          <div className="inline-flex rounded-full border border-border bg-background p-0.5">
            {PRACTICE_LANGUAGES.map((language) => (
              <button
                key={language}
                type="button"
                aria-pressed={course.practiceLanguage === language}
                disabled={Boolean(busy)}
                onClick={() => {
                  if (language === course.practiceLanguage || busy) return;
                  void run("language", () => setCoursePracticeLanguage(course.id, language)).then((ok) => ok && toast.success(`Code practice for ${course.title}: ${LANGUAGE[language].label}.`));
                }}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  course.practiceLanguage === language ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {LANGUAGE[language].label}
              </button>
            ))}
          </div>
          {busy === "language" && <DotLoader />}
          <span className="text-xs text-muted-foreground">The scratchbook&apos;s language, and new code tasks&apos;. Tasks already written keep theirs.</span>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {WIDGETS.map(({ widget, field, label: named, about: described, icon: Icon }) => {
            const on = course[field];
            // The scratchbook runs the course's language.
            const codeLabel = LANGUAGE[course.practiceLanguage].label;
            const label = named.replace("Python", codeLabel);
            const about = described.replace("Python", codeLabel);
            return (
              <li key={widget} className="flex items-start gap-3 rounded-lg border border-border px-4 py-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p id={`${group}-${widget}`} className="text-sm font-medium">
                    {label}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{about}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby={`${group}-${widget}`}
                  disabled={Boolean(busy)}
                  onClick={() => void toggleWidget(widget, label, !on)}
                  className={cn(
                    "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60",
                    on ? "bg-primary" : "bg-muted-foreground/30",
                  )}
                >
                  <span className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", on ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {(isPrivate || course.access.length > 0) && (
        <div className="mt-5 border-t border-border pt-5">
          <h4 className="text-sm font-medium">
            People with access <span className="font-normal tabular-nums text-muted-foreground">({course.access.length})</span>
          </h4>
          {!isPrivate && (
            <p className="mt-1 text-sm text-muted-foreground">Kept from when the course was private. It has no effect while the course is open to everyone.</p>
          )}
          {course.access.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              Nobody yet, so only admins can open it. Add the emails people sign in with.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {course.access.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{entry.email}</p>
                    <p className={cn("text-xs", entry.account === "unverified" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                      {entry.name ? `${entry.name} · ` : ""}
                      {ACCOUNT[entry.account]}
                      {entry.account === "unverified" ? ", so the course stays closed to them" : entry.enrolled ? " · Enrolled" : entry.account === "ready" ? " · Not enrolled yet" : ""}
                    </p>
                  </div>
                  {busy === entry.id ? (
                    <DotLoader />
                  ) : (
                    <Tip content="Remove from the list">
                      <button
                        type="button"
                        onClick={() => void remove(entry)}
                        disabled={Boolean(busy)}
                        aria-label={`Remove ${entry.email}`}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </Tip>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <label htmlFor={`${group}-emails`} className="sr-only">
              Emails to add to {course.title}
            </label>
            <Input
              id={`${group}-emails`}
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              placeholder="name@example.com, another@example.com"
              autoComplete="off"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 basis-64"
            />
            <Button type="submit" variant="outline" loading={busy === "add"} loadingLabel="Adding…" disabled={!emails.trim() || (Boolean(busy) && busy !== "add")}>
              Add
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            The email each person signs in with (their Google account). You can add someone before they have an account; several at once, separated by commas or spaces.
          </p>
        </div>
      )}
    </li>
  );
}
