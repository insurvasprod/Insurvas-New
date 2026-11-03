import { NextResponse, type NextRequest } from "next/server";

import { findPartnerLeadDuplicates, getPartnerTemplateForProduct } from "@/lib/agentTemplates/service";
import { screenPartnerPhone } from "@/lib/compliance/screening";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPhoneTemplateField } from "@/lib/templates/constants";

/**
 * The duplicate check the readiness panel shows before submit (p-par-submit-lead, "Duplicate
 * check · No match"). Submit repeats it and stays the authority.
 *
 * It answers whether this person matches an existing lead, on what, and when the newest match was
 * submitted, never which lead (see latestMatchFacts for what else is told, and to whom). The number is
 * screened first, exactly as submit does, so this cannot look up a number the form could not send.
 */
/**
 * When the newest matching lead was submitted and whether this partner's own team sent it. Its
 * outcome is told only then: another partner's pipeline, its name and its results stay private, so
 * a match from elsewhere reads "from another source" with a date and nothing more.
 */
async function latestMatchFacts(tenantId: string, partnerId: string, leadIds: string[]) {
  const db = getSupabaseServiceClient();
  const leads = await db.from("agent_leads").select("id, created_at, partner_id").eq("tenant_id", tenantId).in("id", leadIds.slice(0, 20)).order("created_at", { ascending: false }).limit(1);
  const lead = leads.data?.[0];
  if (leads.error || !lead) return null;
  const yours = lead.partner_id === partnerId;
  let outcome: string | null = null;
  if (yours) {
    const item = await db.from("lead_queue").select("disposition").eq("tenant_id", tenantId).eq("lead_id", lead.id).maybeSingle();
    // The key, spelled out. The agency's disposition configuration is not the partner plane's to read
    // (planeIsolation.test.mjs), so its custom labels are not used here.
    const key = item.data?.disposition ?? null;
    if (key) outcome = key.replaceAll("_", " ");
  }
  return { submittedAt: lead.created_at as string, yours, outcome };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ productCode: string }> }) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (auth.context.partnerStatus !== "active") return NextResponse.json({ error: "This partner is paused and cannot submit new leads" }, { status: 403 });
  const productCode = (await params).productCode;
  const body = await request.json().catch(() => null) as { values?: unknown } | null;
  const values = body?.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : null;
  if (!values) return NextResponse.json({ error: "Send the form values to check" }, { status: 400 });
  try {
    const { tenantId, partnerId, userId } = auth.context;
    await assertPartnerProductApproved(tenantId, partnerId, productCode);
    const template = await getPartnerTemplateForProduct(tenantId, partnerId, userId, productCode);
    const phoneField = template.template.fields.find(isPhoneTemplateField);
    const screening = await screenPartnerPhone({ tenantId, partnerId, userId, phone: phoneField ? values[phoneField.field_key] : undefined });
    if (!screening.allowed) return NextResponse.json({ checked: false }, { headers: { "Cache-Control": "no-store" } });
    const matches = await findPartnerLeadDuplicates(tenantId, values, template.template.fields);
    const latest = matches.length ? await latestMatchFacts(tenantId, partnerId, matches.map((match) => match.leadId)).catch(() => null) : null;
    return NextResponse.json({ checked: true, matched: matches.length > 0, matchedOn: [...new Set(matches.flatMap((match) => match.matchedOn))], latest }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "partner_product_not_approved" || message === "product_not_enabled") return NextResponse.json({ error: "This partner is not approved for that product" }, { status: 403 });
    return NextResponse.json({ error: "The duplicate check is unavailable right now" }, { status: 503 });
  }
}
