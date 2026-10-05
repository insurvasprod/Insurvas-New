import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getCarrierLibrary } from "@/lib/carriers/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { getCommissionLedger } from "@/lib/ledger/service";

import {
  computeDiscrepancies,
  owedSummary,
  type CoveredPeriod,
  type DiscrepancyFinding,
  type DiscrepancyKind,
  type DiscrepancyPolicy,
  type ExpectedEntry,
  type ReceivedEntry,
} from "./compute";

/**
 * LA-4.4 · the stored discrepancies: gathering the facts, refreshing the findings, and a person's
 * decisions on them.
 *
 * `refreshDiscrepancies` recomputes everything from the book, the carrier library and the accepted
 * statement lines, then writes it back keyed by fingerprint:
 *
 *   · a new finding is inserted, open;
 *   · an open or disputed one gets its current figures;
 *   · a cleared one that applies again is reopened;
 *   · a resolved or written-off one is left as the person decided;
 *   · an open or disputed one that no longer applies is marked cleared.
 *
 * It runs after every statement change (import, decision, void, typed lines) and when the
 * Discrepancies page opens, so a policy edited since is reflected. Before migration 20261002110000
 * every read answers `available: false` and the refresh does nothing.
 */

export const DISCREPANCY_SCHEMA_PENDING_MESSAGE =
  "Discrepancies need a database update. Until it is applied, the ledger and statements work as before and nothing is flagged as owed.";

export const DISCREPANCY_STATUSES = ["open", "disputed", "resolved", "written_off", "cleared"] as const;
export type DiscrepancyStatus = (typeof DISCREPANCY_STATUSES)[number];
/** What a person may set. `cleared` is the refresh's alone. */
export const SETTABLE_DISCREPANCY_STATUSES = ["open", "disputed", "resolved", "written_off"] as const;
export type SettableDiscrepancyStatus = (typeof SETTABLE_DISCREPANCY_STATUSES)[number];

type DbError = { message: string; code?: string };
type Result<T = unknown> = { data: T; error: DbError | null };
type Query = PromiseLike<Result> & {
  select(columns: string, options?: unknown): Query;
  eq(column: string, value: unknown): Query;
  neq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  order(column: string, options?: unknown): Query;
  range(from: number, to: number): Query;
  update(values: unknown): Query;
  upsert(values: unknown, options?: unknown): Query;
  maybeSingle<T = unknown>(): Promise<Result<T>>;
};
const db = () => getSupabaseServiceClient() as unknown as { from(table: string): Query };
const PAGE = 1000;

async function readAll<T>(build: () => Query): Promise<{ rows: T[]; error: DbError | null }> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const page = await build().range(start, start + PAGE - 1);
    if (page.error) return { rows, error: page.error };
    const data = (page.data ?? []) as T[];
    rows.push(...data);
    if (data.length < PAGE) return { rows, error: null };
  }
}

const normalise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
const chunks = <T,>(items: T[], size = 200) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

type PolicyRow = { id: string; policy_number: string; insured_name: string; carrier: string; status: string; effective_date: string; created_by: string | null };
type EntryRow = { line_id: string; statement_id: string; carrier_id: string; period_start: string; period_end: string; amount_cents: number | string; kind: ReceivedEntry["kind"]; posted_on: string; policy_id: string };

