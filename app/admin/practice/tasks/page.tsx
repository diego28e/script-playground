import { Suspense } from "react";
import { getTaskFinderOptions } from "@/actions/practice-tasks";
import { PracticeTabs } from "@/components/admin/practice-tabs";
import { PracticeTaskFinder } from "@/components/admin/practice-task-finder";
import { AUTHORING_CHAIN } from "@/lib/ai/gemini";

export const runtime = "nodejs";

export default async function PracticeTasksPage() {
  const options = await getTaskFinderOptions();
  const models = AUTHORING_CHAIN.map(({ model, label }) => ({ id: model, label }));
  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-8 md:px-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Practice tasks</h2>
          <p className="max-w-2xl text-muted-foreground">
            Every task learners can get, to find and fix: search its words, narrow it down, and see how learners did. An edit is
            proven again before it replaces the task.
          </p>
        </div>
        <PracticeTabs />
      </div>
      <Suspense>
        <PracticeTaskFinder options={options} models={models} />
      </Suspense>
    </div>
  );
}
