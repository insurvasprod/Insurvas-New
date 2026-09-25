import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { createAgentLead, getAgentTemplate, listAgentLeads } from "@/lib/agentTemplates/service";
import { listPipelines } from "@/lib/pipelines/service";
import { audit } from "@/lib/audit/log";
import { leadWorkFacts } from "@/lib/agentTemplates/leadWorkFacts";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

// LA-2.12. The book of business is the licensed agent's — it carries premiums, quotes and
// applications, which is the exact list a setter may not see. The setter is excluded by naming the
// four roles that already had this route rather than by narrowing it to ["owner"], so this change
// adds one refusal and takes nobody's access away.
const NOT_SETTER = ["owner", "producer", "assistant", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", NOT_SETTER);
  if (auth instanceof NextResponse) return auth;
  try {
    // Pipelines are tenant-scoped and don't depend on the template, so they load alongside it.
    const [template, pipelines] = await Promise.all([
      getAgentTemplate(auth.context.tenantId, auth.context.userId),
      listPipelines(auth.context.tenantId),
    ]);
    const params = request.nextUrl.searchParams;
    const direction = params.get("direction") === "desc" ? "desc" : "asc";
    const leads = await listAgentLeads(
      auth.context.tenantId,
      template,
      params.get("q")?.trim() ?? "",
      params.get("filter_field") ?? "",
      params.get("filter_value") ?? "",
      params.get("sort") ?? "",
      direction,
    );
    // Who holds each lead, and — for roles that may see money — what it was quoted at. The board's
    // Unassigned and annualised figures are counted from these, not stored.
    const money = hasTenantPermission(auth.context.role, "money.view");
    const facts = await leadWorkFacts(auth.context.tenantId, leads.map((lead) => lead.id), money);
    const enriched = leads.map((lead) => {
      const fact = facts.get(lead.id);
      return { ...lead, owner_user_id: fact?.ownerUserId ?? null, owner_name: fact?.ownerName ?? null, disposition: fact?.disposition ?? null, disposition_at: fact?.dispositionAt ?? null, stage_entered_at: fact?.stageEnteredAt ?? null, monthly_premium_cents: money ? fact?.monthlyPremiumCents ?? null : null };
    });
    // `role` travels with the payload so the workspace can decide what to OFFER, not just what to
    // allow. Stage and pipeline editing is owner-only (LA-1.9 criterion 1), and a producer shown an
    // "Edit stages" button would get a 403 from a control that looked available — the same dead-end
    // this audit has been removing elsewhere. The API remains the enforcement; this is the label.
    return NextResponse.json({ template, leads: enriched, pipelines, role: auth.context.role, currentUserId: auth.context.userId, money, readOnly: auth.entitlement.access === "read_only" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load leads" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", NOT_SETTER, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { values?: unknown; stage_id?: string; stage_key?: string } | null;
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const lead = await createAgentLead(auth.context.tenantId, auth.context.userId, template, body?.values, body?.stage_id ?? body?.stage_key);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: lead.id, metadata: { operation: "created", stageId: lead.stage_id }, request });
    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create lead" }, { status: 400 });
  }
}
