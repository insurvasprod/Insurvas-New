import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { assertPartnerQualityDate, assertPartnerQualityUuid } from "./service";
import { dailyVolume, defaultPartnerQualityPeriod, dispositionBreakdown, percentOf, periodMetrics, previousPartnerQualityPeriod, screeningLabel } from "./metrics";
import type { PartnerQualityAgentRow, PartnerQualityDetail, PartnerQualityDetailLead, PartnerQualityEvidence, PartnerQualityMember, PartnerQualityPeriod, PartnerQualityPeriodMetrics } from "./types";

// One partner, every figure: the /app/partner-quality/[partnerId] page. Everything is counted from
// partner_quality_evidence — the same rows the list's partner_quality_report aggregates — so a
// figure here always equals the partner's row on the list for the same period. No cost data.

/** A partner id that does not belong to the caller's tenant. The route answers 404. */
export class PartnerQualityNotFoundError extends Error {}

const EVIDENCE_PAGE = 1000;
const EVIDENCE_MAX = 20_000;
const DETAIL_LEAD_LIMIT = 5_000;
const IN_CHUNK = 200;

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;

type TeamMembership = {
  id: string;
  user_id: string;
  partner_id: string;
  role: "partner_admin" | "partner_user";
  status: "active" | "revoked";
  invited_at: string;
  accepted_at: string | null;
  deactivated_at: string | null;
  partner_admin_user_id: string | null;
};

/** partner_quality_evidence is tenant-wide; filter it to one partner in PostgREST and page past max-rows. */
async function partnerEvidence(db: ServiceClient, tenantId: string, partnerId: string, from: string, to: string): Promise<PartnerQualityEvidence[]> {
  const rows: PartnerQualityEvidence[] = [];
  for (let offset = 0; offset < EVIDENCE_MAX; offset += EVIDENCE_PAGE) {
    const { data, error } = await db
      .rpc("partner_quality_evidence", { p_tenant_id: tenantId, p_from_date: from, p_to_date: to })
      .eq("partner_id", partnerId)
      .order("lead_date", { ascending: false })
      .order("lead_id", { ascending: true })
      .range(offset, offset + EVIDENCE_PAGE - 1);
    if (error) throw new Error(`Could not load partner quality evidence: ${error.message}`);
    const page = (data ?? []) as PartnerQualityEvidence[];
    rows.push(...page);
    if (page.length < EVIDENCE_PAGE) break;
  }
  return rows;
}

/** Runs an `.in(ids)` lookup in chunks so a busy partner never builds an over-long query string. */
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

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolvePeriod(filters: { from?: unknown; to?: unknown }) {
  const fallback = defaultPartnerQualityPeriod();
  const to = filters.to == null || filters.to === "" ? fallback.to : assertPartnerQualityDate(filters.to, "To date");
  const from = filters.from == null || filters.from === "" ? fallback.from : assertPartnerQualityDate(filters.from, "From date");
  if (from > to) throw new Error("From date must be on or before To date");
  return { from, to };
}

/** The member shape the list page already uses: period figures without the detail-only extras. */
function memberPeriod(metrics: PartnerQualityPeriodMetrics): PartnerQualityPeriod {
  return { sent: metrics.sent, claimed: metrics.claimed, worked: metrics.worked, submitted: metrics.submitted, conversion_rate: metrics.conversion_rate, disqualification_rate: metrics.disqualification_rate, duplicate_rate: metrics.duplicate_rate, screening: metrics.screening };
}

type LeadMeta = { id: string; created_at: string | null; product_line: string | null; values: unknown; created_by: string | null };
type QueueMeta = { lead_id: string; status: string | null; claimed_by: string | null; owner_user_id: string | null; updated_at: string | null };
type DealMeta = { lead_id: string; disposition_by: string | null };

