import { Suspense } from "react";
import { getTaskFinderOptions } from "@/actions/practice-tasks";
import { PracticeHeader } from "@/components/admin/practice-tabs";
import { PracticeTaskFinder } from "@/components/admin/practice-task-finder";
import { AUTHORING_CHAIN } from "@/lib/ai/gemini";

export const runtime = "nodejs";

export default async function PracticeTasksPage() {
  const options = await getTaskFinderOptions();
  const models = AUTHORING_CHAIN.map(({ model, label }) => ({ id: model, label }));
  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-8 md:px-4">
      <PracticeHeader />
      <Suspense>
        <PracticeTaskFinder options={options} models={models} />
      </Suspense>
    </div>
  );
}
