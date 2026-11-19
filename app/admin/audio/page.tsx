import { getAudioOptions } from "@/actions/lesson-audio";
import { LessonAudioManager } from "@/components/admin/lesson-audio-manager";

export const runtime = "nodejs";

/** Admin → Audio: each lesson told by a teacher (docs/lesson-audio.md). */
export default async function AdminAudioPage() {
  const options = await getAudioOptions();
  return (
    <div className="flex h-full flex-1 flex-col gap-6 px-2 pb-10 md:px-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Lesson audio</h2>
        <p className="max-w-3xl text-muted-foreground">
          A teacher explains each lesson out loud. A model writes the script from the whole lesson, you read and approve it, and Deepgram voices it.
          Learners hear it on the lesson page. The work runs on the practice worker in the lab, so you can close this page.
        </p>
      </div>
      {options && options.courses.length > 0 ? (
        <LessonAudioManager options={options} />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No courses yet.</p>
      )}
    </div>
  );
}
