import { PracticeLoading } from "@/components/admin/practice-tabs";

// Shown the moment the Tasks tab is clicked, until the server has the task finder's lists ready.
export default function Loading() {
  return <PracticeLoading />;
}
