import { listCompassConcepts } from "@/actions/compass";
import { CompassConceptList } from "@/components/admin/compass/concept-list";

export const runtime = "nodejs";

/** Admin → JavaScript (docs/compass.md, "JavaScript"): the JavaScript Compass, for the TypeScript course. */
export default async function JavaScriptCompassPage() {
  const data = await listCompassConcepts("javascript");
  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-8 md:px-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">JavaScript Compass</h2>
        <p className="max-w-3xl text-muted-foreground">
          A card for each JavaScript construct and piece of TypeScript syntax learners meet in the TypeScript course, most used
          first. A model drafts it in the platform&apos;s voice with links from MDN and the Node.js 26 docs, the TypeScript
          sandbox proves every example (Node.js 26 runs it after tsc 7 checks it), and you review and publish it.
        </p>
      </div>
      <CompassConceptList data={data} />
    </div>
  );
}
