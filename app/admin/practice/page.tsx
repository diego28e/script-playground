import { getPracticeGraph } from "@/actions/practice";
import { PracticeGraphEditor } from "@/components/admin/practice-graph";
import { PracticeHeader } from "@/components/admin/practice-tabs";

export const runtime = "nodejs";

export default async function PracticePage() {
  const data = await getPracticeGraph();

  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-8 md:px-4">
      <PracticeHeader />
      <PracticeGraphEditor data={data} />
    </div>
  );
}
