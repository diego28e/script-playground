import { Metadata } from "next";
import { getPublishedCourses } from "@/actions/courses";
import { CourseCatalog } from "@/components/courses/course-catalog";

export const runtime = "nodejs";

export const metadata: Metadata = {
    title: "Cursos",
    description: "Cursos con notebooks reales, lecturas, proyectos y práctica espaciada.",
};

export default async function CoursesPage() {
    const result = await getPublishedCourses();
    // A failed query is an error (error.tsx), not an empty catalog.
    if (!result.success) throw new Error(result.error);
    return <CourseCatalog courses={result.data ?? []} />;
}
