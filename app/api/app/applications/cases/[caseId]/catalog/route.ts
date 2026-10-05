import { NextResponse } from "next/server";

import { quoteCatalog } from "@/lib/applications/catalog";
import { db } from "@/lib/applications/db";
import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.4/3.6 · the carriers and products this agency can quote on this case, with appointment status for the client's state. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  try {
    const kase = await db().from("tenant_application_cases").select("lead_id, product_line").eq("tenant_id", actor.tenantId).eq("id", caseId).maybeSingle();
    if (!kase.data) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
    const lead = await db().from("agent_leads").select("values").eq("tenant_id", actor.tenantId).eq("id", kase.data.lead_id).maybeSingle();
    const state = typeof lead.data?.values?.state === "string" ? String(lead.data.values.state).toUpperCase() : null;
    return NextResponse.json(await quoteCatalog(actor.tenantId, state, kase.data.product_line ?? null));
  } catch (error) {
    return failure(error);
  }
}
