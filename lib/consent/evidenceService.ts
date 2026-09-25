import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { bestEvidence, consentGivenAt, type EvidenceArtefact, type EvidenceFilter, type EvidenceLevel } from "./evidence";

/**
 * The consent locker by lead (p-app-consent): every lead with the best evidence it has, including
 * the leads that have none — which the certificate list could never show, because they have no row
 * in it. Paginated in the database; the tiles are counted there too, over every lead, so a filter
 * changes what you are looking at and never what the figures say.
 */
export type EvidenceSource = "partner" | "vendor" | "direct";

export type EvidenceRow = {
  leadId: string;
  name: string;
  phone: string | null;
  providerName: string;
  captured: string;
  consentGivenAt: string | null;
  level: EvidenceLevel;
  artefactId: string | null;
  certificateId: string | null;
  ip: string | null;
};

export type EvidenceView = {
  rows: EvidenceRow[];
  total: number;
  page: number;
  pageSize: number;
  tiles: { leads: number; full: number; noIp: number; textMissing: number; oldestCapturedAt: string | null };
  coverage: Array<{ vendorId: string; vendorName: string; leads: number; claimedPct: number | null }>;
  coverageAvailable: boolean;
};

const ART = "id, capture_status, ip, consent_timestamp, captured_at, provider, certificate_id";
type LeadRow = { id: string; created_at: string; partner_id: string | null; campaign_id: string | null; values: Record<string, unknown> | null; all?: Array<EvidenceArtefact & { certificate_id: string | null }> };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
function leadName(values: Record<string, unknown> | null) {
  const v = values ?? {};
  return [text(v.first_name), text(v.last_name)].filter(Boolean).join(" ") || text(v.full_name) || text(v.name) || "Unnamed lead";
}
function leadPhone(values: Record<string, unknown> | null) {
  const v = values ?? {};
  return text(v.phone) || text(v.phone_number) || text(v.mobile) || null;
}
/** A search needle safe inside a PostgREST or(): no commas, parentheses or wildcards of its own. */
function needleOf(search: string | null | undefined) {
  return (search ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 80);
}

type Loose = {
  from(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): LooseQuery;
  };
};
type LooseQuery = PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null; count?: number | null }> & {
  eq(column: string, value: unknown): LooseQuery;
  is(column: string, value: null): LooseQuery;
  not(column: string, op: string, value: unknown): LooseQuery;
  in(column: string, values: string[]): LooseQuery;
  or(filters: string): LooseQuery;
  order(column: string, options: { ascending: boolean }): LooseQuery;
  range(from: number, to: number): LooseQuery;
  limit(count: number): LooseQuery;
};

function applyEvidence(query: LooseQuery, filter: EvidenceFilter): LooseQuery {
  if (filter === "full") return query.eq("art.capture_status", "claimed").not("art.ip", "is", null);
  if (filter === "no_ip") return query.eq("art.capture_status", "claimed").is("art.ip", null);
  // No claimed copy among the lead's certificates: an anti-join on the claimed ones.
  if (filter === "no_text") return query.eq("art.capture_status", "claimed").is("art", null);
  if (filter === "none") return query.is("art", null);
  return query;
}
function artEmbed(filter: EvidenceFilter) {
  return filter === "full" || filter === "no_ip" ? "art:tenant_consent_artefacts!inner(id)" : filter === "every" ? "" : "art:tenant_consent_artefacts(id)";
}
function applySources(query: LooseQuery, sources: EvidenceSource[]): LooseQuery {
  if (!sources.length || sources.length === 3) return query;
  const parts = sources.map((source) => source === "partner" ? "partner_id.not.is.null" : source === "vendor" ? "and(partner_id.is.null,campaign_id.not.is.null)" : "and(partner_id.is.null,campaign_id.is.null)");
  return query.or(parts.join(","));
}

