import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ConsentArtefact, ConsentCoverage, ConsentStatus } from "./constants";

/**
 * LA-2.6 · the consent locker.
 *
 * `tenant_consent_artefacts` had three code paths touching it and no screen. The lead-post ingest
 * writes a row when a vendor supplies a certificate, `consentClaims.ts` upgrades it to `claimed`
 * once the copy is stored, and the dialer panel shows the newest one for the lead being called.
 *
 * None of that answers the question the table exists for. Consent is produced on the day a
 * complaint or a demand letter arrives, months later, about one specific person — and until this
 * file there was no way to search for that person, see whether a certificate was ever captured,
 * or open the stored copy. `/app/consent` was a menu entry pointing at nothing.
 *
 * The distinction the screen is built around is `pending` versus `claimed`. A pending row holds a
 * provider URL and nothing else, and TrustedForm certificates expire; a claimed row holds the copy
 * that survives the link dying. A locker that showed both as "we have consent" would be worse than
 * no locker, because it would be reassuring and wrong.
 */

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;
type Query = {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  or(filter: string): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  maybeSingle<T>(): Promise<Result<T>>;
  then(resolve: (value: Result<Row[]>) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
type Db = { from(table: string): Query };

function db(): Db {
  return getSupabaseServiceClient() as unknown as Db;
}

export { CONSENT_STATUS_LABELS, CONSENT_STATUS_HINTS } from "./constants";
export type { ConsentArtefact, ConsentCoverage, ConsentStatus } from "./constants";

const text = (value: unknown) => (typeof value === "string" ? value : "");

function leadName(values: unknown): string {
  const v = (values ?? {}) as Record<string, unknown>;
  const name = [text(v.first_name), text(v.last_name)].filter(Boolean).join(" ").trim();
  return name || text(v.full_name) || text(v.name) || "Unnamed lead";
}

function leadPhone(values: unknown): string | null {
  const v = (values ?? {}) as Record<string, unknown>;
  return text(v.phone) || text(v.phone_number) || text(v.mobile) || null;
}

export type ConsentLockerView = {
  artefacts: ConsentArtefact[];
  counts: Record<ConsentStatus, number>;
  coverage: ConsentCoverage[];
  /** Null when the coverage view is not present, so the screen can say that rather than show zero. */
  coverageAvailable: boolean;
  hasMore: boolean;
};

export async function getConsentLocker(input: {
  tenantId: string;
  search?: string | null;
  status?: ConsentStatus | null;
  limit?: number;
}): Promise<ConsentLockerView> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 300);
  const client = db();

  let query = client
    .from("tenant_consent_artefacts")
    .select(
      "id, lead_id, provider, certificate_id, certificate_url, capture_status, capture_error, captured_at, claimed_at, consent_timestamp, ip, source_url, landing_page, stored_copy, stored_ref",
    )
    .eq("tenant_id", input.tenantId);
  if (input.status) query = query.eq("capture_status", input.status);

  const [artefacts, statusRows, coverage] = await Promise.all([
    query.order("captured_at", { ascending: false }).limit(limit + 1),
    // Counted separately and over every row, because the page above is capped. A tally derived
    // from the page would shrink as soon as a filter was applied and read as "we have fewer
    // certificates" rather than "you are looking at fewer".
    client.from("tenant_consent_artefacts").select("capture_status").eq("tenant_id", input.tenantId).limit(10000),
    client
      // The percentage columns are `claimed_coverage_pct` and `any_coverage_pct`. This asked for
      // `claimed_pct`, which does not exist, so every request failed with 42703 — and the screen
      // reported "the reporting view has not been created yet", which was untrue: the view is
      // deployed and holds six rows. See the error handling below, which is the other half of it.
      .from("tenant_vendor_consent_coverage")
      .select("vendor_id, vendor_name, leads, claimed_certificates, any_certificate, claimed_coverage_pct")
      .eq("tenant_id", input.tenantId),
  ]);

  if (artefacts.error) throw new Error(`Could not load the consent locker: ${artefacts.error.message}`);

  const rows = artefacts.data ?? [];
  const leadIds = [...new Set(rows.map((row) => text(row.lead_id)).filter(Boolean))];

  const leads = leadIds.length
    ? await client
        .from("agent_leads")
        .select("id, values, campaign_id")
        .eq("tenant_id", input.tenantId)
        .in("id", leadIds)
    : ({ data: [], error: null } as Result<Row[]>);
  if (leads.error) throw new Error(`Could not load the leads behind these certificates: ${leads.error.message}`);

  const leadById = new Map((leads.data ?? []).map((row) => [text(row.id), row]));

  // Vendor attribution runs lead → campaign → vendor, so it needs the campaigns of the leads on
  // this page. Skipped entirely when none of them carry a campaign, which is the live state today.
  const campaignIds = [...new Set((leads.data ?? []).map((row) => text(row.campaign_id)).filter(Boolean))];
  const campaigns = campaignIds.length
    ? await client.from("tenant_campaigns").select("id, vendor_id").eq("tenant_id", input.tenantId).in("id", campaignIds)
    : ({ data: [], error: null } as Result<Row[]>);
  const vendorIdByCampaign = new Map((campaigns.data ?? []).map((row) => [text(row.id), text(row.vendor_id)]));
  const vendorIds = [...new Set([...vendorIdByCampaign.values()].filter(Boolean))];
  const vendors = vendorIds.length
    ? await client.from("tenant_lead_vendors").select("id, name").eq("tenant_id", input.tenantId).in("id", vendorIds)
    : ({ data: [], error: null } as Result<Row[]>);
  const vendorNameById = new Map((vendors.data ?? []).map((row) => [text(row.id), text(row.name)]));

  const needle = (input.search ?? "").trim().toLowerCase();
  const digits = needle.replace(/[^0-9]/g, "");

  const mapped: ConsentArtefact[] = rows.map((row) => {
    const lead = leadById.get(text(row.lead_id));
    const campaignId = lead ? text(lead.campaign_id) : "";
    const vendorId = vendorIdByCampaign.get(campaignId) ?? "";
    return {
      id: text(row.id),
      leadId: text(row.lead_id),
      leadName: lead ? leadName(lead.values) : "Lead no longer in your book",
      leadPhone: lead ? leadPhone(lead.values) : null,
      provider: text(row.provider),
      certificateId: text(row.certificate_id) || null,
      certificateUrl: text(row.certificate_url) || null,
      status: (text(row.capture_status) || "pending") as ConsentStatus,
      captureError: text(row.capture_error) || null,
      capturedAt: text(row.captured_at),
      claimedAt: text(row.claimed_at) || null,
      consentTimestamp: text(row.consent_timestamp) || null,
      ip: text(row.ip) || null,
      sourceUrl: text(row.source_url) || null,
      landingPage: text(row.landing_page) || null,
      // Whether a copy exists, not the copy itself. The copy can be large and is fetched by id when
      // somebody actually opens one.
      hasStoredCopy: row.stored_copy != null || Boolean(text(row.stored_ref)),
      vendorName: vendorNameById.get(vendorId) || null,
    };
  });

  // Searching happens here rather than in the query because the useful needle is the person's
  // name, which lives in a jsonb `values` blob on a different table. A PostgREST `or` across that
  // join is not expressible, and matching only the certificate id would make the search useless
  // for the one case the locker exists to serve.
  const filtered = needle
    ? mapped.filter(
        (artefact) =>
          artefact.leadName.toLowerCase().includes(needle) ||
          (digits && (artefact.leadPhone ?? "").replace(/[^0-9]/g, "").includes(digits)) ||
          (artefact.certificateId ?? "").toLowerCase().includes(needle),
      )
    : mapped;

  const coverageMissing =
    Boolean(coverage.error) &&
    (coverage.error?.code === "PGRST205" || /Could not find the table/i.test(coverage.error?.message ?? ""));
  if (coverage.error && !coverageMissing)
    throw new Error(`Could not read per-vendor consent coverage: ${coverage.error.message}`);

  const counts: Record<ConsentStatus, number> = { pending: 0, claimed: 0, expired: 0, failed: 0 };
  for (const row of statusRows.data ?? []) {
    const status = (text(row.capture_status) || "pending") as ConsentStatus;
    if (status in counts) counts[status] += 1;
  }

  return {
    artefacts: filtered.slice(0, limit),
    counts,
    // A missing view is a deployment fact, not an empty result: reporting zero coverage would read
    // as "no vendor supplies consent". But ONLY PGRST205 means missing.
    //
    // This said `!coverage.error`, so every failure became "the view has not been created yet".
    // A typo in the select list — `claimed_pct` for `claimed_coverage_pct` — therefore produced a
    // screen calmly explaining that a view which exists, and holds six rows, was not deployed.
    // Anything other than PGRST205 is a real fault and is thrown, because a wrong column name is
    // a bug to fix rather than a deployment to wait for.
    coverageAvailable: !coverageMissing,
    coverage: coverageMissing
      ? []
      : (coverage.data ?? []).map((row) => ({
          vendorId: text(row.vendor_id),
          vendorName: text(row.vendor_name),
          leads: Number(row.leads ?? 0),
          claimedCertificates: Number(row.claimed_certificates ?? 0),
          anyCertificate: Number(row.any_certificate ?? 0),
          claimedPct: row.claimed_coverage_pct == null ? null : Number(row.claimed_coverage_pct),
        })),
    hasMore: rows.length > limit,
  };
}

