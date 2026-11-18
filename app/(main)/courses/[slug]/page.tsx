import { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentViewer } from "@/lib/viewer";
import { getCourseBySlug } from "@/actions/courses";
import { CourseOverview } from "@/components/courses/course-overview";

export const runtime = "nodejs";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const result = await getCourseBySlug(slug);
    return result.success && result.data ? { title: result.data.title, description: result.data.summary ?? undefined } : {};
}

export default async function CoursePage({ params }: Props) {
    const { slug } = await params;
    const result = await getCourseBySlug(slug);
    if (!result.success) throw new Error(result.error);
    // Also a private course this person isn't on the list of: it doesn't say it exists.
    if (!result.data) notFound();
    return <CourseOverview course={result.data} signedIn={Boolean(await currentViewer())} />;
}