/** Everything the engine reads, for one tenant. */
async function gather(tenantId: string, today: string) {
  const [ledger, library, policies, entries, statements] = await Promise.all([
    getCommissionLedger({ tenantId, canView: () => true, today }),
    getCarrierLibrary(tenantId),
    readAll<PolicyRow>(() => db().from("tenant_policies").select("id, policy_number, insured_name, carrier, status, effective_date, created_by").eq("tenant_id", tenantId).order("id")),
    readAll<EntryRow>(() => db().from("tenant_commission_statement_entries").select("line_id, statement_id, carrier_id, period_start, period_end, amount_cents, kind, posted_on, policy_id").eq("tenant_id", tenantId).order("line_id")),
    readAll<{ id: string; carrier_id: string; period_start: string; period_end: string; status: string }>(() => db().from("tenant_commission_statements").select("id, carrier_id, period_start, period_end, status").eq("tenant_id", tenantId).neq("status", "voided").order("id")),
  ]);
  for (const read of [policies, entries, statements]) if (read.error) throw new Error(`Could not read the book for discrepancies: ${read.error.message}`);

  // LA-4.3 premium and rate, when the carrier showed them (after 20261002100000).
  const rates = new Map<string, { premium: number | null; rate: number | null }>();
  for (const part of chunks(entries.rows.map((row) => row.line_id))) {
    const read = await db().from("tenant_commission_statement_lines").select("id, premium_cents, rate_bp").eq("tenant_id", tenantId).in("id", part);
    if (read.error) { if (isSchemaGap(read.error)) break; throw new Error(`Could not read statement rates: ${read.error.message}`); }
    for (const row of (read.data ?? []) as Array<{ id: string; premium_cents: number | string | null; rate_bp: number | null }>) {
      rates.set(row.id, { premium: row.premium_cents === null ? null : Number(row.premium_cents), rate: row.rate_bp });
    }
  }

  const carrierOf = (text: string) => library.carriers.find((carrier) => normalise(carrier.code) === normalise(text) || normalise(carrier.name) === normalise(text)) ?? null;
  const policyRows: DiscrepancyPolicy[] = policies.rows.map((row) => {
    const carrier = carrierOf(row.carrier);
    return { id: row.id, policyNumber: row.policy_number, insuredName: row.insured_name, carrierId: carrier?.id ?? null, carrierName: carrier?.name ?? row.carrier, status: row.status, effectiveDate: row.effective_date };
  });
  const expected: ExpectedEntry[] = ledger.entries.map((entry) => ({ id: entry.id, policyId: entry.policyId, kind: entry.kind, amountCents: entry.amountCents, postedOn: entry.postedOn, rateBp: entry.rateBp, premiumCents: entry.premiumCents }));
  const received: ReceivedEntry[] = entries.rows.map((row) => ({
    id: row.line_id, policyId: row.policy_id, statementId: row.statement_id, carrierId: row.carrier_id, kind: row.kind,
    amountCents: Number(row.amount_cents), postedOn: row.posted_on, periodStart: row.period_start, periodEnd: row.period_end,
    rateBp: rates.get(row.line_id)?.rate ?? null, premiumCents: rates.get(row.line_id)?.premium ?? null,
  }));
  // A PDF still waiting for its lines says nothing yet about what the carrier paid.
  const coverage: CoveredPeriod[] = statements.rows.filter((row) => row.status !== "awaiting_entry").map((row) => ({ statementId: row.id, carrierId: row.carrier_id, periodStart: row.period_start, periodEnd: row.period_end }));
  return { policies: policyRows, expected, received, coverage, producerOf: new Map(policies.rows.map((row) => [row.id, row.created_by])) };
}

type StoredRow = {
  id: string; fingerprint: string; kind: DiscrepancyKind; policy_id: string; carrier_id: string | null; period_start: string | null; period_end: string | null;
  owed_cents: number | string; detail: DiscrepancyFinding["detail"]; status: DiscrepancyStatus; note: string | null;
  status_changed_by: string | null; status_changed_at: string | null; first_seen_at: string; last_seen_at: string;
};
const COLUMNS = "id, fingerprint, kind, policy_id, carrier_id, period_start, period_end, owed_cents, detail, status, note, status_changed_by, status_changed_at, first_seen_at, last_seen_at";

export type RefreshResult = { available: boolean; found: number; opened: number; cleared: number };

