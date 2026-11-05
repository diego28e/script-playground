import { PageLoader } from "@/components/feedback/page-states";

// Shown the moment a link to this route is clicked, until the server has the page ready.
export default function Loading() {
    return <PageLoader />;
}