export async function getPartnerQualityDetail(tenantId: string, partnerIdValue: unknown, filters: { from?: unknown; to?: unknown }): Promise<PartnerQualityDetail> {
  const partnerId = assertPartnerQualityUuid(partnerIdValue, "partner");
  const { from, to } = resolvePeriod(filters);
  const previousPeriod = previousPartnerQualityPeriod(from, to);
  const db = getSupabaseServiceClient();

  const partner = await db.from("partners").select("id, name, partner_type, status").eq("tenant_id", tenantId).eq("id", partnerId).maybeSingle();
  if (partner.error) throw new Error(`Could not load the partner: ${partner.error.message}`);
  if (!partner.data) throw new PartnerQualityNotFoundError("This partner is not in your workspace");

  const [current, previous, memberships, dispositionRows] = await Promise.all([
    partnerEvidence(db, tenantId, partnerId, from, to),
    partnerEvidence(db, tenantId, partnerId, previousPeriod.from, previousPeriod.to),
    db.from("partner_users").select("id, user_id, partner_id, role, status, invited_at, accepted_at, deactivated_at, partner_admin_user_id").eq("tenant_id", tenantId).eq("partner_id", partnerId).order("invited_at", { ascending: true }),
    db.from("dispositions").select("disposition_key, label").eq("tenant_id", tenantId),
  ]);
  if (memberships.error) throw new Error(`Could not load the partner's users: ${memberships.error.message}`);

  const currentIds = current.map((row) => row.lead_id);
  const previousIds = previous.map((row) => row.lead_id);
  const [leadMeta, previousOwners, queueRows, dealRows] = await Promise.all([
    inChunks<LeadMeta>(currentIds, (chunk) => db.from("agent_leads").select("id, created_at, product_line, values, created_by").eq("tenant_id", tenantId).in("id", chunk), "lead details"),
    inChunks<{ id: string; created_by: string | null }>(previousIds, (chunk) => db.from("agent_leads").select("id, created_by").eq("tenant_id", tenantId).in("id", chunk), "prior lead owners"),
    inChunks<QueueMeta>(currentIds, (chunk) => db.from("lead_queue").select("lead_id, status, claimed_by, owner_user_id, updated_at").eq("tenant_id", tenantId).in("lead_id", chunk), "lead assignments"),
    inChunks<DealMeta>(currentIds, (chunk) => db.from("deal_flow").select("lead_id, disposition_by").eq("tenant_id", tenantId).in("lead_id", chunk), "worked leads"),
  ]);

  const metaById = new Map(leadMeta.map((lead) => [lead.id, lead]));
  const ownerById = new Map<string, string | null>();
  for (const lead of previousOwners) ownerById.set(lead.id, lead.created_by);
  for (const lead of leadMeta) ownerById.set(lead.id, lead.created_by);
  // A lead can be queued more than once (requeue); the latest row says who has it now.
  const queueByLead = new Map<string, QueueMeta>();
  for (const row of queueRows) {
    const seen = queueByLead.get(row.lead_id);
    if (!seen || String(row.updated_at ?? "") > String(seen.updated_at ?? "")) queueByLead.set(row.lead_id, row);
  }
  const dealByLead = new Map(dealRows.map((row) => [row.lead_id, row]));
  const agentFor = (leadId: string) => {
    const queue = queueByLead.get(leadId);
    return queue?.claimed_by ?? queue?.owner_user_id ?? dealByLead.get(leadId)?.disposition_by ?? null;
  };

  const memberRows = (memberships.data ?? []) as TeamMembership[];
  const memberIds = new Set(memberRows.map((member) => member.user_id));
  const agentIds = new Set(currentIds.map(agentFor).filter((id): id is string => Boolean(id)));
  const userIds = [...new Set([...agentIds, ...memberIds])];
  const users = await inChunks<{ id: string; name: string | null; email: string | null }>(userIds, (chunk) => db.from("users").select("id, name, email").in("id", chunk), "user names");
  const userById = new Map(users.map((user) => [user.id, user]));

  const leads: PartnerQualityDetailLead[] = current.slice(0, DETAIL_LEAD_LIMIT).map((row) => {
    const meta = metaById.get(row.lead_id);
    const values = meta?.values && typeof meta.values === "object" && !Array.isArray(meta.values) ? (meta.values as Record<string, unknown>) : {};
    const agentId = agentFor(row.lead_id);
    const createdBy = meta?.created_by ?? null;
    return {
      lead_id: row.lead_id,
      date: row.lead_date,
      received_at: meta?.created_at ?? null,
      full_name: row.full_name,
      phone: row.phone,
      state: textValue(values.state) ?? textValue(values.state_code) ?? textValue(values.residence_state),
      product: textValue(meta?.product_line) ?? textValue(values.product) ?? textValue(values.product_name),
      screening: screeningLabel(row),
      duplicate: row.duplicate,
      claimed: row.claimed,
      worked: row.worked,
      submitted: row.submitted,
      disposition: row.disposition,
      queue_status: queueByLead.get(row.lead_id)?.status ?? null,
      agent_id: agentId,
      agent_name: agentId ? userById.get(agentId)?.name ?? "Unknown user" : null,
      submitted_by: createdBy && memberIds.has(createdBy) ? userById.get(createdBy)?.name ?? null : null,
    };
  });

  // Our agents: every lead assigned to (or dispositioned by) someone, grouped by that person.
  const agentGroups = new Map<string, PartnerQualityEvidence[]>();
  for (const row of current) {
    const agentId = agentFor(row.lead_id);
    if (agentId) agentGroups.set(agentId, [...(agentGroups.get(agentId) ?? []), row]);
  }
  const agents: PartnerQualityAgentRow[] = [...agentGroups.entries()]
    .map(([userId, rows]) => {
      const metrics = periodMetrics(rows);
      return { user_id: userId, name: userById.get(userId)?.name ?? "Unknown user", leads: metrics.sent, worked: metrics.worked, submitted: metrics.submitted, conversion_rate: percentOf(metrics.submitted, metrics.sent) };
    })
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));

  // The partner's own accounts, each with the leads they personally submitted (agent_leads.created_by).
  const adminNames = new Map(memberRows.filter((member) => member.role === "partner_admin").map((member) => [member.user_id, userById.get(member.user_id)?.name ?? "Partner admin"]));
  const team: PartnerQualityMember[] = memberRows
    .flatMap((member) => {
      const account = userById.get(member.user_id);
      if (!account) return [];
      const owned = periodMetrics(current.filter((row) => ownerById.get(row.lead_id) === member.user_id));
      const ownedPrevious = periodMetrics(previous.filter((row) => ownerById.get(row.lead_id) === member.user_id));
      return [{
        ...member,
        ...memberPeriod(owned),
        name: account.name ?? "Unnamed user",
        email: account.email ?? "",
        partner_admin_name: member.partner_admin_user_id ? adminNames.get(member.partner_admin_user_id) ?? null : null,
        disqualified: owned.disqualified,
        duplicates: owned.duplicates,
        previous: memberPeriod(ownedPrevious),
      }];
    })
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "partner_admin" ? -1 : 1) || b.sent - a.sent || a.name.localeCompare(b.name));
  const unattributed = periodMetrics(current.filter((row) => {
    const owner = ownerById.get(row.lead_id);
    return !owner || !memberIds.has(owner);
  }));

  const labels: Record<string, string> = {};
  if (!dispositionRows.error) {
    for (const row of (dispositionRows.data ?? []) as { disposition_key: string; label: string | null }[]) if (row.label) labels[row.disposition_key] = row.label;
  }

  return {
    partner: { id: partner.data.id, name: partner.data.name, partner_type: partner.data.partner_type ?? null, status: partner.data.status ?? null },
    from,
    to,
    previous_from: previousPeriod.from,
    previous_to: previousPeriod.to,
    current: periodMetrics(current),
    previous: periodMetrics(previous),
    leads,
    leads_truncated: current.length > leads.length,
    dispositions: dispositionBreakdown(current),
    disposition_labels: labels,
    daily: dailyVolume(current, from, to),
    team,
    unattributed,
    agents,
  };
}