export type ConsentRecord = ConsentArtefact & { storedCopy: unknown; storedRef: string | null };

/** One certificate in full, including the stored copy — what gets handed to a lawyer. */
export async function getConsentRecord(tenantId: string, id: string): Promise<ConsentRecord> {
  const result = await db()
    .from("tenant_consent_artefacts")
    .select(
      "id, lead_id, provider, certificate_id, certificate_url, capture_status, capture_error, captured_at, claimed_at, consent_timestamp, ip, source_url, landing_page, stored_copy, stored_ref",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle<Row>();
  if (result.error) throw new Error(`Could not load that certificate: ${result.error.message}`);
  if (!result.data) throw new Error("That certificate is not in your locker.");

  const row = result.data;
  const lead = await db()
    .from("agent_leads")
    .select("id, values")
    .eq("tenant_id", tenantId)
    .eq("id", text(row.lead_id))
    .maybeSingle<Row>();

  return {
    id: text(row.id),
    leadId: text(row.lead_id),
    leadName: lead.data ? leadName(lead.data.values) : "Lead no longer in your book",
    leadPhone: lead.data ? leadPhone(lead.data.values) : null,
    provider: text(row.provider),
    certificateId: text(row.certificate_id) || null,
    certificateUrl: text(row.certificate_url) || null,
    status: (text(row.capture_status) || "pending") as ConsentStatus,
    captureError: text(row.capture_error) || null,
    capturedAt: text(row.captured_at),
    claimedAt: text(row.claimed_at) || null,
    consentTimestamp: text(row.consent_timestamp) || null,
    ip: text(row.ip) || null,
    sourceUrl: text(row.source_url) || null,
    landingPage: text(row.landing_page) || null,
    hasStoredCopy: row.stored_copy != null || Boolean(text(row.stored_ref)),
    vendorName: null,
    storedCopy: row.stored_copy ?? null,
    storedRef: text(row.stored_ref) || null,
  };
}
