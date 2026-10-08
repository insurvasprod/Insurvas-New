import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import type { StatementLedgerEntry } from "@/lib/ledger/statementConstants";

import { flaggedFiles } from "./carrierAccountsStore";
import { normalizeLine, rollup, unearnedAdvance, type AdvanceRule, type UnearnedTrace } from "./commissionLedger";

/**
 * LA-4.12 (Notion sprint) · the commission ledger, server side. A commission file's parsed lines go
 * to record_commission_entries, the only writer (20261008220000): new lines are added, changed or
 * vanished ones reversed, and a replaced file's lines reversed — nothing is ever updated or deleted.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const LEDGER_PENDING_MESSAGE = "The commission ledger needs a database update (20261008220000).";

export type RecordOutcome = { available: boolean; inserted: number; kept: number; reversed: number; replaced: number; skipped: Array<{ rowNumber: number; reason: string }> };

/** One commission file's parsed lines into the ledger. Idempotent: the same lines change nothing. */
export async function recordFileEntries(tenantId: string, fileId: string, typedRows: Array<{ rowNumber: number; values: Record<string, string | number | null> }>): Promise<RecordOutcome> {
  const lines = typedRows.map(normalizeLine);
  const skipped = lines.flatMap((outcome) => (outcome.ok ? [] : [{ rowNumber: outcome.rowNumber, reason: outcome.reason }]));
  const rows = lines.flatMap((outcome) => (outcome.ok ? [outcome.line] : []));
  const { data, error } = await db().rpc("record_commission_entries", { p_tenant_id: tenantId, p_file_id: fileId, p_rows: rows });
  if (error) {
    if (isSchemaGap(error)) return { available: false, inserted: 0, kept: 0, reversed: 0, replaced: 0, skipped };
    throw new Error(`Could not record the commission lines: ${error.message}`);
  }
  await db().from("file_registry").update({ derived_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", fileId);
  return { available: true, inserted: Number(data?.inserted ?? 0), kept: Number(data?.kept ?? 0), reversed: Number(data?.reversed ?? 0), replaced: Number(data?.replaced ?? 0), skipped };
}

export type PolicyEntry = {
  id: string;
  type: string;
  correctsType: string | null;
  amountCents: number;
  transactionDate: string | null;
  statementDate: string | null;
  rateBp: number | null;
  monthsAdvanced: number | null;
  payeeLevel: string | null;
  agentIdentifier: string | null;
  reversalReason: string | null;
  fileName: string | null;
  /** LA-4.20: the file and row the line came from, for the raw-row view. */
  fileId: string;
  rowNumber: number;
  createdAt: string;
  /** LA-4.14: its statement doesn't add up, so it is held out of every total until corrected. */
  heldByStatement: boolean;
};

export type PolicyMoney = {
  available: boolean;
  entries: PolicyEntry[];
  totals: ReturnType<typeof rollup> | null;
  unearned: UnearnedTrace | null;
  rule: (NonNullable<AdvanceRule> & { productCode: string; effectiveFrom: string }) | null;
};

/**
 * Advance rules are keyed by our product family (products.code); a carrier file names its own
 * product ("FE Level"). The agency's mapping wins over the platform's; with neither, the carrier's
 * code is used as it is (it may already be ours). The same rule refresh_policy_current follows
 * (20261008300000) for the clawback window.
 */
export async function productFamilyOf(tenantId: string, carrierId: string, carrierProductCode: string | null): Promise<string | null> {
  if (!carrierProductCode) return null;
  const { data } = await db().from("carrier_product_family").select("tenant_id, product_code").eq("carrier_id", carrierId).eq("carrier_product_code", carrierProductCode).or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  const rows = (data ?? []) as Array<{ tenant_id: string | null; product_code: string | null }>;
  return rows.find((r) => r.tenant_id === tenantId)?.product_code ?? rows.find((r) => r.tenant_id === null)?.product_code ?? carrierProductCode;
}

/** Everything the ledger holds for one policy, its totals, and the unearned advance with its trace. */
export async function loadPolicyMoney(tenantId: string, carrierId: string, policyNumber: string, policy: { monthsPaid: number | null; productCode: string | null; asOf: string | null }): Promise<PolicyMoney> {
  const { data, error } = await db().from("commission_entry")
    .select("id, entry_type, corrects_type, amount_cents, transaction_date, statement_date, rate_bp, months_advanced, payee_level, agent_identifier, reversal_reason, file_id, row_number, created_at")
    .eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber)
    .order("transaction_date", { ascending: true, nullsFirst: false }).order("created_at").limit(2000);
  if (error) {
    if (isSchemaGap(error)) return { available: false, entries: [], totals: null, unearned: null, rule: null };
    throw new Error(`Could not load the policy's commission entries: ${error.message}`);
  }
  const rows = (data ?? []) as Loose[];
  if (!rows.length) return { available: true, entries: [], totals: null, unearned: null, rule: null };

  const fileIds = [...new Set(rows.map((row) => row.file_id))];
  const [flagged, family] = await Promise.all([flaggedFiles(tenantId), productFamilyOf(tenantId, carrierId, policy.productCode)]);
  const [files, ruleRead] = await Promise.all([
    db().from("file_registry").select("id, original_filename").eq("tenant_id", tenantId).in("id", fileIds),
    // The LA-0.4 advance rule in force for this carrier and product family on the as-of date.
    family
      ? db().from("advance_rules").select("product_code, advance_months, clawback_months, clawback_type, effective_from").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("product_code", family).lte("effective_from", policy.asOf ?? new Date().toISOString().slice(0, 10)).order("effective_from", { ascending: false }).limit(1)
      : { data: [] },
  ]);
  const fileName = new Map<string, string>((files.data ?? []).map((file: Loose) => [file.id, file.original_filename]));
  const entries: PolicyEntry[] = rows.map((row) => ({
    id: row.id, type: row.entry_type, correctsType: row.corrects_type, amountCents: Number(row.amount_cents), transactionDate: row.transaction_date, statementDate: row.statement_date,
    rateBp: row.rate_bp, monthsAdvanced: row.months_advanced, payeeLevel: row.payee_level, agentIdentifier: row.agent_identifier, reversalReason: row.reversal_reason,
    fileName: fileName.get(row.file_id) ?? null, fileId: row.file_id, rowNumber: row.row_number, createdAt: row.created_at, heldByStatement: flagged.has(row.file_id),
  }));
  const totals = rollup(rows.filter((row) => !flagged.has(row.file_id)));
  const ruleRow = (ruleRead.data ?? [])[0] as Loose;
  const rule = ruleRow ? { advanceMonths: ruleRow.advance_months, clawbackMonths: ruleRow.clawback_months, clawbackType: ruleRow.clawback_type, productCode: ruleRow.product_code, effectiveFrom: ruleRow.effective_from } : null;
  // The statement's own months advanced, from the advance lines that are still standing.
  const statementMonths = entries.filter((entry) => entry.type === "advance" && entry.monthsAdvanced !== null).map((entry) => entry.monthsAdvanced as number).reduce<number | null>((max, months) => (max === null || months > max ? months : max), null);
  const unearned = unearnedAdvance({ advancedCents: totals.advancedCents, chargedBackCents: totals.chargedBackCents, monthsPaid: policy.monthsPaid, rule, statementMonths });
  return { available: true, entries, totals, unearned, rule };
}

/** `orphan`: no policy file has shown this policy yet (LA-4.14) — normal, and claimed automatically when it arrives. */
/**
 * One ledger line. `source: "hand"` is a line from a statement the agency imported by hand and
 * matched to a hand-entered policy (lib/ledger/statementService.ts): `href` opens that statement,
 * `policyHref` the policy's own page. Every other line is from a carrier's commission file.
 */
export type LedgerRow = PolicyEntry & { carrierId: string; carrierName: string; policyNumber: string; agentUserId: string | null; orphan: boolean; source?: "hand"; href?: string; policyHref?: string };

const HAND_KIND: Record<string, string> = { advance: "advance", commission: "earned", chargeback: "chargeback", adjustment: "adjustment" };

/**
 * Accepted lines of hand-imported statements as ledger lines (2026-10-08 overlap merge: one ledger,
 * with a source filter, not a tab per source). The caller scopes them (getStatementLedger's canView);
 * the carrier name is matched to the library so one carrier is one filter choice.
 */
export async function statementLinesAsLedger(entries: StatementLedgerEntry[]): Promise<LedgerRow[]> {
  if (!entries.length) return [];
  const carriers = ((await db().from("carriers").select("id, name")).data ?? []) as Array<{ id: string; name: string }>;
  const byName = new Map(carriers.map((c) => [c.name.trim().toLowerCase(), c]));
  return entries.map((e): LedgerRow => {
    const carrier = byName.get(e.carrierName.trim().toLowerCase());
    return {
      id: `hand:${e.id}`, type: HAND_KIND[e.kind] ?? "adjustment", correctsType: null, amountCents: e.amountCents,
      transactionDate: e.postedOn, statementDate: e.periodEnd, rateBp: null, monthsAdvanced: null, payeeLevel: null, agentIdentifier: null, reversalReason: null,
      fileName: e.fileName, fileId: "", rowNumber: e.lineNumber, createdAt: e.acceptedAt, heldByStatement: false,
      carrierId: carrier?.id ?? `hand:${e.carrierName.trim().toLowerCase()}`, carrierName: carrier?.name ?? e.carrierName, policyNumber: e.policyNumber,
      agentUserId: e.producerUserId, orphan: false,
      source: "hand", href: `/app/statements/${e.statementId}`, policyHref: `/app/policies/${e.policyId}`,
    };
  });
}

/** The ledger itself, newest statement first, for the Commission ledger page. A producer sees their own lines. */
export async function loadLedger(viewer: { tenantId: string; userId: string; role: string }) {
  const rows: Loose[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    let query = db().from("commission_entry")
      .select("id, carrier_id, policy_number, entry_type, corrects_type, amount_cents, transaction_date, statement_date, rate_bp, months_advanced, payee_level, agent_identifier, agent_user_id, reversal_reason, file_id, row_number, created_at")
      .eq("tenant_id", viewer.tenantId);
    if (viewer.role === "producer") query = query.eq("agent_user_id", viewer.userId);
    const { data, error } = await query.order("statement_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) {
      if (isSchemaGap(error)) return { available: false as const };
      throw new Error(`Could not load the commission ledger: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const fileIds = [...new Set(rows.map((row) => row.file_id))];
  const flagged = await flaggedFiles(viewer.tenantId);
  const held: Loose[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data } = await db().from("policy_current").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId).order("carrier_id").order("policy_number").range(from, from + 999);
    held.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const known = new Set(held.map((p) => `${p.carrier_id}|${p.policy_number}`));
  const [carriers, files] = await Promise.all([
    db().from("carriers").select("id, name"),
    fileIds.length ? db().from("file_registry").select("id, original_filename").eq("tenant_id", viewer.tenantId).in("id", fileIds.slice(0, 500)) : { data: [] },
  ]);
  const carrierName = new Map<string, string>((carriers.data ?? []).map((row: Loose) => [row.id, row.name]));
  const fileName = new Map<string, string>((files.data ?? []).map((row: Loose) => [row.id, row.original_filename]));
  const entries: LedgerRow[] = rows.map((row) => ({
    id: row.id, carrierId: row.carrier_id, carrierName: carrierName.get(row.carrier_id) ?? "Carrier not known", policyNumber: row.policy_number, agentUserId: row.agent_user_id,
    type: row.entry_type, correctsType: row.corrects_type, amountCents: Number(row.amount_cents), transactionDate: row.transaction_date, statementDate: row.statement_date,
    rateBp: row.rate_bp, monthsAdvanced: row.months_advanced, payeeLevel: row.payee_level, agentIdentifier: row.agent_identifier, reversalReason: row.reversal_reason,
    fileName: fileName.get(row.file_id) ?? null, fileId: row.file_id, rowNumber: row.row_number, createdAt: row.created_at,
    heldByStatement: flagged.has(row.file_id), orphan: !known.has(`${row.carrier_id}|${row.policy_number}`),
  }));
  return { available: true as const, entries, totals: rollup(rows.filter((row) => !flagged.has(row.file_id))), scoped: viewer.role === "producer" };
}

/**
 * The unearned advance the carriers could still take back, across the book (the Import your book
 * tile): per policy from its ledger lines, as the call list works it out, statements that don't add
 * up held out. Null when no advance is on file at all — Unknown, never $0.
 */
export async function bookAdvanceAtRisk(tenantId: string): Promise<{ cents: number | null; policies: number; unknown: number }> {
  const [policies, lines, flagged] = await Promise.all([
    (async () => { const rows: Loose[] = []; for (let from = 0; from < 50_000; from += 1000) { const { data } = await db().from("policy_current").select("carrier_id, policy_number, months_paid").eq("tenant_id", tenantId).order("carrier_id").order("policy_number").range(from, from + 999); rows.push(...(data ?? [])); if (!data || data.length < 1000) break; } return rows; })(),
    (async () => { const rows: Loose[] = []; for (let from = 0; from < 100_000; from += 1000) { const { data, error } = await db().from("commission_entry").select("carrier_id, policy_number, entry_type, corrects_type, amount_cents, months_advanced, file_id").eq("tenant_id", tenantId).order("id").range(from, from + 999); if (error) return null; rows.push(...(data ?? [])); if (!data || data.length < 1000) break; } return rows; })(),
    flaggedFiles(tenantId),
  ]);
  if (!lines) return { cents: null, policies: 0, unknown: 0 };
  const money = new Map<string, { advanced: number; chargedBack: number; months: number | null }>();
  for (const e of lines) {
    if (flagged.has(e.file_id)) continue;
    const key = `${e.carrier_id}|${e.policy_number}`;
    const m = money.get(key) ?? { advanced: 0, chargedBack: 0, months: null };
    const kind = e.corrects_type ?? e.entry_type;
    if (kind === "advance") { m.advanced += Number(e.amount_cents); if (e.months_advanced !== null) m.months = Math.max(m.months ?? 0, e.months_advanced); }
    if (kind === "chargeback") m.chargedBack += Number(e.amount_cents);
    money.set(key, m);
  }
  let cents = 0, counted = 0, unknown = 0;
  for (const p of policies) {
    const m = money.get(`${p.carrier_id}|${p.policy_number}`);
    if (!m || m.advanced <= 0) continue;
    const atRisk = unearnedAdvance({ advancedCents: m.advanced, chargedBackCents: m.chargedBack, monthsPaid: p.months_paid, rule: null, statementMonths: m.months }).atRiskCents;
    if (atRisk === null) unknown++;
    else { cents += atRisk; counted++; }
  }
  return { cents: counted ? cents : null, policies: counted, unknown };
}
