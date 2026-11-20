import { currentViewer } from "@/lib/viewer";
import { buildSpendReport, chargesCsv } from "@/lib/spend/report";

export const runtime = "nodejs";

// Admin → Spend's exports (docs/voice-spend.md), for a spreadsheet or an AI to read:
//   ?format=json   the whole report: totals, both providers' reconciliation, the breakdowns, every charge, a glossary;
//   ?format=csv    one row per billable call, with what it was billed and whether the provider's log has it.
// Admins only: the API routes aren't behind the admin area's middleware, so this checks itself.

export async function GET(request: Request) {
  const viewer = await currentViewer();
  if (viewer?.role !== "ADMIN") return Response.json({ error: "Only admins can export spend." }, { status: 403 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const report = await buildSpendReport(url.searchParams.get("month"));
  const name = `academia-voice-spend-${report.month}`;
  const headers = { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${name}.${format}"` };
  if (format === "csv") return new Response(chargesCsv(report), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  return new Response(JSON.stringify(report, null, 2), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}
