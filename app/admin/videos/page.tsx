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
                    Upload a lesson&apos;s video here. It goes to the media bucket, is encoded for the web, and is attached
                    to the lesson when it&apos;s ready. Learners get it through media.academiadelcodigo.com with signed links.
                </p>
            </div>
            <VideoManager data={data} />
        </div>
    );
}
