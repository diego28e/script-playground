import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getHowILearn } from "@/actions/how-i-learn";
import { HowILearnPage } from "@/components/learner/how-i-learn";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "How I learn" };

/** How I learn (docs/whiteboard-teaching.md §2): what the learner asked of their teachers, and what the teachers observed. */
export default async function Page() {
  const data = await getHowILearn();
  if (!data) redirect(`/login?next=${encodeURIComponent("/how-i-learn")}`);
  return <HowILearnPage data={data} />;
}
