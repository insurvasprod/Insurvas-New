import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { runExistingCustomerPreflight } from "@/lib/existingCustomerPreflight/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { guardLead } from "@/lib/agency/guards";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { normalizePhone } from "@/lib/contacts/normalization";
import { LeadDuplicateConflictError, LeadDuplicatesNotReadyError, LEAD_DUPLICATES_PENDING, resolveLeadDuplicate } from "@/lib/leadDuplicates/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => null) as { action?: unknown; other_lead_id?: unknown } | null;
  if (body?.action === "same_person") return samePerson(request, (await params).id, body.other_lead_id);
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardLead(auth.context, (await params).id);
  if (hidden) return hidden;
  const leadId = (await params).id;
  if (!UUID.test(leadId)) return NextResponse.json({ error: "Choose a valid lead" }, { status: 400 });
  try {
    const lead = await getSupabaseServiceClient().from("agent_leads").select("id, values").eq("tenant_id", auth.context.tenantId).eq("id", leadId).maybeSingle();
    if (lead.error) throw new Error(`Could not load lead: ${lead.error.message}`);
    if (!lead.data) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const result = await runExistingCustomerPreflight({ tenantId: auth.context.tenantId, leadId, values: lead.data.values });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_preflight_rechecked", targetType: "agent_lead", targetId: leadId, metadata: { status: result.status, matchCount: result.matches.length }, request });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not re-check this lead" }, { status: 400 });
  }
}

type DbError = { message: string; code?: string } | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lead_duplicate_reviews is not in the generated types until 20261029600000
const loose = () => getSupabaseServiceClient() as any;
const MISSING_SCHEMA = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);
const missingSchema = (error: DbError) => Boolean(error && (MISSING_SCHEMA.has(error.code ?? "") || /schema cache|lead_duplicate_reviews/i.test(error.message ?? "")));
const PHONE_KEYS = ["phone", "phone_number", "primary_phone", "mobile_phone"];
function phoneOf(values: unknown): string | null {
  const v = values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, unknown> : {};
  for (const key of PHONE_KEYS) {
    const digits = normalizePhone(typeof v[key] === "string" ? v[key] as string : null);
    if (/^\d{10}$/.test(digits)) return digits;
  }
  return null;
}

/**
 * { action: "same_person", other_lead_id } — board D9's "Same person": the two leads are recorded as one
 * person, exactly as Clean's same-phone question answers a pair (lib/leadDuplicates: nothing is merged,
 * both leads stay with their owners, the answer is kept). Same gate as Clean (duplicate_detection;
 * owner, producer, assistant; not a narrowed agency session). When Clean already holds the question
 * for this pair it is answered there; otherwise the answer is recorded as an answered pair question.
 */
async function samePerson(request: NextRequest, leadId: string, other: unknown) {
  const auth = await requireFeatureRole("duplicate_detection", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Duplicate review");
  if (refused) return refused;
  const otherId = typeof other === "string" ? other : "";
  if (!UUID.test(leadId) || !UUID.test(otherId) || leadId === otherId) return NextResponse.json({ error: "Choose the two leads to link" }, { status: 400 });
  const tenantId = auth.context.tenantId;
  const leads = await getSupabaseServiceClient().from("agent_leads").select("id, values, created_at").eq("tenant_id", tenantId).in("id", [leadId, otherId]);
  if (leads.error) return NextResponse.json({ error: "Could not read the two leads" }, { status: 500 });
  if ((leads.data ?? []).length !== 2) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const [older, newer] = [...(leads.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const found = await loose().from("lead_duplicate_reviews").select("id, status")
    .eq("tenant_id", tenantId)
    .or(`and(lead_id.eq.${leadId},other_lead_id.eq.${otherId}),and(lead_id.eq.${otherId},other_lead_id.eq.${leadId})`)
    .limit(1);
  if (found.error) {
    if (missingSchema(found.error)) return NextResponse.json({ error: LEAD_DUPLICATES_PENDING }, { status: 503 });
    return NextResponse.json({ error: "Could not read this pair" }, { status: 500 });
  }
  const existing = (found.data ?? [])[0] as { id: string; status: string } | undefined;
  try {
    let reviewId: string;
    if (existing?.status === "same_person") return NextResponse.json({ reviewId: existing.id, linked: true, already: true });
    if (existing && existing.status !== "pending") return NextResponse.json({ error: "Someone already answered this one." }, { status: 409 });
    if (existing) {
      reviewId = (await resolveLeadDuplicate(tenantId, auth.context.userId, existing.id, "same_person")).id;
    } else {
      const phone = phoneOf(older.values) ?? phoneOf(newer.values);
      if (!phone) return NextResponse.json({ error: "These two leads have no phone number to record them by." }, { status: 400 });
      const at = new Date().toISOString();
      const inserted = await loose().from("lead_duplicate_reviews")
        .insert({ tenant_id: tenantId, lead_id: older.id, other_lead_id: newer.id, phone, status: "same_person", resolved_at: at, resolved_by: auth.context.userId })
        .select("id").single();
      if (inserted.error) {
        if (missingSchema(inserted.error)) return NextResponse.json({ error: LEAD_DUPLICATES_PENDING }, { status: 503 });
        // The pair index: someone recorded this pair a moment ago.
        if (inserted.error.code === "23505") return NextResponse.json({ error: "Someone already answered this one." }, { status: 409 });
        return NextResponse.json({ error: "Could not record the answer" }, { status: 500 });
      }
      reviewId = inserted.data.id as string;
    }
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_duplicate_resolved", targetType: "lead_duplicate_review", targetId: reviewId, metadata: { decision: "same_person", leadId: older.id, otherLeadId: newer.id, source: "lead_page" }, request });
    return NextResponse.json({ reviewId, linked: true });
  } catch (error) {
    if (error instanceof LeadDuplicatesNotReadyError) return NextResponse.json({ error: error.message }, { status: 503 });
    const status = error instanceof LeadDuplicateConflictError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save this answer" }, { status });
  }
}
