import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getAgentTemplateForProduct } from "@/lib/agentTemplates/service";
import { DEFAULT_CEILING } from "@/lib/cadence/engine";
import { getVendorScorecard } from "@/lib/vendorScorecard/service";

/**
 * One bought list, followed all the way through: from the CSV that was committed, past what the
 * scrub removed, to who holds it, what the dialer did with it and what it turned into.
 *
 * The index (service.ts) says which list to look at. This says why it is working or not — and
 * every figure is counted from the rows behind it, for the same reason the index is: a stored
 * "never dialled" is wrong the moment somebody dials one.
 *
 * Where the data does not exist, the field is null and the screen says so. Three of the board's
 * figures have no source today and are not invented: the uploaded file's name (a commit keeps the
 * rows, not the file), duplicates of leads you already had (attached at import, never ledgered —
 * a number repeated INSIDE a file is ledgered from 20260925703100), and the federal/state split of
 * DNC hits (the scrub answers "on a do-not-call list", not which one).
 */

export type RemovalReason = "tcpa_litigator" | "dnc" | "internal_dnc" | "invalid" | "duplicate_in_file" | "suppressed";

/** Why a pool lead is not being served right now (lead_list_pool_blockers, 20260925703000). */
export type PoolBlocker =
  | "campaign" | "exhausted" | "suppressed" | "no_state" | "no_agent" | "rules_stale"
  | "outside_window" | "at_capacity" | "waiting" | "unscheduled" | "lead_state" | "ready";

export type PoolBlockers = {
  total: number;
  campaign: { servable: boolean; status: string; scrubStatus: string };
  rulesStale: boolean;
  checkedAt: string;
  /** One row per blocker and state (and lead status, for `lead_state`). */
  groups: Array<{ blocker: PoolBlocker; state: string | null; detail: string | null; count: number; nextAt: string | null; zone: string | null }>;
};

/** Where this list's creditable removals stand in the claim ledger (20260925703200). */
export type RemovalClaims = {
  /** False before 20260925703200: removals can only be exported, not claimed in the ledger. */
  supported: boolean;
  /** Creditable, on no claim, still inside the vendor's return window — what "Claim N" drafts. */
  unclaimedRows: number;
  unclaimedCents: number;
  /** Creditable rows already on a claim of any status. */
  onClaimRows: number;
  /** Creditable rows whose credit can still land: on an unresolved claim, or claimable now — the "if the claim lands" figure. */
  pendingCents: number;
};

export type LeadListDetail = {
  campaignId: string;
  campaignName: string;
  vendorId: string | null;
  vendorName: string;
  productCode: string;
  productName: string | null;
  createdAt: string;
  scrubStatus: string;
  recordsPurchased: number;
  totalSpendCents: number;
  creditsReceivedCents: number;
  /** Spend over records bought — what the vendor charged per row. */
  costPerRecordCents: number | null;
  /** Net spend over rows that survived the scrub. Null when nothing survived. */
  costPerUsableCents: number | null;
  recordsUsable: number;
  recordsRejected: number;
  /** First time rows landed against this list; null when nothing has been imported. */
  firstImportAt: string | null;
  imports: number;
  leadsReceived: number;
  assigned: number;
  /** Unowned work items still in the pool (lead_queue.status 'unclaimed') — what "Assign N leads" moves. */
  assignable: number;
  dialed: number;
  neverDialed: number;
  exhausted: number;
  /** Fresh, working or waiting on a retry — leads the dialer can still serve. */
  workable: number;
  /** Workable leads whose state's calling window is shut right now. Null when the check could not run. */
  outsideWindow: number | null;
  contacted: number;
  outcomesRecorded: number;
  /** The ceiling "Exhausted at N attempts" names: the one every lead shares, else the default. */
  attemptCeiling: number;
  /**
   * Every attempt ceiling the list's leads stop at, ascending: a recycle batch gives its leads their
   * own (agent_leads.attempt_ceiling, 20260925706500; null is the default seven). One entry when
   * they all share it.
   */
  attemptCeilings: number[];
  /**
   * `rows` is every row removed (all unusable). `claimableRows` / `claimableCents` leave out the
   * rows a LATER re-scrub found (source_key 'scrub:<run>', 20260925706100): the number went onto a
   * list after it was bought, so it is never the vendor's to credit (20260925707900).
   */
  removals: Array<{ reason: RemovalReason; rows: number; rescrubRows: number; claimableRows: number; claimableCents: number | null }>;
  claims: RemovalClaims;
  /** Null when lead_list_pool_blockers is not deployed or could not run. */
  poolBlockers: PoolBlockers | null;
  /** Days left to raise the import removals with the vendor; null when the vendor has no window. */
  returnDaysLeft: number | null;
  mapping: {
    saved: boolean;
    rows: Array<{ header: string; field: string | null; fieldLabel: string | null; sample: string }>;
  };
  consent: {
    trustedForm: number;
    /** Leads with any certificate from any provider. */
    supplied: number;
    oldestCapturedAt: string | null;
  };
  /** The pipeline end, from the vendor scorecard. Null when the viewer cannot see money. */
  outcome: { applications: number; issued: number; costPerIssuedCents: number | null } | null;
};

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string } | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  not(column: string, operator: string, value: unknown): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  range(from: number, to: number): Query<T>;
  limit(count: number): Query<T>;
};
type Db = {
  from(table: string): Query<Row[]>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<unknown>>;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);
