import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
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
    const session = await auth.api.getSession({ headers: await headers() });
    const result = await getCourseBySlug(slug, session?.user?.id);
    if (!result.success || !result.data) notFound();
    return <CourseOverview course={result.data} signedIn={Boolean(session)} />;
}
