import { getPracticeGraph } from "@/actions/practice";
import { PracticeGraphEditor } from "@/components/admin/practice-graph";
import { PracticeTabs } from "@/components/admin/practice-tabs";

export const runtime = "nodejs";

export default async function PracticePage() {
  const data = await getPracticeGraph();

  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-8 md:px-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Practice skills</h2>
          <p className="text-muted-foreground">
            What learners practise after each lesson, and what each skill needs first. Draft, review, approve, then publish.
          </p>
        </div>
        <PracticeTabs />
      </div>
      <PracticeGraphEditor data={data} />
    </div>
  );
}
