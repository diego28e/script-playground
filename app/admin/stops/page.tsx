import { getStopsOverview } from "@/actions/lesson-stops";
import { LessonStopsManager } from "@/components/admin/lesson-stops-manager";

export const runtime = "nodejs";

/** Admin → Stops (docs/lesson-stops.md): where audio and video lessons pause for the learner to do a step. */
export default async function AdminStopsPage({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const { course } = await searchParams;
  const data = await getStopsOverview(course);
  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-10 md:px-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Hands-on stops</h2>
        <p className="max-w-3xl text-muted-foreground">
          Moments in a lesson&apos;s audio or video where the learner has to do something on their own computer: run a command, install something, edit a
          file. The player pauses there and shows the step with its exact commands. A model writes them from the recording&apos;s timed transcript and the
          lesson&apos;s text; you review them, then turn them on for the course.
        </p>
      </div>
      {data ? <LessonStopsManager data={data} /> : <p className="text-sm text-muted-foreground">Only admins can see this page.</p>}
    </div>
  );
}