const nullableNum = (value: unknown) => (value == null || value === "" ? null : Number(value));

const PAGE = 1000;
async function allRows(build: (start: number) => Query<Row[]>, label: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await build(start);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/**
 * A ledger row a later "Run the scrub" wrote (source_key 'scrub:<run id>', 20260925706100), not the
 * import. Unusable like any removal, never claimable from the vendor (20260925707900); an import row
 * is 'csv:<line>' or has no key.
 */
function isRescrubRow(row: Row): boolean {
  return text(row.source_key).startsWith("scrub:");
}

/** The list's leads, with their own attempt ceiling when the column exists. */
function listLeads(db: Db, tenantId: string, campaignId: string, withCeiling: boolean): Promise<Row[]> {
  const columns = `id, lead_state, attempts_made, ${withCeiling ? "attempt_ceiling, " : ""}us_state:values->>state, lead_queue!lead_queue_lead_id_fkey(owner_user_id, status)`;
  return allRows(
    (start) =>
      db
        .from("agent_leads")
        .select(columns)
        .eq("tenant_id", tenantId)
        .eq("campaign_id", campaignId)
        .eq("lead_queue.tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(start, start + PAGE - 1),
    "the leads in this list",
  );
}

/** Mirrors `is_contact_disposition` in SQL: anything recorded that is not a failed connection. */
const NOT_A_CONTACT = new Set(["no_answer", "voicemail", "busy", "call_dropped", "disconnected", "wrong_number"]);
const WORKABLE = new Set(["fresh", "working", "retry"]);
/**
 * A vendor credits a row nobody could ever dial, and a row it sold twice in one file (user decision,
 * 2026-09-25). A number on your own list is your decision, not their defect. Mirrored in SQL by
 * create_import_removal_claim (20260925703200).
 */
const CREDITABLE: ReadonlySet<RemovalReason> = new Set(["tcpa_litigator", "dnc", "invalid", "duplicate_in_file"]);
const REASON_ORDER: RemovalReason[] = ["tcpa_litigator", "dnc", "internal_dnc", "invalid", "duplicate_in_file", "suppressed"];

const POOL_BLOCKERS: ReadonlySet<string> = new Set([
  "campaign", "exhausted", "suppressed", "no_state", "no_agent", "rules_stale",
  "outside_window", "at_capacity", "waiting", "unscheduled", "lead_state", "ready",
]);

/** The function, table or column a pending migration adds — read as "not there yet", not as a failure. */
function isMissingSchema(error: { message: string; code?: string } | null) {
  if (!error) return false;
  return ["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")
    || /does not exist|could not find|schema cache/i.test(error.message);
}

function parsePoolBlockers(data: unknown): PoolBlockers | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Row;
  const campaign = (raw.campaign ?? {}) as Row;
  const groups = Array.isArray(raw.groups) ? (raw.groups as Row[]) : [];
  return {
    total: num(raw.total),
    campaign: { servable: campaign.servable === true, status: text(campaign.status), scrubStatus: text(campaign.scrub_status) },
    rulesStale: raw.rules_stale === true,
    checkedAt: text(raw.checked_at),
    groups: groups
      .filter((group) => POOL_BLOCKERS.has(text(group.blocker)))
      .map((group) => ({
        blocker: text(group.blocker) as PoolBlocker,
        state: text(group.state) || null,
        detail: text(group.detail) || null,
        count: num(group.count),
        nextAt: text(group.next_at) || null,
        zone: text(group.zone) || null,
      })),
  };
}

/**
 * The ledger's outcome, split once more where the detail allows. A hit on the agency's own
 * suppression list is recorded as `dnc` with the screening message, and that message is the only
 * thing that tells it apart from a registry hit (lib/compliance/screening.ts).
 */
export function removalReason(outcome: string, detail: string): RemovalReason {
  if (outcome === "tcpa_litigator") return "tcpa_litigator";
  if (outcome === "invalid") return "invalid";
  if (outcome === "duplicate_in_file") return "duplicate_in_file";
  if (outcome === "suppressed") return "suppressed";
  return /your do-not-call list/i.test(detail) ? "internal_dnc" : "dnc";
}

export async function leadListDetail(
  tenantId: string,
  userId: string,
  campaignId: string,
  access: { money: boolean; readOnly: boolean },
): Promise<LeadListDetail | null> {
  const db = getSupabaseServiceClient() as unknown as Db;

  const [campaignResult, costsResult, rejections, leads, firstSource, sourceCount, attempts, consent] = await Promise.all([
    db
      .from("tenant_campaigns")
      .select("id, name, vendor_id, product_code, created_at, scrub_status, records_purchased, total_spend_cents, credits_received_cents, cost_per_record_cents")
      .eq("tenant_id", tenantId)
      .eq("id", campaignId)
      .limit(1),
    db
      .from("tenant_campaign_costs")
      .select("records_rejected, records_usable, cost_per_usable_record_cents")
      .eq("tenant_id", tenantId)
      .eq("campaign_id", campaignId)
      .limit(1),
    allRows(
      (start) =>
        db
          .from("tenant_campaign_scrub_rejections")
          .select("id, outcome, detail, source_key, rejected_at")
          .eq("tenant_id", tenantId)
          .eq("campaign_id", campaignId)
          .order("id", { ascending: true })
          .range(start, start + PAGE - 1),
      "what the scrub removed",
    ),
    // attempt_ceiling (20260925706500) first; before that migration the leads are read without it
    // and every lead stops at the default ceiling, as before.
    listLeads(db, tenantId, campaignId, true).catch((error: unknown) => {
      if (error instanceof Error && /attempt_ceiling/.test(error.message)) return listLeads(db, tenantId, campaignId, false);
      throw error;
    }),
    db.from("tenant_lead_sources").select("created_at").eq("tenant_id", tenantId).eq("campaign_id", campaignId).order("created_at", { ascending: true }).limit(1),
    // Distinct commits: a CSV commit stamps every source row in one transaction with one time.
    allRows(
      (start) =>
        db
          .from("tenant_lead_sources")
          .select("id, created_at")
          .eq("tenant_id", tenantId)
          .eq("campaign_id", campaignId)
          .eq("source_type", "import")
          .order("id", { ascending: true })
          .range(start, start + PAGE - 1),
      "the imports into this list",
    ),
    allRows(
      (start) =>
        db
          .from("tenant_call_attempts")
          .select("id, lead_id, disposition, agent_leads!inner(campaign_id)")
          .eq("tenant_id", tenantId)
          .eq("agent_leads.campaign_id", campaignId)
          .order("id", { ascending: true })
          .range(start, start + PAGE - 1),
      "the calls made to this list",
    ),
    allRows(
      (start) =>
        db
          .from("tenant_consent_artefacts")
          .select("id, lead_id, provider, captured_at, capture_status, agent_leads!inner(campaign_id)")
          .eq("tenant_id", tenantId)
          .eq("agent_leads.campaign_id", campaignId)
          .order("id", { ascending: true })
          .range(start, start + PAGE - 1),
      "the consent certificates for this list",
    ).catch(() => [] as Row[]),
  ]);
  if (campaignResult.error) throw new Error(`Could not load this list: ${campaignResult.error.message}`);
  const campaign = (campaignResult.data ?? [])[0];
  if (!campaign) return null;
  const costs = costsResult.error ? null : (costsResult.data ?? [])[0] ?? null;

  const vendorId = text(campaign.vendor_id) || null;
  const productCode = text(campaign.product_code);
  const createdAt = text(campaign.created_at);

  // What the leads tell us, counted once.
  let assigned = 0, assignable = 0, dialed = 0, neverDialed = 0, exhausted = 0, workable = 0;
  const workableByState = new Map<string, number>();
  const ceilings = new Set<number>();
  for (const lead of leads) {
    const own = nullableNum(lead.attempt_ceiling);
    ceilings.add(own != null && Number.isInteger(own) && own >= 1 ? own : DEFAULT_CEILING);
    const queue = lead.lead_queue as Row | Row[] | null | undefined;
    const item = Array.isArray(queue) ? queue[0] : queue;
    if (item && text(item.owner_user_id)) assigned += 1;
    // The rows assign_lead_list moves: in the pool, nobody holding them.
    else if (item && text(item.status) === "unclaimed") assignable += 1;
    if (num(lead.attempts_made) > 0) dialed += 1; else neverDialed += 1;
    const state = text(lead.lead_state);
    if (state === "exhausted") exhausted += 1;
    if (WORKABLE.has(state)) workable += 1;
    const usState = text(lead.us_state).trim().toUpperCase();
    if (WORKABLE.has(state) && usState) workableByState.set(usState, (workableByState.get(usState) ?? 0) + 1);
  }

  const contactedLeads = new Set<string>();
  let outcomesRecorded = 0;
  for (const attempt of attempts) {
    const disposition = text(attempt.disposition);
    if (!disposition) continue;
    outcomesRecorded += 1;
    if (!NOT_A_CONTACT.has(disposition)) contactedLeads.add(text(attempt.lead_id));
  }

  const commits = new Set(sourceCount.map((row) => text(row.created_at)));

  // Second round: what needs the campaign's vendor, product and dates.
  const [vendor, mapping, template, sample, scorecard, windows, claimItems, pool] = await Promise.all([
    vendorId ? db.from("tenant_lead_vendors").select("name, return_window_days").eq("tenant_id", tenantId).eq("id", vendorId).limit(1) : null,
    vendorId && productCode
      ? db.from("tenant_import_mappings").select("mapping").eq("tenant_id", tenantId).eq("vendor_id", vendorId).eq("product_code", productCode).limit(1)
      : null,
    productCode ? getAgentTemplateForProduct(tenantId, userId, productCode).catch(() => null) : null,
    db.from("agent_leads").select("values").eq("tenant_id", tenantId).eq("campaign_id", campaignId).order("created_at", { ascending: true }).limit(1),
    access.money
      ? getVendorScorecard(tenantId, { campaignId, from: createdAt.slice(0, 10) || null }, access.readOnly).catch(() => null)
      : null,
    // One question per state, not per lead: the window is a property of where the lead lives.
    Promise.all(
      [...workableByState.keys()].slice(0, 60).map(async (state) => {
        const { data, error } = await db.rpc("tenant_can_dial_now", { p_tenant_id: tenantId, p_state: state, p_campaign_id: campaignId });
        if (error) throw new Error(error.message);
        return [state, data === true] as const;
      }),
    ).catch(() => null),
    // Which removals are already on a claim, and in what state (20260925703200). Before that
    // migration the column does not exist and the removals can only be exported.
    removalClaimItems(db, tenantId, campaignId),
    // Why the pool is not being served (20260925703000). Before it, the card is not shown.
    Promise.resolve(db.rpc("lead_list_pool_blockers", { p_tenant_id: tenantId, p_campaign_id: campaignId }))
      .then(({ data, error }) => {
        if (error && !isMissingSchema(error)) console.error(`[lead-lists] pool blockers for ${campaignId}: ${error.message}`);
        return error ? null : parsePoolBlockers(data);
      })
      .catch(() => null),
  ]);

  const vendorRow = vendor && !vendor.error ? (vendor.data ?? [])[0] : undefined;
  const costPerRecord = nullableNum(campaign.cost_per_record_cents);

  const reasonCounts = new Map<RemovalReason, number>();
  const rescrubCounts = new Map<RemovalReason, number>();
  for (const row of rejections) {
    const reason = removalReason(text(row.outcome), text(row.detail));
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    if (isRescrubRow(row)) rescrubCounts.set(reason, (rescrubCounts.get(reason) ?? 0) + 1);
  }
  const removals = REASON_ORDER
    .filter((reason) => reason !== "suppressed" || reasonCounts.has(reason))
    .map((reason) => {
      const rows = reasonCounts.get(reason) ?? 0;
      const rescrubRows = rescrubCounts.get(reason) ?? 0;
      const claimableRows = CREDITABLE.has(reason) ? rows - rescrubRows : 0;
      return { reason, rows, rescrubRows, claimableRows, claimableCents: CREDITABLE.has(reason) && costPerRecord != null ? Math.round(claimableRows * costPerRecord) : null };
    });

  const windowDays = vendorRow ? nullableNum(vendorRow.return_window_days) : null;

  // Where each creditable removal stands in the claim ledger. A row counts toward "if the claim
  // lands" until a claim holding it has been accepted (its credit is already in net spend) or
  // refused; it can be drafted only while on no claim and inside the vendor's window, counted from
  // when it was removed — the same rule create_import_removal_claim applies.
  const claimStatus = new Map<string, string>();
  for (const item of claimItems ?? []) claimStatus.set(text(item.scrub_rejection_id), text(item.status));
  let unclaimedRows = 0, onClaimRows = 0, pendingRows = 0;
  for (const row of rejections) {
    if (!CREDITABLE.has(removalReason(text(row.outcome), text(row.detail)))) continue;
    // A later re-scrub's hit is never claimable (20260925707900); it stays counted as unusable.
    if (isRescrubRow(row)) continue;
    const status = claimStatus.get(text(row.id));
    const removedAt = Date.parse(text(row.rejected_at));
    const inWindow = windowDays == null || Number.isNaN(removedAt) || removedAt + windowDays * 86_400_000 > Date.now();
    if (status) onClaimRows += 1;
    if (!status && inWindow) unclaimedRows += 1;
    // Still able to land: on a claim that is not yet resolved, or on none and still claimable.
    if (status ? status === "draft" || status === "submitted" : inWindow) pendingRows += 1;
  }
  const claims: RemovalClaims = {
    supported: claimItems !== null,
    unclaimedRows,
    unclaimedCents: costPerRecord == null ? 0 : Math.round(unclaimedRows * costPerRecord),
    onClaimRows,
    pendingCents: costPerRecord == null ? 0 : Math.round(pendingRows * costPerRecord),
  };

  const firstImportAt = (!firstSource.error && text((firstSource.data ?? [])[0]?.created_at)) || null;
  let returnDaysLeft: number | null = null;
  if (windowDays != null && firstImportAt) {
    const closes = Date.parse(firstImportAt) + windowDays * 86_400_000;
    returnDaysLeft = Math.max(0, Math.ceil((closes - Date.now()) / 86_400_000));
  }

  const savedMapping = mapping && !mapping.error ? ((mapping.data ?? [])[0]?.mapping as Record<string, string | null> | undefined) : undefined;
  const labels = new Map((template?.template.fields ?? []).map((field) => [field.field_key, field.label]));
  const sampleValues = ((!sample.error && (sample.data ?? [])[0]?.values) || {}) as Record<string, unknown>;
  const mappingRows = Object.entries(savedMapping ?? {}).map(([header, field]) => {
    const value = field ? sampleValues[field] : undefined;
    return { header, field: field || null, fieldLabel: field ? labels.get(field) ?? field : null, sample: value == null ? "" : String(value) };
  });

  const certified = new Set<string>();
  const trusted = new Set<string>();
  let oldest: string | null = null;
  for (const row of consent) {
    const lead = text(row.lead_id);
    certified.add(lead);
    if (text(row.provider) === "trustedform") trusted.add(lead);
    const captured = text(row.captured_at);
    if (captured && (!oldest || captured < oldest)) oldest = captured;
  }

  let outsideWindow: number | null = null;
  if (windows) {
    outsideWindow = 0;
    for (const [state, open] of windows) if (!open) outsideWindow += workableByState.get(state) ?? 0;
  }

  const totals = scorecard?.totals;
  return {
    campaignId,
    campaignName: text(campaign.name) || "Untitled list",
    vendorId,
    vendorName: vendorRow ? text(vendorRow.name) || "Unknown vendor" : "Unknown vendor",
    productCode,
    productName: template?.template.product_name ?? null,
    createdAt,
    scrubStatus: text(campaign.scrub_status) || "unscrubbed",
    recordsPurchased: num(campaign.records_purchased),
    totalSpendCents: num(campaign.total_spend_cents),
    creditsReceivedCents: num(campaign.credits_received_cents),
    costPerRecordCents: costPerRecord,
    costPerUsableCents: costs ? nullableNum(costs.cost_per_usable_record_cents) : null,
    recordsUsable: costs ? num(costs.records_usable) : Math.max(0, num(campaign.records_purchased) - rejections.length),
    recordsRejected: costs ? num(costs.records_rejected) : rejections.length,
    firstImportAt,
    imports: commits.size,
    leadsReceived: leads.length,
    assigned,
    assignable,
    dialed,
    neverDialed,
    exhausted,
    workable,
    outsideWindow,
    contacted: contactedLeads.size,
    outcomesRecorded,
    attemptCeiling: ceilings.size === 1 ? [...ceilings][0] : DEFAULT_CEILING,
    attemptCeilings: ceilings.size ? [...ceilings].sort((a, b) => a - b) : [DEFAULT_CEILING],
    removals,
    claims,
    poolBlockers: pool,
    returnDaysLeft,
    mapping: { saved: Boolean(savedMapping), rows: mappingRows },
    consent: { trustedForm: trusted.size, supplied: certified.size, oldestCapturedAt: oldest },
    outcome: totals
      ? { applications: num(totals.applications), issued: num(totals.issued_policies), costPerIssuedCents: nullableNum(totals.effective_cost_per_issued_policy_cents) }
      : null,
  };
}

/**
 * This list's removals that are on a claim, with the claim's status. Null when the ledger cannot
 * hold removals yet (before 20260925703200) or the read failed — the screen then offers only the
 * export, as it did before.
 */
async function removalClaimItems(db: Db, tenantId: string, campaignId: string): Promise<Array<{ scrub_rejection_id: unknown; status: unknown }> | null> {
  const out: Array<{ scrub_rejection_id: unknown; status: unknown }> = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await db
      .from("lead_claim_items")
      .select("id, scrub_rejection_id, claim:lead_claims!inner(status, campaign_id)")
      .eq("tenant_id", tenantId)
      .eq("claim.campaign_id", campaignId)
      .not("scrub_rejection_id", "is", null)
      .order("id", { ascending: true })
      .range(start, start + PAGE - 1);
    if (error) {
      if (!isMissingSchema(error)) console.error(`[lead-lists] claimed removals for ${campaignId}: ${error.message}`);
      return null;
    }
    const page = data ?? [];
    for (const row of page) {
      const claim = Array.isArray(row.claim) ? (row.claim[0] as Row | undefined) : (row.claim as Row | undefined);
      out.push({ scrub_rejection_id: row.scrub_rejection_id, status: claim?.status });
    }
    if (page.length < PAGE) return out;
  }
}

