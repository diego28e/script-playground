import { auth } from "@/lib/auth";
import { buildLessonBrief } from "@/lib/video-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The video brief as a file (lib/video-brief.ts). A route handler isn't covered by the admin layout's check: it checks
// the admin role itself.
export async function GET(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.role !== "ADMIN") return new Response("Not found", { status: 404 });
  const { lessonId } = await params;
  const brief = await buildLessonBrief(lessonId);
  if (!brief) return new Response("Not found", { status: 404 });
  return new Response(brief.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${brief.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
