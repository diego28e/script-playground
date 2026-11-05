import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { lessonPath } from "@/lib/lab";
import { getLessonWorkspace } from "@/actions/lessons";
import { LessonWorkspace } from "@/components/courses/lesson-workspace";
import { LessonMarkdown } from "@/components/courses/lesson-markdown";
import { parseLessonVideo, type LessonVideo } from "@/lib/lesson-video";
import { resolveMediaUrls } from "@/lib/media";

export const runtime = "nodejs";

type Props = { params: Promise<{ slug: string; module: string; lesson: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug, module: moduleSlug, lesson: lessonSlug } = await params;
    const result = await getLessonWorkspace(slug, moduleSlug, lessonSlug);
    // Titles carry Markdown code spans ("`lc-mastery`"); a browser tab shows them as plain text.
    const plain = (text: string) => text.replaceAll("`", "");
    return result.success && result.data ? { title: `${plain(result.data.lesson.title)} · ${plain(result.data.course.title)}` } : {};
}

export default async function LessonPage({ params }: Props) {
    const { slug, module: moduleSlug, lesson: lessonSlug } = await params;
    const session = await auth.api.getSession({ headers: await headers() });
    const result = await getLessonWorkspace(slug, moduleSlug, lessonSlug, session?.user?.id);
    if (!result.success) throw new Error(result.error);
    if (!result.data) notFound();
    const { video: storedVideo, ...lesson } = result.data.lesson;
    const data = { ...result.data, lesson };

    // The lesson's video, checked again (it was checked on import) and with its /media/ paths turned into signed
    // URLs here, so the signing key never leaves the server. A broken video hides the player, not the lesson.
    let video: LessonVideo | null = null;
    if (storedVideo) {
        try {
            video = resolveMediaUrls(parseLessonVideo(storedVideo));
        } catch (error) {
            console.error(`Lesson ${lesson.id} has a video that can't be shown:`, error);
        }
    }

    // A reading lesson's guide is rendered here, on the server, so its Markdown libraries never reach the browser.
    let reading = null;
    if (data.lesson.kind === "READING" && data.lesson.body && data.lesson.sourcePath) {
        const lessonPages = Object.fromEntries(
            data.course.modules.flatMap((courseModule) =>
                courseModule.lessons
                    .filter((entry) => entry.sourcePath)
                    .map((entry) => [entry.sourcePath!, lessonPath(data.course.slug, courseModule.slug, entry.slug)]),
            ),
        );
        reading = (
            <LessonMarkdown
                // The page shows the lesson title already; drop the guide's own top heading.
                markdown={data.lesson.body.replace(/^\s*# [^\n]*\n/, "")}
                sourcePath={data.lesson.sourcePath}
                repoUrl={data.course.sourceRepoUrl}
                sourceRef={data.course.sourceRef}
                lessonPages={lessonPages}
            />
        );
    }

    return <LessonWorkspace data={data} signedIn={Boolean(session)} reading={reading} video={video} />;
}
