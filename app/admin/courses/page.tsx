import { listCoursesForAdmin } from "@/actions/course-access";
import { CourseAccessManager } from "@/components/admin/course-access-manager";

export const runtime = "nodejs";

/** Admin → Courses: who can see each course (docs/private-courses.md) and the widgets beside its practice (docs/practice.md). */
export default async function AdminCoursesPage() {
  const courses = await listCoursesForAdmin();
  return (
    <div className="flex h-full flex-1 flex-col gap-6 px-2 pb-10 md:px-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Courses</h2>
        <p className="max-w-2xl text-muted-foreground">
          Who can see each course, and what sits beside its practice. A private course only exists for the people you add by
          email, and for admins: nobody else finds it in the catalog, by its link, in practice or in the lab.
        </p>
      </div>
      <CourseAccessManager courses={courses} />
    </div>
  );
}