/**
 * The rows a vendor is asked to credit: every import removal they are answerable for, with the
 * line of their own file it came from, so "which 180 numbers?" has an answer they can check.
 */
export async function claimableRowsCsv(tenantId: string, campaignId: string, only?: RemovalReason): Promise<string | null> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const [campaign, rows] = await Promise.all([
    db.from("tenant_campaigns").select("id, cost_per_record_cents").eq("tenant_id", tenantId).eq("id", campaignId).limit(1),
    allRows(
      (start) =>
        db
          .from("tenant_campaign_scrub_rejections")
          .select("id, phone_digits, outcome, detail, source_key, rejected_at")
          .eq("tenant_id", tenantId)
          .eq("campaign_id", campaignId)
          .order("rejected_at", { ascending: true })
          .order("id", { ascending: true })
          .range(start, start + PAGE - 1),
      "what the scrub removed",
    ),
  ]);
  if (campaign.error) throw new Error(`Could not load this list: ${campaign.error.message}`);
  const found = (campaign.data ?? [])[0];
  if (!found) return null;
  const perRecord = nullableNum(found.cost_per_record_cents);
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = ["phone,reason,detail,source_row,removed_at,cost"];
  for (const row of rows) {
    const reason = removalReason(text(row.outcome), text(row.detail));
    if (!CREDITABLE.has(reason) || (only && reason !== only)) continue;
    // Not the vendor's to credit: a later re-scrub found it (20260925707900).
    if (isRescrubRow(row)) continue;
    lines.push([
      text(row.phone_digits),
      reason,
      text(row.detail),
      text(row.source_key).replace(/^csv:/, ""),
      text(row.rejected_at),
      perRecord == null ? "" : (perRecord / 100).toFixed(4),
    ].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}

export function isRemovalReason(value: unknown): value is RemovalReason {
  return typeof value === "string" && (REASON_ORDER as string[]).includes(value);
}

/** A claim needs 20260925703200, which has not been applied yet. */
export class ClaimNeedsDatabaseUpdateError extends Error {}

/** A refusal the screen shows as it is, with the status the route answers with. */
export class ClaimRefusedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Drafts one claim in the Vendor returns ledger from this list's creditable removals that are on no
 * claim and still inside the vendor's return window (create_import_removal_claim, 20260925703200).
 * The function writes the audit row itself, in the same transaction as the claim.
 */
export async function createImportRemovalClaim(tenantId: string, campaignId: string, userId: string, reason?: RemovalReason) {
  const db = getSupabaseServiceClient() as unknown as Db;
  const { data, error } = await db.rpc("create_import_removal_claim", {
    p_tenant_id: tenantId,
    p_campaign_id: campaignId,
    p_created_by: userId,
    p_reason: reason ?? null,
  });
  if (error) {
    const message = error.message ?? "";
    if (isMissingSchema(error)) throw new ClaimNeedsDatabaseUpdateError("This setting needs a database update that has not been applied yet.");
    if (/LEAD_CLAIM_CAMPAIGN_NOT_FOUND/.test(message)) throw new ClaimRefusedError("That list does not exist.", 404);
    if (/LEAD_CLAIM_NO_CLAIMABLE_LEADS/.test(message))
      throw new ClaimRefusedError("Nothing on this list can be claimed now: every creditable row is already on a claim or past the vendor's return window.", 409);
    if (/LEAD_CLAIM_CAMPAIGN_HAS_NO_UNIT_COST/.test(message))
      throw new ClaimRefusedError("This list has no cost per record, so a claim would have no amount. Enter its spend on Vendors & campaigns.", 400);
    if (/LEAD_CLAIM_REASON_INVALID/.test(message)) throw new ClaimRefusedError("Unknown removal reason.", 400);
    if (/lead_claim_items_scrub_rejection_key|duplicate key/i.test(message))
      throw new ClaimRefusedError("Some of these rows were claimed a moment ago. Refresh the page to see them.", 409);
    throw new Error(message || "Could not draft the claim");
  }
  const row = (data ?? {}) as Row;
  return { claimId: text(row.claim_id), rows: num(row.rows), amountClaimedCents: num(row.amount_claimed_cents) };
}
