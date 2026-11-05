import { Children, isValidElement, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { sourceFileUrl } from "@/lib/lab";

// A course guide (a Markdown file in the course repository) rendered in the lesson page, with GitHub's
// extensions (tables, task lists, strikethrough) and the platform's tokens, since the app has no typography
// plugin. Relative links are resolved against the guide's own folder: one to another lesson's file opens that
// lesson's page, anything else opens the file on GitHub at the imported commit.

type Props = {
  markdown: string;
  /** The guide's path in the repository, e.g. "modules/00-foundations/00-02-create-course-env.md". */
  sourcePath: string;
  repoUrl: string | null;
  sourceRef: string | null;
  /** Repository path → lesson page, for links between lessons. */
  lessonPages: Record<string, string>;
};

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : isValidElement(child) ? textOf((child.props as { children?: ReactNode }).children) : ""))
    .join("");
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. Links like "#per-module" land on them. */
function headingId(children: ReactNode) {
  return textOf(children)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function resolveLink(href: string, { sourcePath, repoUrl, sourceRef, lessonPages }: Omit<Props, "markdown">) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return { href, external: true };
  if (href.startsWith("#")) return { href, external: false };
  const [path, hash = ""] = href.split("#");
  // Resolve "../../setup/X.md" against the guide's folder, the way GitHub does.
  const resolved = new URL(path, `https://repo.invalid/${sourcePath}`).pathname.slice(1);
  const page = lessonPages[decodeURIComponent(resolved)];
  if (page) return { href: hash ? `${page}#${hash}` : page, external: false };
  const file = sourceFileUrl(repoUrl, sourceRef, resolved);
  return file ? { href: hash ? `${file}#${hash}` : file, external: true } : { href, external: true };
}

export function LessonMarkdown({ markdown, ...context }: Props) {
  const heading = (Tag: "h2" | "h3" | "h4", className: string) =>
    function Heading({ children }: { children?: ReactNode }) {
      return (
        <Tag id={headingId(children)} className={`scroll-mt-24 ${className}`}>
          {children}
        </Tag>
      );
    };

  const components: Components = {
    // The page already shows the lesson title, so the guide's own title steps down a level.
    h1: heading("h2", "mt-10 mb-4 text-2xl font-semibold tracking-tight first:mt-0"),
    h2: heading("h2", "mt-10 mb-4 text-2xl font-semibold tracking-tight first:mt-0"),
    h3: heading("h3", "mt-8 mb-3 text-lg font-semibold tracking-tight"),
    h4: heading("h4", "mt-6 mb-2 text-base font-semibold"),
    p: ({ children }) => <p className="my-4 leading-7">{children}</p>,
    ul: ({ children, className }) => (
      <ul className={className?.includes("contains-task-list") ? "my-4 flex flex-col gap-1.5" : "my-4 flex list-disc flex-col gap-1.5 pl-6 marker:text-muted-foreground"}>
        {children}
      </ul>
    ),
    ol: ({ children, start }) => (
      <ol start={start} className="my-4 flex list-decimal flex-col gap-1.5 pl-6 marker:text-muted-foreground">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-7">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-5 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>
    ),
    hr: () => <hr className="my-10 border-border" />,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    a: ({ href = "", children }) => {
      const link = resolveLink(href, context);
      const className = "font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground";
      return link.external ? (
        <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
          {children}
          <ExternalLink className="ml-0.5 inline size-3 align-baseline text-muted-foreground" aria-hidden="true" />
        </a>
      ) : (
        <Link href={link.href} className={className}>
          {children}
        </Link>
      );
    },
    // Code blocks use the fixed dark code panel, like the challenge editor; inline code sits in the text.
    pre: ({ children }) => (
      <pre className="my-5 overflow-x-auto rounded-2xl border border-code-border bg-code p-4 font-mono text-[13px] leading-6 text-code-foreground">
        {children}
      </pre>
    ),
    code: ({ children, className }) =>
      className?.startsWith("language-") || String(children).includes("\n") ? (
        <code className="font-mono">{children}</code>
      ) : (
        <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
      ),
    table: ({ children }) => (
      <div className="my-6 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
    th: ({ children, style }) => (
      <th style={style} className="border-b border-border px-4 py-2.5 font-semibold">
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td style={style} className="border-b border-border px-4 py-2.5 align-top leading-6 [tr:last-child_&]:border-b-0">
        {children}
      </td>
    ),
    input: ({ checked, type }) =>
      type === "checkbox" ? <input type="checkbox" checked={checked} readOnly disabled className="mr-2 size-3.5 accent-[var(--primary)]" /> : null,
  };

  return (
    // Long commands and paths in running text may break anywhere rather than push the page sideways on a
    // phone; code blocks and tables scroll inside their own boxes instead.
    <div className="text-[15px] text-foreground/90 [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
