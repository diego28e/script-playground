import { listCompassConcepts } from "@/actions/compass";
import { CompassConceptList } from "@/components/admin/compass/concept-list";

export const runtime = "nodejs";

export default async function PythonCompassPage() {
  const data = await listCompassConcepts();
  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-8 md:px-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Python Compass</h2>
        <p className="max-w-3xl text-muted-foreground">
          A card for each Python concept learners meet in the course, most used first. A model drafts it in the platform&apos;s
          voice with links from the official Python 3.12 docs, the grader proves every example, and you review and publish it.
        </p>
      </div>
      <CompassConceptList data={data} />
    </div>
  );
}