/** Recomputes and stores every finding for a tenant. See the header for what changes and what never does. */
export async function refreshDiscrepancies(tenantId: string, today = new Date().toISOString().slice(0, 10)): Promise<RefreshResult> {
  const existing = await readAll<Pick<StoredRow, "id" | "fingerprint" | "status">>(() => db().from("tenant_commission_discrepancies").select("id, fingerprint, status").eq("tenant_id", tenantId).order("id"));
  if (existing.error) {
    if (isSchemaGap(existing.error)) return { available: false, found: 0, opened: 0, cleared: 0 };
    throw new Error(`Could not read discrepancies: ${existing.error.message}`);
  }
  const inputs = await gather(tenantId, today);
  const findings = computeDiscrepancies({ ...inputs, today });
  const byFingerprint = new Map(existing.rows.map((row) => [row.fingerprint, row]));
  const now = new Date().toISOString();

  const writes: Record<string, unknown>[] = [];
  let opened = 0;
  for (const finding of findings) {
    const stored = byFingerprint.get(finding.fingerprint);
    if (stored && (stored.status === "resolved" || stored.status === "written_off")) continue;
    const status: DiscrepancyStatus = !stored || stored.status === "cleared" ? "open" : stored.status;
    if (status === "open" && (!stored || stored.status === "cleared")) opened += 1;
    writes.push({
      tenant_id: tenantId, fingerprint: finding.fingerprint, kind: finding.kind, policy_id: finding.policyId, carrier_id: finding.carrierId,
      period_start: finding.periodStart, period_end: finding.periodEnd, owed_cents: finding.owedCents, detail: finding.detail, status, last_seen_at: now,
    });
  }
  for (const part of chunks(writes, 500)) {
    const up = await db().from("tenant_commission_discrepancies").upsert(part, { onConflict: "tenant_id,fingerprint" });
    if (up.error) throw new Error(`Could not store discrepancies: ${up.error.message}`);
  }

  const live = new Set(findings.map((finding) => finding.fingerprint));
  const stale = existing.rows.filter((row) => !live.has(row.fingerprint) && (row.status === "open" || row.status === "disputed")).map((row) => row.id);
  for (const part of chunks(stale)) {
    const cleared = await db().from("tenant_commission_discrepancies").update({ status: "cleared", status_changed_by: null, status_changed_at: now }).eq("tenant_id", tenantId).in("id", part);
    if (cleared.error) throw new Error(`Could not clear discrepancies: ${cleared.error.message}`);
  }
  return { available: true, found: findings.length, opened, cleared: stale.length };
}

/** A refresh after a statement change: never fails the change it follows. */
export async function refreshDiscrepanciesQuietly(tenantId: string): Promise<void> {
  try {
    await refreshDiscrepancies(tenantId);
  } catch (error) {
    console.error("[discrepancies] refresh after a statement change failed", error);
  }
}

export type DiscrepancyView = {
  id: string;
  kind: DiscrepancyKind;
  status: DiscrepancyStatus;
  owedCents: number;
  policyId: string;
  policyNumber: string;
  insuredName: string;
  carrierId: string | null;
  carrierName: string;
  periodStart: string | null;
  periodEnd: string | null;
  detail: DiscrepancyFinding["detail"];
  note: string | null;
  statusChangedByName: string | null;
  statusChangedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

/** Every stored finding with the labels the page shows. Before the migration: `available: false`. */
export async function listDiscrepancies(tenantId: string): Promise<{ available: boolean; items: DiscrepancyView[] }> {
  const rows = await readAll<StoredRow>(() => db().from("tenant_commission_discrepancies").select(COLUMNS).eq("tenant_id", tenantId).order("owed_cents", { ascending: false }).order("id"));
  if (rows.error) {
    if (isSchemaGap(rows.error)) return { available: false, items: [] };
    throw new Error(`Could not load discrepancies: ${rows.error.message}`);
  }
  const policyIds = [...new Set(rows.rows.map((row) => row.policy_id))];
  const carrierIds = [...new Set(rows.rows.map((row) => row.carrier_id).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set(rows.rows.map((row) => row.status_changed_by).filter((id): id is string => Boolean(id)))];
  const policies = new Map<string, { policy_number: string; insured_name: string; carrier: string }>();
  for (const part of chunks(policyIds)) {
    const read = await db().from("tenant_policies").select("id, policy_number, insured_name, carrier").eq("tenant_id", tenantId).in("id", part);
    if (read.error) throw new Error(`Could not load policies: ${read.error.message}`);
    for (const row of (read.data ?? []) as Array<{ id: string; policy_number: string; insured_name: string; carrier: string }>) policies.set(row.id, row);
  }
  const carriers = new Map<string, string>();
  if (carrierIds.length) {
    const read = await db().from("carriers").select("id, name").in("id", carrierIds);
    if (read.error) throw new Error(`Could not load carriers: ${read.error.message}`);
    for (const row of (read.data ?? []) as Array<{ id: string; name: string }>) carriers.set(row.id, row.name);
  }
  const names = new Map<string, string>();
  if (userIds.length) {
    const read = await db().from("users").select("id, name").in("id", userIds);
    if (!read.error) for (const row of (read.data ?? []) as Array<{ id: string; name: string }>) names.set(row.id, row.name);
  }
  return {
    available: true,
    items: rows.rows.map((row) => {
      const policy = policies.get(row.policy_id);
      return {
        id: row.id, kind: row.kind, status: row.status, owedCents: Number(row.owed_cents), policyId: row.policy_id,
        policyNumber: policy?.policy_number ?? "Unknown policy", insuredName: policy?.insured_name ?? "",
        carrierId: row.carrier_id, carrierName: (row.carrier_id && carriers.get(row.carrier_id)) || policy?.carrier || "Unknown carrier",
        periodStart: row.period_start, periodEnd: row.period_end, detail: row.detail ?? ({} as DiscrepancyFinding["detail"]), note: row.note,
        statusChangedByName: row.status_changed_by ? names.get(row.status_changed_by) ?? null : null, statusChangedAt: row.status_changed_at,
        firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
      };
    }),
  };
}

export class DiscrepancyError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "DiscrepancyError"; }
}

