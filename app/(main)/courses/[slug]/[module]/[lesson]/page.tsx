import { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { lessonPath } from "@/lib/lab";
import { getLessonWorkspace } from "@/actions/lessons";
import { LessonWorkspace } from "@/components/courses/lesson-workspace";
import { OUTLINE_COOKIE, readOutlinePreference } from "@/lib/outline-preference";
import { LessonMarkdown } from "@/components/courses/lesson-markdown";
import { parseLessonVideo } from "@/lib/lesson-video";
import type { PlayableVideo } from "@/components/courses/lesson-videos";
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
    const { videos: storedVideos, ...lesson } = result.data.lesson;
    const data = { ...result.data, lesson };

    // The lesson's videos (one per skill as a rule), each checked again and with its /media/ paths turned into signed
    // URLs here, so the signing key never leaves the server. A broken one is left out, not the lesson.
    const videos: PlayableVideo[] = [];
    for (const stored of storedVideos) {
        try {
            videos.push({
                id: stored.id,
                title: result.data.videoTitles[stored.id] ?? { es: null, en: null },
                durationSeconds: stored.durationSeconds,
                video: resolveMediaUrls(parseLessonVideo(stored.video)),
            });
        } catch (error) {
            console.error(`Lesson ${lesson.id} has a video (${stored.id}) that can't be shown:`, error);
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

    // The outline's width and fold, as the learner left them: rendered so from the start, with no jump.
    const outline = readOutlinePreference((await cookies()).get(OUTLINE_COOKIE)?.value);

    return <LessonWorkspace data={data} signedIn={Boolean(session)} reading={reading} videos={videos} outline={outline} />;
}
