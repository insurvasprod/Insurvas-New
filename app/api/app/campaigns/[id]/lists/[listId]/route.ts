import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { EARLIER, LIST_VIEWS, leadsOfList, type ListView } from "@/lib/campaigns/lists";
import { csvCell } from "@/lib/csv/cell";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;
/** CSV rows end in CRLF, as spreadsheet apps expect. */
const CRLF = String.fromCharCode(13, 10);

/** One page of a list's leads — Source › a campaign › a list (LirF2). `?view=all|not_called|problems&q=&page=` */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; listId: string }> }) {
  const auth = await requireFeatureRole("outbound_dialing", ["owner", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Vendors & campaigns");
  if (refused) return refused;
  const { id, listId } = await params;
  if (!UUID.test(id) || (listId !== EARLIER && !UUID.test(listId))) return NextResponse.json({ error: "List not found" }, { status: 404 });
  const search = request.nextUrl.searchParams;
  const view = LIST_VIEWS.includes(search.get("view") as ListView) ? search.get("view") as ListView : "all";
  const page = Math.max(0, Math.floor(Number(search.get("page") ?? 0) || 0));
  const q = (search.get("q") ?? "").slice(0, 80);
  try {
    // `?format=csv`: the list's leads in the chosen view, every page (a list is at most 20,000 rows).
    if (search.get("format") === "csv") {
      const rows: string[] = ["name,phone,state,status,attempts,agent"];
      let fileName = "list";
      for (let at = 0; at < 20; at += 1) {
        const chunk = await leadsOfList(auth.context.tenantId, id, listId, { view, q, page: at, pageSize: 1000 });
        if (!chunk) return NextResponse.json({ error: "List not found" }, { status: 404 });
        fileName = chunk.list.fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || "list";
        for (const lead of chunk.leads) rows.push([lead.name, lead.phone ?? "", lead.state ?? "", lead.leadState ?? "", String(lead.attempts), lead.agentName ?? ""].map(csvCell).join(","));
        if (chunk.leads.length < 1000) break;
      }
      return new NextResponse(rows.join(CRLF) + CRLF, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}-leads.csv"`, "Cache-Control": "no-store" } });
    }
    const result = await leadsOfList(auth.context.tenantId, id, listId, { view, q, page, pageSize: PAGE_SIZE });
    if (!result) return NextResponse.json({ error: "List not found" }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load this list" }, { status: 500 });
  }
}