/** A person's decision on one finding. Returns what it was, for the audit row. */
export async function setDiscrepancyStatus(tenantId: string, actorUserId: string, id: string, status: SettableDiscrepancyStatus, note: string | null) {
  const before = await db().from("tenant_commission_discrepancies").select("id, status, note, kind, policy_id, owed_cents").eq("tenant_id", tenantId).eq("id", id).maybeSingle<{ id: string; status: DiscrepancyStatus; note: string | null; kind: DiscrepancyKind; policy_id: string; owed_cents: number | string }>();
  if (before.error) {
    if (isSchemaGap(before.error)) throw new DiscrepancyError(DISCREPANCY_SCHEMA_PENDING_MESSAGE, 503, "schema_pending");
    throw new Error(`Could not load the discrepancy: ${before.error.message}`);
  }
  if (!before.data) throw new DiscrepancyError("That discrepancy is not in this workspace.", 404, "not_found");
  if (before.data.status === "cleared") throw new DiscrepancyError("This discrepancy no longer applies — the facts behind it changed — so there is nothing to decide.", 409, "cleared");
  const update = await db().from("tenant_commission_discrepancies")
    .update({ status, note: note?.trim() || before.data.note, status_changed_by: actorUserId, status_changed_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", id);
  if (update.error) throw new Error(`Could not record the decision: ${update.error.message}`);
  return { from: before.data.status, to: status, kind: before.data.kind, policyId: before.data.policy_id, owedCents: Number(before.data.owed_cents) };
}

/**
 * LA-4.6 · what the carriers appear to owe right now: the open and disputed findings, summed. One
 * read of the stored rows — no ledger recompute — so the dashboard stays inside its budget.
 */
export async function owedToYou(tenantId: string): Promise<{ available: boolean; totalCents: number; count: number; byKind: ReturnType<typeof owedSummary>["byKind"] }> {
  const rows = await readAll<{ kind: DiscrepancyKind; owed_cents: number | string; status: DiscrepancyStatus }>(() => db().from("tenant_commission_discrepancies").select("kind, owed_cents, status").eq("tenant_id", tenantId).in("status", ["open", "disputed"]).order("id"));
  if (rows.error) {
    if (isSchemaGap(rows.error)) return { available: false, ...owedSummary([]) };
    throw new Error(`Could not total discrepancies: ${rows.error.message}`);
  }
  return { available: true, ...owedSummary(rows.rows.map((row) => ({ kind: row.kind, owedCents: Number(row.owed_cents) }))) };
}
