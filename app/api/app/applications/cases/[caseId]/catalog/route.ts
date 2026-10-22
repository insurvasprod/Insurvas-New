import { NextResponse } from "next/server";

import { quoteCatalog } from "@/lib/applications/catalog";
import { db } from "@/lib/applications/db";
import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { clientStateOf } from "@/lib/applications/prefill";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guardCase } from "@/lib/agency/guards";

/** LA-3.4/3.6 · the carriers and products this agency can quote on this case, with appointment status for the client's state. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardCase(auth.context, caseId);
  if (hidden) return hidden;
  try {
    const kase = await db().from("tenant_application_cases").select("lead_id, product_line").eq("tenant_id", actor.tenantId).eq("id", caseId).maybeSingle();
    if (!kase.data) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
    // The state the application is written in: the insured's own address state on the case's latest
    // attempt (?insured=spouse for the spouse's), then the lead's state fields — each normalised.
    const role = new URL(request.url).searchParams.get("insured") === "spouse" ? "spouse" : "primary";
    const [lead, attempts] = await Promise.all([
      db().from("agent_leads").select("values").eq("tenant_id", actor.tenantId).eq("id", kase.data.lead_id).maybeSingle(),
      db().from("tenant_applications").select("id").eq("tenant_id", actor.tenantId).eq("case_id", caseId).eq("insured_role", role).order("attempt_no", { ascending: false }).limit(1),
    ]);
    const attemptId = (attempts.data as { id: string }[] | null)?.[0]?.id ?? null;
    const own = attemptId ? await db().from("tenant_application_values").select("value").eq("tenant_id", actor.tenantId).eq("application_id", attemptId).eq("field_key", "addr.state").maybeSingle() : { data: null };
    const state = clientStateOf((own.data as { value?: unknown } | null)?.value ?? null, (lead.data?.values ?? null) as Record<string, unknown> | null);
    return NextResponse.json(await quoteCatalog(actor.tenantId, state, kase.data.product_line ?? null));
  } catch (error) {
    return failure(error);
  }
}
