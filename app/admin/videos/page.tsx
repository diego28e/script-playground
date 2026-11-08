import { listVideoLessons } from "@/actions/videos";
import { VideoManager } from "@/components/admin/video-manager";

export const runtime = "nodejs";

export default async function VideosPage() {
    const data = await listVideoLessons();

    return (
        <div className="h-full flex-1 flex-col space-y-8 p-8 md:flex">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Videos</h2>
                <p className="max-w-2xl text-muted-foreground">
                    A lesson&apos;s videos, one per skill as a rule, in the order learners watch them. Each upload goes to the
                    media bucket, is encoded for the web, and joins the lesson when it&apos;s ready. Learners get them through
                    media.academiadelcodigo.com with signed links.
                </p>
            </div>
            <VideoManager data={data} />
        </div>
    );
}
