import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft } from "lucide-react";
import { BriefActions } from "@/components/admin/brief-actions";
import { buildLessonBrief } from "@/lib/video-brief";

export const runtime = "nodejs";
// Built fresh on every visit: it reads the notebook from GitHub and the latest learner data.
export const dynamic = "force-dynamic";

// A lesson's video brief (lib/video-brief.ts), shown before it's downloaded: what goes to the session that makes the
// lesson's video.

const MARKDOWN =
  "text-[15px] leading-relaxed [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_p]:my-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.86em] [&_pre]:my-3 [&_pre]:max-h-[28rem] [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-code-panel [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:text-code-foreground [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:w-full [&_table]:text-sm [&_td]:border-b [&_td]:border-border [&_td]:py-1.5 [&_td]:pr-4 [&_td]:align-top [&_th]:hidden [&_td:first-child]:whitespace-nowrap [&_td:first-child]:text-muted-foreground";

export default async function VideoBriefPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const brief = await buildLessonBrief(lessonId);
  if (!brief) notFound();
  const { counts } = brief;
  const facts = [
    `${counts.skills} skill${counts.skills === 1 ? "" : "s"}`,
    counts.notebookCells ? `${counts.notebookCells} notebook cells` : "no notebook",
    counts.solution ? "reference solution" : "no reference solution",
    `${counts.stumbling} stumbling point${counts.stumbling === 1 ? "" : "s"}`,
    `${counts.tutorSessions} tutor conversation${counts.tutorSessions === 1 ? "" : "s"}`,
    `${counts.practiceAnswers} practice answer${counts.practiceAnswers === 1 ? "" : "s"}`,
  ];

  return (
    <div className="flex-1 space-y-6 p-8">
      <Link href="/admin/videos" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Videos
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Video brief</h2>
          <p className="text-muted-foreground">
            What the session that makes this lesson&apos;s video reads, with the studio&apos;s teaching guide. Save it as{" "}
            <code className="rounded bg-muted px-1 font-mono text-[0.9em]">BRIEF.md</code> in the lesson&apos;s folder under{" "}
            <code className="rounded bg-muted px-1 font-mono text-[0.9em]">09-ai-video-studio/videos/langchain-course</code>.
          </p>
          <ul className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
            {facts.map((fact) => (
              <li key={fact} className="rounded-full bg-muted px-2.5 py-1">
                {fact}
              </li>
            ))}
          </ul>
        </div>
        <BriefActions markdown={brief.markdown} downloadHref={`/admin/videos/brief/${lessonId}/download`} filename={brief.filename} />
      </div>
      <article className="max-w-4xl rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-tile)]">
        <div className={MARKDOWN}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.markdown}</ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
