import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerQualityEvidence } from "./types";

// partner_quality_evidence, and the same rows read with indexed lookups when the SQL function times out.
//
// The SQL function finds the screening-audit fallback for each lead with a correlated subquery that
// has no index to use (screening_audit is indexed by organization only) and re-evaluates the phone
// expression for every audit row it scans, so a month of the demo tenant's leads took 2-9 s and
// often hit the statement timeout (LA-1.18: /app/partner-quality answered "canceling statement due
// to statement timeout"). This reads the same rows with the same rules:
//
//   leads         agent_leads of the tenant with a partner, created in [from, to] in fixed EST (UTC-5)
//   lead_date     created_at in UTC-5, as a date
//   full_name     values.full_name, else values.name, else "Unnamed lead"
//   phone         values.phone, else values.phone_number
//   screening_result_outcome
//                 the lead's screening_results row's outcome, else the latest screening_audit outcome
//                 for the same tenant, partner and last ten phone digits
//   claimed       its queue item was claimed at some point (claimed_at set or status not unclaimed)
//   worked        it has a deal-flow row
//   submitted     that row's call result is application_submitted
//   duplicate     a duplicate override was justified
//   disposition   the deal-flow call result, else the queue item's disposition
//
// 20260925709730 (pending) indexes screening_audit by tenant and phone, which also speeds this read.

const PAGE = 1000;
const MAX_LEADS = 50_000;
const IN_CHUNK = 200;
const EST_OFFSET_MS = 5 * 60 * 60 * 1000;

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;
type LeadRow = { id: string; partner_id: string; created_at: string; values: unknown; screening_outcome: string | null; screening_result_id: string | null; duplicate_override_justification: string | null };

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** `values->>'key'`: a string as is, any other JSON value as its JSON text, absent as null. */
function jsonText(values: unknown, key: string): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const value = (values as Record<string, unknown>)[key];
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function nonEmpty(value: string | null) { return value === null || value === "" ? null : value; }

async function inChunks<T>(ids: string[], lookup: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += IN_CHUNK) chunks.push(ids.slice(index, index + IN_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => lookup(chunk)));
  const rows: T[] = [];
  for (const result of results) {
    if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
    rows.push(...((result.data ?? []) as T[]));
  }
  return rows;
}