export async function getConsentEvidence(input: {
  tenantId: string;
  filter: EvidenceFilter;
  sources: EvidenceSource[];
  search?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<EvidenceView> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 10_000);
  const page = Math.max(0, input.page ?? 0);
  const embed = artEmbed(input.filter);
  const select = `id, created_at, partner_id, campaign_id, values, all:tenant_consent_artefacts(${ART})${embed ? `, ${embed}` : ""}`;

  let list = applySources(applyEvidence(db.from("agent_leads").select(select, { count: "exact" }).eq("tenant_id", input.tenantId), input.filter), input.sources);
  const needle = needleOf(input.search);
  if (needle) {
    const like = `*${needle}*`;
    list = list.or(["first_name", "last_name", "full_name", "name", "phone"].map((key) => `values->>${key}.ilike.${like}`).join(","));
  }

  const headCount = (embedSelect: string, filter: EvidenceFilter) =>
    applyEvidence(db.from("agent_leads").select(`id${embedSelect ? `, ${embedSelect}` : ""}`, { count: "exact", head: true }).eq("tenant_id", input.tenantId), filter);

  const [rows, leads, full, noIp, oldest, coverage] = await Promise.all([
    list.order("created_at", { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1),
    headCount("", "every"),
    headCount(artEmbed("full"), "full"),
    headCount(artEmbed("no_ip"), "no_ip"),
    db.from("tenant_consent_artefacts").select("captured_at").eq("tenant_id", input.tenantId).order("captured_at", { ascending: true }).limit(1),
    db.from("tenant_vendor_consent_coverage").select("vendor_id, vendor_name, leads, claimed_coverage_pct").eq("tenant_id", input.tenantId),
  ]);
  if (rows.error) throw new Error(`Could not load consent evidence: ${rows.error.message}`);
  for (const result of [leads, full, noIp]) if (result.error) throw new Error(`Could not count consent evidence: ${result.error.message}`);

  const leadRows = (rows.data ?? []) as LeadRow[];
  const partnerIds = [...new Set(leadRows.map((row) => row.partner_id).filter((id): id is string => Boolean(id)))];
  const campaignIds = [...new Set(leadRows.map((row) => row.campaign_id).filter((id): id is string => Boolean(id)))];
  const [partners, campaigns] = await Promise.all([
    partnerIds.length ? db.from("partners").select("id, name").eq("tenant_id", input.tenantId).in("id", partnerIds) : Promise.resolve({ data: [], error: null }),
    campaignIds.length ? db.from("tenant_campaigns").select("id, name, vendor_id, lead_type").eq("tenant_id", input.tenantId).in("id", campaignIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const campaignRows = (campaigns.error ? [] : campaigns.data ?? []) as Array<{ id: string; name: string; vendor_id: string | null; lead_type: string | null }>;
  const vendorIds = [...new Set(campaignRows.map((row) => row.vendor_id).filter((id): id is string => Boolean(id)))];
  const vendors = vendorIds.length ? await db.from("tenant_lead_vendors").select("id, name").eq("tenant_id", input.tenantId).in("id", vendorIds) : { data: [], error: null };
  // A partner-submitted lead without a certificate may still carry the partner's attestation of
  // documented consent (Submit lead's consent step), kept on its submission audit entry.
  const attestable = leadRows.filter((row) => row.partner_id && !(row.all ?? []).length).map((row) => row.id);
  const attestations = attestable.length
    ? await db.from("audit_log").select("target_id, metadata").eq("action", "tenant.partner_lead_submitted").in("target_id", attestable)
    : { data: [], error: null };
  const attestedAt = new Map<string, string>();
  for (const entry of (attestations.error ? [] : attestations.data ?? []) as Array<{ target_id: string; metadata: { consentAttestedAt?: string; replayed?: boolean } | null }>) {
    const at = entry.metadata?.consentAttestedAt;
    // The first submission's time, not a replay's.
    if (at && !entry.metadata?.replayed && (!attestedAt.has(entry.target_id) || at < attestedAt.get(entry.target_id)!)) attestedAt.set(entry.target_id, at);
  }
  const partnerName = new Map(((partners.error ? [] : partners.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const vendorName = new Map(((vendors.error ? [] : vendors.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const campaignById = new Map(campaignRows.map((row) => [row.id, row]));

  const mapped: EvidenceRow[] = leadRows.map((row) => {
    const best = bestEvidence(row.all ?? []);
    const attested = best.level === "none" ? attestedAt.get(row.id) ?? null : null;
    const level = attested ? "attested" as const : best.level;
    const artefact = best.artefact;
    const campaign = row.campaign_id ? campaignById.get(row.campaign_id) : undefined;
    const providerName = (row.partner_id && partnerName.get(row.partner_id)) || (campaign?.vendor_id && vendorName.get(campaign.vendor_id)) || campaign?.name || "Direct";
    // How the consent was taken: a partner's own form, a vendor's web form (a certificate says so),
    // a posted lead, an imported list — or nothing we can name.
    const captured = row.partner_id ? "Partner form"
      : artefact && ["trustedform", "jornaya"].includes(text(artefact.provider).toLowerCase()) ? "Web form"
      : campaign?.lead_type === "realtime" ? "Lead post"
      : campaign ? "Imported list"
      : "—";
    const withCertificate = artefact as (EvidenceArtefact & { certificate_id?: string | null }) | null;
    return {
      leadId: row.id,
      name: leadName(row.values),
      phone: leadPhone(row.values),
      providerName,
      captured,
      consentGivenAt: attested ?? consentGivenAt(artefact),
      level,
      artefactId: artefact?.id ?? null,
      certificateId: withCertificate?.certificate_id ?? null,
      ip: artefact?.ip ?? null,
    };
  });

  const leadsCount = leads.count ?? 0;
  const fullCount = full.count ?? 0;
  const noIpCount = noIp.count ?? 0;
  const coverageMissing = Boolean(coverage.error) && (coverage.error?.code === "PGRST205" || /Could not find the table/i.test(coverage.error?.message ?? ""));
  return {
    rows: mapped,
    total: rows.count ?? mapped.length,
    page,
    pageSize,
    tiles: {
      leads: leadsCount,
      full: fullCount,
      noIp: noIpCount,
      // Every lead without the words: no certificate, or only a link we never claimed a copy of.
      textMissing: Math.max(0, leadsCount - fullCount - noIpCount),
      oldestCapturedAt: ((oldest.error ? [] : oldest.data ?? []) as Array<{ captured_at: string }>)[0]?.captured_at ?? null,
    },
    coverageAvailable: !coverageMissing && !coverage.error,
    coverage: coverage.error ? [] : ((coverage.data ?? []) as Array<{ vendor_id: string; vendor_name: string; leads: number; claimed_coverage_pct: number | null }>).map((row) => ({
      vendorId: row.vendor_id, vendorName: row.vendor_name, leads: Number(row.leads ?? 0), claimedPct: row.claimed_coverage_pct == null ? null : Number(row.claimed_coverage_pct),
    })),
  };
}

const CSV_HEADER = ["Lead", "Phone", "Provider", "Captured", "Consent given (UTC)", "Evidence", "Certificate id", "IP address"];
function csvCell(value: string | null) {
  // A cell a spreadsheet would run as a formula is neutralised: lead values arrive from vendors.
  const raw = value ?? "";
  const v = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
export function evidenceCsv(rows: EvidenceRow[], label: (level: EvidenceLevel) => string): string {
  return [CSV_HEADER.join(","), ...rows.map((row) => [row.name, row.phone, row.providerName, row.captured, row.consentGivenAt, label(row.level), row.certificateId, row.ip].map(csvCell).join(","))].join("\n");
}
