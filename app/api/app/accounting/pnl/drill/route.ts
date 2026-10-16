import { NextResponse, type NextRequest } from "next/server";

import { resolvePeriod } from "@/lib/accounting/pnlCore";
import { drill, PnlError, reportingSettings } from "@/lib/accounting/pnlStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.7 (Notion sprint) · the entries behind one P&L line, each linked to its source document —
 * a figure nobody can open is a figure nobody acts on. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = ["in", "held", "acquisition", "overhead", "splits"] as const;
const SOURCES = ["partner", "vendor", "expense_category"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  const q = request.nextUrl.searchParams;
  const section = SECTIONS.find((s) => s === q.get("section"));
  const entryType = q.get("entry_type") ?? "";
  const sourceType = SOURCES.find((s) => s === q.get("source_type")) ?? null;
  const sourceId = q.get("source_id");
  if (!section || !/^[a-z_]{2,40}$/.test(entryType) || (sourceId && !UUID.test(sourceId))) return NextResponse.json({ error: "Unknown line." }, { status: 400 });
  try {
    const settings = await reportingSettings(tenantId);
    const period = resolvePeriod({ kind: q.get("kind"), anchor: q.get("anchor"), from: q.get("from"), to: q.get("to"), basis: q.get("basis") }, { basis: settings.basis, fyStartMonth: settings.fyStartMonth, today: new Date().toISOString().slice(0, 10) });
    if ("error" in period) return NextResponse.json({ error: period.error }, { status: 400 });
    const result = await drill(tenantId, { range: period.range, basis: period.basis, section, entryType, sourceType, sourceId, category: q.get("category"), page: Math.max(0, Number(q.get("page") ?? 0) || 0) });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PnlError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[pnl]", error);
    return NextResponse.json({ error: "The entries could not be loaded" }, { status: 500 });
  }
}
