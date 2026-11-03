import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { allMissingData, countMissingData, listMissingData, saveMissingData } from "@/lib/leadDuplicates/missingDataService";
import { MISSING_SAVE_LIMIT, missingDataCsv, missingFilterOf, type MissingEdits } from "@/lib/leadDuplicates/missingData";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

const CONTACT_ROLES = ["owner", "producer", "assistant"] as const;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Clean › Missing data. GET: a page of leads missing a phone, state, date of birth or address
 * (`?missing=any|phone|state|dob|address&campaign=<id>&page=&pageSize=`); `&format=csv` downloads every
 * filtered row with its lead id, for the fixed file the page reads back.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Missing data");
  if (refused) return refused;
  const params = request.nextUrl.searchParams;
  const filter = missingFilterOf(params.get("missing"));
  const campaign = params.get("campaign");
  const campaignId = campaign && UUID.test(campaign) ? campaign : null;
  try {
    // `?counts=1`: leads missing each field, head counts only; a count that cannot finish in time is null.
    if (params.get("counts") === "1") return NextResponse.json({ counts: await countMissingData(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
    if (params.get("format") === "csv") {
      const rows = await allMissingData(auth.context.tenantId, auth.context.userId, filter, campaignId);
      return new NextResponse(missingDataCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leads-missing-data.csv"`, "Cache-Control": "no-store" } });
    }
    const page = await listMissingData(auth.context.tenantId, auth.context.userId, { filter, campaignId, page: Number(params.get("page") ?? 0), pageSize: Number(params.get("pageSize") ?? 25) });
    return NextResponse.json({ ...page, readOnly: auth.entitlement.access !== "full" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load leads with missing data" }, { status: 500 });
  }
}

/** { edits: { [leadId]: { phone?, state?, dob?, address? } } }: each lead saved through the lead edit (phone screened). */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Missing data");
  if (refused) return refused;
  // A save edits leads, so it also needs what the lead edit route (PATCH /api/app/leads/[id]) needs.
  const leads = await requireFeatureRole("book_of_business", CONTACT_ROLES, { write: true });
  if (leads instanceof NextResponse) return leads;
  const body = await request.json().catch(() => null) as { edits?: unknown } | null;
  const edits = body?.edits;
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  if (Object.keys(edits).length > MISSING_SAVE_LIMIT) return NextResponse.json({ error: `Save at most ${MISSING_SAVE_LIMIT} leads at a time` }, { status: 400 });
  try {
    const result = await saveMissingData(auth.context.tenantId, auth.context.userId, edits as MissingEdits);
    for (const leadId of result.saved) {
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_missing_data_filled", targetType: "agent_lead", targetId: leadId, metadata: { columns: Object.keys((edits as MissingEdits)[leadId] ?? {}) }, request });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save" }, { status: 400 });
  }
}
