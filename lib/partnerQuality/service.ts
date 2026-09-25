import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerQualityLeadResult, PartnerQualityMetric, PartnerQualityPeriod, PartnerQualityReport, PartnerQualityTeamGroup } from "./types";
import { PARTNER_QUALITY_METRICS } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertPartnerQualityUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

export function assertPartnerQualityDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !DATE.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a real calendar date`);
  return value;
}

function page(value: unknown, fallback: number, max: number) {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isInteger(result) && result > 0 ? Math.min(max, result) : fallback;
}

function metric(value: unknown): PartnerQualityMetric {
  if (typeof value !== "string" || !PARTNER_QUALITY_METRICS.includes(value as PartnerQualityMetric)) throw new Error("Choose a valid quality metric");
  return value as PartnerQualityMetric;
}

function normalizeReport(value: unknown, readOnly: boolean): PartnerQualityReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The partner quality report was invalid");
  const report = value as Omit<PartnerQualityReport, "readOnly">;
  return { ...report, rows: Array.isArray(report.rows) ? report.rows : [], dispositions: Array.isArray(report.dispositions) ? report.dispositions : [], team: Array.isArray(report.team) ? report.team : [], readOnly };
}

type QualityEvidence = {
  lead_id: string;
  partner_id: string;
  screening_outcome: string | null;
  screening_result_outcome: string | null;
  claimed: boolean;
  worked: boolean;
  submitted: boolean;
  duplicate: boolean;
  disposition: string | null;
};

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

function percentValue(value: number, total: number) {
  return total ? Math.round((value * 1000) / total) / 10 : null;
}

function periodFor(evidence: QualityEvidence[]): PartnerQualityPeriod {
  const sent = evidence.length;
  const claimed = evidence.filter((row) => row.claimed).length;
  const worked = evidence.filter((row) => row.worked).length;
  const submitted = evidence.filter((row) => row.submitted).length;
  const disqualified = evidence.filter((row) => row.screening_outcome === "internal_dq").length;
  const duplicates = evidence.filter((row) => row.duplicate).length;
  return {
    sent,
    claimed,
    worked,
    submitted,
    conversion_rate: percentValue(submitted, sent),
    disqualification_rate: percentValue(disqualified, sent),
    duplicate_rate: percentValue(duplicates, sent),
    screening: {
      tcpa: evidence.filter((row) => row.screening_result_outcome === "tcpa_litigator").length,
      dnc: evidence.filter((row) => row.screening_result_outcome === "dnc" || row.screening_outcome === "dnc").length,
      invalid: evidence.filter((row) => row.screening_result_outcome === "invalid_phone").length,
    },
  };
}

async function loadTeamMetrics(tenantId: string, report: PartnerQualityReport): Promise<PartnerQualityTeamGroup[]> {
  const partnerIds = report.rows.map((row) => row.partner_id);
  if (!partnerIds.length) return [];
  const db = getSupabaseServiceClient();
  const [memberships, currentEvidence, previousEvidence] = await Promise.all([
    db.from("partner_users").select("id, user_id, partner_id, role, status, invited_at, accepted_at, deactivated_at, partner_admin_user_id").eq("tenant_id", tenantId).in("partner_id", partnerIds).order("invited_at", { ascending: true }),
    db.rpc("partner_quality_evidence", { p_tenant_id: tenantId, p_from_date: report.from, p_to_date: report.to }),
    db.rpc("partner_quality_evidence", { p_tenant_id: tenantId, p_from_date: report.previous_from, p_to_date: report.previous_to }),
  ]);
  if (memberships.error) throw new Error(`Could not load partner hierarchy: ${memberships.error.message}`);
  if (currentEvidence.error || previousEvidence.error) throw new Error(`Could not load partner hierarchy metrics: ${currentEvidence.error?.message ?? previousEvidence.error?.message}`);
  const memberRows = (memberships.data ?? []) as TeamMembership[];
  const userIds = [...new Set(memberRows.map((member) => member.user_id))];
  const users = userIds.length ? await db.from("users").select("id, name, email").in("id", userIds) : { data: [], error: null };
  if (users.error) throw new Error(`Could not load partner hierarchy users: ${users.error.message}`);
  const userById = new Map((users.data ?? []).map((user) => [user.id, user]));
  const current = (currentEvidence.data ?? []) as QualityEvidence[];
  const previous = (previousEvidence.data ?? []) as QualityEvidence[];
  const allLeadIds = [...new Set([...current, ...previous].map((row) => row.lead_id))];
  const owners = allLeadIds.length ? await db.from("agent_leads").select("id, created_by").eq("tenant_id", tenantId).in("id", allLeadIds) : { data: [], error: null };
  if (owners.error) throw new Error(`Could not load partner hierarchy lead ownership: ${owners.error.message}`);
  const ownerByLeadId = new Map((owners.data ?? []).map((lead) => [lead.id, lead.created_by as string | null]));
  const groups = new Map(report.rows.map((row) => [row.partner_id, { partner_id: row.partner_id, partner_name: row.partner_name, admins: [], users: [], unassigned: [] } as PartnerQualityTeamGroup]));
  const adminsById = new Map(memberRows.filter((member) => member.role === "partner_admin").map((member) => [member.user_id, userById.get(member.user_id)?.name ?? "Partner admin"]));

  for (const member of memberRows) {
    const account = userById.get(member.user_id);
    if (!account) continue;
    // The evidence RPC is intentionally partner-scoped. Join the submitting account from agent_leads
    // so the same governed metrics can be attributed to each partner admin/user.
    const ownedCurrent = current.filter((row) => row.partner_id === member.partner_id && ownerByLeadId.get(row.lead_id) === member.user_id);
    const ownedPrevious = previous.filter((row) => row.partner_id === member.partner_id && ownerByLeadId.get(row.lead_id) === member.user_id);
    const metrics = periodFor(ownedCurrent);
    const previousMetrics = periodFor(ownedPrevious);
    const group = groups.get(member.partner_id);
    if (!group) continue;
    const entry = { ...member, ...metrics, name: account.name, email: account.email, partner_admin_name: member.partner_admin_user_id ? adminsById.get(member.partner_admin_user_id) ?? null : null, disqualified: ownedCurrent.filter((row) => row.screening_outcome === "internal_dq").length, duplicates: ownedCurrent.filter((row) => row.duplicate).length, previous: { ...previousMetrics } };
    if (member.role === "partner_admin") group.admins.push(entry);
    else if (member.partner_admin_user_id) group.users.push(entry);
    else group.unassigned.push(entry);
  }
  return [...groups.values()].map((group) => ({ ...group, users: group.users.sort((a, b) => a.name.localeCompare(b.name)), unassigned: group.unassigned.sort((a, b) => a.name.localeCompare(b.name)), admins: group.admins.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export async function listPartnerQuality(tenantId: string, filters: { from?: unknown; to?: unknown }, readOnly: boolean) {
  const from = filters.from == null || filters.from === "" ? null : assertPartnerQualityDate(filters.from, "From date");
  const to = filters.to == null || filters.to === "" ? null : assertPartnerQualityDate(filters.to, "To date");
  if (from && to && from > to) throw new Error("From date must be on or before To date");
  const { data, error } = await getSupabaseServiceClient().rpc("partner_quality_report", { p_tenant_id: tenantId, p_from_date: from, p_to_date: to });
  if (error) throw new Error(`Could not load partner quality: ${error.message}`);
  const report = normalizeReport(data, readOnly);
  return { ...report, team: await loadTeamMetrics(tenantId, report) };
}

export async function listPartnerQualityLeads(tenantId: string, filters: { from: unknown; to: unknown; partnerId: unknown; partnerUserId?: unknown; metric: unknown; disposition?: unknown; page?: unknown; pageSize?: unknown }) {
  const from = assertPartnerQualityDate(filters.from, "From date");
  const to = assertPartnerQualityDate(filters.to, "To date");
  if (from > to) throw new Error("From date must be on or before To date");
  const partnerId = assertPartnerQualityUuid(filters.partnerId, "partner");
  const partnerUserId = filters.partnerUserId == null || filters.partnerUserId === "" ? null : assertPartnerQualityUuid(filters.partnerUserId, "partner user");
  const selectedMetric = metric(filters.metric);
  const disposition = filters.disposition == null || filters.disposition === "" ? null : typeof filters.disposition === "string" && /^[a-z][a-z0-9_]{1,79}$/.test(filters.disposition) ? filters.disposition : (() => { throw new Error("Invalid disposition"); })();
  const { data, error } = await getSupabaseServiceClient().rpc("partner_quality_leads", { p_tenant_id: tenantId, p_from_date: from, p_to_date: to, p_partner_id: partnerId, p_metric: selectedMetric, p_disposition: disposition, p_page: page(filters.page, 1, 1000), p_page_size: page(filters.pageSize, 100, 1000) });
  if (error) throw new Error(`Could not load partner quality leads: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The partner quality drill-down was invalid");
  const result = data as Partial<PartnerQualityLeadResult>;
  const rows = (Array.isArray(result.rows) ? result.rows : []) as PartnerQualityLeadResult["rows"];
  const leadIds = rows.map((row) => row.lead_id).filter((id): id is string => UUID.test(id));
  if (!leadIds.length) return { metric: selectedMetric, partner_id: partnerId, total: typeof result.total === "number" ? result.total : 0, rows } as PartnerQualityLeadResult;
  const leadMeta = await getSupabaseServiceClient().from("agent_leads").select("id, product_line, values, created_by").eq("tenant_id", tenantId).in("id", leadIds);
  if (leadMeta.error) throw new Error(`Could not load partner quality lead details: ${leadMeta.error.message}`);
  const meta = new Map((leadMeta.data ?? []).map((lead) => {
    const values = lead.values && typeof lead.values === "object" && !Array.isArray(lead.values) ? lead.values as Record<string, unknown> : {};
    return [lead.id, { product: lead.product_line ?? values.product ?? values.product_name ?? null, state: values.state ?? values.state_code ?? values.residence_state ?? null, createdBy: lead.created_by as string | null }];
  }));
  const filteredRows = partnerUserId ? rows.filter((row) => meta.get(row.lead_id)?.createdBy === partnerUserId) : rows;
  return { metric: selectedMetric, partner_id: partnerId, total: partnerUserId ? filteredRows.length : (typeof result.total === "number" ? result.total : 0), rows: filteredRows.map((row) => ({ ...row, ...meta.get(row.lead_id) })) } as PartnerQualityLeadResult;
}