async function leadsInPeriod(db: ServiceClient, tenantId: string, from: string, to: string, partnerId?: string): Promise<LeadRow[]> {
  const rows: LeadRow[] = [];
  for (let offset = 0; offset < MAX_LEADS; offset += PAGE) {
    let query = db
      .from("agent_leads")
      .select("id, partner_id, created_at, values, screening_outcome, screening_result_id, duplicate_override_justification")
      .eq("tenant_id", tenantId)
      .gte("created_at", `${from}T05:00:00Z`)
      .lt("created_at", `${shiftDate(to, 1)}T05:00:00Z`);
    query = partnerId ? query.eq("partner_id", partnerId) : query.not("partner_id", "is", null);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Could not load partner quality leads: ${error.message}`);
    const page = (data ?? []) as LeadRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Every partner lead of the tenant in [from, to] (fixed EST), optionally one partner's, with its evidence. */
export async function loadPartnerQualityEvidence(tenantId: string, from: string, to: string, partnerId?: string): Promise<PartnerQualityEvidence[]> {
  const db = getSupabaseServiceClient();
  const leads = await leadsInPeriod(db, tenantId, from, to, partnerId);
  if (!leads.length) return [];
  const leadIds = leads.map((lead) => lead.id);
  const resultIds = [...new Set(leads.map((lead) => lead.screening_result_id).filter((id): id is string => Boolean(id)))];
  const [queue, deals, results] = await Promise.all([
    inChunks<{ lead_id: string; status: string; claimed_at: string | null; disposition: string | null; updated_at: string; created_at: string }>(leadIds, (chunk) => db.from("lead_queue").select("lead_id, status, claimed_at, disposition, updated_at, created_at").eq("tenant_id", tenantId).in("lead_id", chunk), "partner quality queue items"),
    inChunks<{ lead_id: string; call_result: string | null; updated_at: string; created_at: string }>(leadIds, (chunk) => db.from("deal_flow").select("lead_id, call_result, updated_at, created_at").eq("tenant_id", tenantId).in("lead_id", chunk), "partner quality deal flow"),
    inChunks<{ id: string; outcome: string | null }>(resultIds, (chunk) => db.from("screening_results").select("id, outcome").eq("tenant_id", tenantId).in("id", chunk), "partner quality screening results"),
  ]);
  const outcomeByResult = new Map(results.map((row) => [row.id, row.outcome]));
  const phoneOf = (lead: LeadRow) => jsonText(lead.values, "phone") ?? jsonText(lead.values, "phone_number");
  const digitsOf = (lead: LeadRow) => (phoneOf(lead) ?? "").replace(/[^0-9]/g, "").slice(-10);

  // The audit fallback, only for leads whose screening result says nothing.
  const needAudit = leads.filter((lead) => !(lead.screening_result_id && outcomeByResult.get(lead.screening_result_id)));
  const digits = [...new Set(needAudit.map(digitsOf))];
  const audits = digits.length
    ? await inChunks<{ partner_id: string | null; phone_digits: string; outcome: string | null; ts: string }>(digits, (chunk) => db.from("screening_audit").select("partner_id, phone_digits, outcome, ts").eq("tenant_id", tenantId).in("phone_digits", chunk), "partner quality screening audit")
    : [];
  const latestAudit = new Map<string, { outcome: string | null; ts: number }>();
  for (const audit of audits) {
    const key = `${audit.partner_id}|${audit.phone_digits}`;
    const ts = Date.parse(audit.ts);
    const seen = latestAudit.get(key);
    if (!seen || ts > seen.ts) latestAudit.set(key, { outcome: audit.outcome, ts });
  }

  const latest = <T extends { updated_at: string; created_at: string }>(rows: T[]) =>
    rows.reduce<T | null>((best, row) => (!best || row.updated_at > best.updated_at || (row.updated_at === best.updated_at && row.created_at > best.created_at) ? row : best), null);
  const queueByLead = new Map<string, typeof queue>();
  for (const row of queue) queueByLead.set(row.lead_id, [...(queueByLead.get(row.lead_id) ?? []), row]);
  const dealsByLead = new Map<string, typeof deals>();
  for (const row of deals) dealsByLead.set(row.lead_id, [...(dealsByLead.get(row.lead_id) ?? []), row]);

  return leads.map((lead): PartnerQualityEvidence => {
    const items = queueByLead.get(lead.id) ?? [];
    const leadDeals = dealsByLead.get(lead.id) ?? [];
    const resultOutcome = lead.screening_result_id ? outcomeByResult.get(lead.screening_result_id) ?? null : null;
    const dealDisposition = leadDeals.length ? latest(leadDeals)?.call_result ?? null : null;
    return {
      lead_id: lead.id,
      partner_id: lead.partner_id,
      lead_date: new Date(Date.parse(lead.created_at) - EST_OFFSET_MS).toISOString().slice(0, 10),
      full_name: nonEmpty(jsonText(lead.values, "full_name")) ?? nonEmpty(jsonText(lead.values, "name")) ?? "Unnamed lead",
      phone: phoneOf(lead),
      screening_outcome: lead.screening_outcome,
      screening_result_outcome: resultOutcome ?? latestAudit.get(`${lead.partner_id}|${digitsOf(lead)}`)?.outcome ?? null,
      claimed: items.some((item) => item.claimed_at !== null || item.status !== "unclaimed"),
      worked: leadDeals.length > 0,
      submitted: leadDeals.some((deal) => deal.call_result === "application_submitted"),
      duplicate: lead.duplicate_override_justification !== null,
      disposition: dealDisposition ?? (items.length ? latest(items)?.disposition ?? null : null),
    };
  });
}

/**
 * The evidence rows, from partner_quality_evidence (the SQL source of truth, one read per period),
 * falling back to the indexed reads above when the database cancels that statement on its timeout
 * (57014). Both return the same rows: checked lead by lead against the function on 2026-09-30.
 */
export async function partnerQualityEvidence(tenantId: string, from: string, to: string, partnerId?: string): Promise<PartnerQualityEvidence[]> {
  const db = getSupabaseServiceClient();
  const rows: PartnerQualityEvidence[] = [];
  for (let offset = 0; offset < MAX_LEADS; offset += PAGE) {
    let query = db.rpc("partner_quality_evidence", { p_tenant_id: tenantId, p_from_date: from, p_to_date: to });
    if (partnerId) query = query.eq("partner_id", partnerId);
    const { data, error } = await query.order("lead_id", { ascending: true }).range(offset, offset + PAGE - 1);
    if (error) {
      if (error.code === "57014" || /statement timeout/i.test(error.message)) return loadPartnerQualityEvidence(tenantId, from, to, partnerId);
      throw new Error(`Could not load partner quality: ${error.message}`);
    }
    const page = (data ?? []) as PartnerQualityEvidence[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}
