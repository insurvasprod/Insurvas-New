import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { bestEvidence, type EvidenceArtefact, type EvidenceFilter, type EvidenceLevel } from "@/lib/consent/evidence";
import { getConsentEvidence } from "@/lib/consent/evidenceService";

/**
 * A consent record's surroundings (Compliance round 7, board 3·1): the lead behind it (name, phone, who provided
 * it, its best evidence) and the leads either side of it in the list's own order. Reads only; the same tables
 * and rules the list reads (lib/consent/evidenceService.ts).
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Q = PromiseLike<Result> & { eq(c: string, v: unknown): Q; in(c: string, v: string[]): Q; maybeSingle(): Promise<Result> };
type Db = { from(table: string): { select(columns: string): Q } };
const db = () => getSupabaseServiceClient() as unknown as Db;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type ConsentLead = {
  leadId: string;
  name: string;
  phone: string | null;
  providerName: string;
  level: EvidenceLevel;
  /** The lead's best certificate, when it has one: the record lives at its id. */
  artefactId: string | null;
};

/** The lead and its best evidence, by the list's rules (partner, then vendor, then campaign, else "Direct"). Null when not in this tenant. */
export async function consentLead(tenantId: string, leadId: string): Promise<ConsentLead | null> {
  const read = await db().from("agent_leads")
    .select("id, partner_id, campaign_id, values, all:tenant_consent_artefacts(id, capture_status, ip, consent_timestamp, captured_at, provider)")
    .eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  if (read.error || !read.data) return null;
  const lead = read.data as Row & { all?: EvidenceArtefact[] };
  const values = (lead.values ?? {}) as Row;
  const name = [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") || text(values.full_name) || text(values.name) || "Unnamed lead";
  const phone = text(values.phone) || text(values.phone_number) || text(values.mobile) || null;
  const best = bestEvidence(lead.all ?? []);
  const partnerId = text(lead.partner_id);
  const campaignId = text(lead.campaign_id);

  const [partner, campaign, attestation] = await Promise.all([
    partnerId ? db().from("partners").select("name").eq("tenant_id", tenantId).eq("id", partnerId).maybeSingle() : null,
    campaignId ? db().from("tenant_campaigns").select("name, vendor_id").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle() : null,
    // As the list: a partner's lead with no certificate may carry the partner's attestation on its submission entry.
    partnerId && best.level === "none" ? db().from("audit_log").select("metadata").eq("action", "tenant.partner_lead_submitted").eq("target_id", leadId) : null,
  ]);
  const campaignRow = (campaign && !campaign.error ? campaign.data : null) as { name?: string; vendor_id?: string | null } | null;
  const vendor = campaignRow?.vendor_id ? await db().from("tenant_lead_vendors").select("name").eq("tenant_id", tenantId).eq("id", campaignRow.vendor_id).maybeSingle() : null;
  const providerName = text((partner?.data as Row | null)?.name) || text((vendor?.data as Row | null)?.name) || text(campaignRow?.name) || "Direct";
  const attested = ((attestation && !attestation.error ? attestation.data : []) as Array<{ metadata: { consentAttestedAt?: string; replayed?: boolean } | null }>)
    .some((entry) => entry.metadata?.consentAttestedAt && !entry.metadata.replayed);

  return { leadId: text(lead.id), name, phone, providerName, level: attested ? "attested" : best.level, artefactId: best.artefact?.id ?? null };
}

/**
 * The list the ‹ › walk: the list's default order (newest lead first, the evidence filter it was opened with) over
 * its first 50 leads, the most a page of the list shows. A lead further down has no ‹ ›.
 */
export async function consentWindow(tenantId: string, evidence: EvidenceFilter): Promise<Array<{ leadId: string; name: string; artefactId: string | null }>> {
  try {
    return (await getConsentEvidence({ tenantId, filter: evidence, sources: [], page: 0, pageSize: 50 })).rows;
  } catch {
    return [];
  }
}
