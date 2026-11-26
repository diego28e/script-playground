import { boardContext } from "@/lib/board/context";
import { boardSecret, serviceSession } from "@/lib/board/token";

export const runtime = "nodejs";

// What the whiteboard teacher is told about a session (docs/whiteboard-contract.md, "The context"). Asked by
// Didactra's server, with a service token for this session signed with BOARD_SECRET.

export async function GET(request: Request, { params }: { params: Promise<{ sid: string }> }) {
  const secret = boardSecret();
  if (!secret) return Response.json({ error: "The whiteboard isn't set up here." }, { status: 503 });
  const { sid } = await params;
  if (!serviceSession(secret, request.headers.get("authorization"), sid)) return Response.json({ error: "Not signed for this session." }, { status: 401 });
  const found = await boardContext(sid);
  if (!found) return Response.json({ error: "No such session." }, { status: 404 });
  if (found.closed) return Response.json({ error: "This session has ended." }, { status: 410 });
  return Response.json(found.context, { headers: { "Cache-Control": "no-store" } });
}
