import { applyBoardEvent, BoardEvent } from "@/lib/board/events";
import { boardSecret, serviceSession } from "@/lib/board/token";

export const runtime = "nodejs";

// What Didactra tells the platform about a session (docs/whiteboard-contract.md, "The events"): one event per call,
// with a service token for this session signed with BOARD_SECRET.

const STATUS = { applied: 204, duplicate: 409, missing: 404, closed: 410 } as const;

export async function POST(request: Request, { params }: { params: Promise<{ sid: string }> }) {
  const secret = boardSecret();
  if (!secret) return Response.json({ error: "The whiteboard isn't set up here." }, { status: 503 });
  const { sid } = await params;
  if (!serviceSession(secret, request.headers.get("authorization"), sid)) return Response.json({ error: "Not signed for this session." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = BoardEvent.safeParse(body);
  if (!parsed.success) return Response.json({ error: `Not an event: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` }, { status: 400 });
  const result = await applyBoardEvent(sid, parsed.data);
  return result === "applied" ? new Response(null, { status: 204 }) : Response.json({ result }, { status: STATUS[result] });
}
