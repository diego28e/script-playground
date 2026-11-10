import { notFound } from "next/navigation";
import { getCompassConcept } from "@/actions/compass";
import { CompassCardEditor } from "@/components/admin/compass/card-editor";

export const runtime = "nodejs";

type Props = { params: Promise<{ key: string }> };

export default async function CompassConceptPage({ params }: Props) {
  const { key } = await params;
  const data = await getCompassConcept(decodeURIComponent(key));
  if (!data) notFound();
  return (
    <div className="flex h-full flex-1 flex-col gap-5 px-2 pb-8 md:px-4">
      <CompassCardEditor data={data} />
    </div>
  );
}
