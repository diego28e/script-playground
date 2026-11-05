import { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getPublishedCourses } from "@/actions/courses";
import { CourseCatalog } from "@/components/courses/course-catalog";

export const runtime = "nodejs";

export const metadata: Metadata = {
    title: "Cursos",
    description: "Cursos con notebooks reales, lecturas, proyectos y práctica espaciada.",
};

export default async function CoursesPage() {
    const session = await auth.api.getSession({ headers: await headers() });
    const result = await getPublishedCourses(session?.user?.id);
    return <CourseCatalog courses={result.success ? result.data ?? [] : []} />;
}
