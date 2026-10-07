import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

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
  const flagged = await flaggedFiles(tenantId);
  const [files, ruleRead] = await Promise.all([
    db().from("file_registry").select("id, original_filename").eq("tenant_id", tenantId).in("id", fileIds),
    // The LA-0.4 advance rule in force for this carrier and product on the as-of date.
    policy.productCode
      ? db().from("advance_rules").select("product_code, advance_months, clawback_months, clawback_type, effective_from").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("product_code", policy.productCode).lte("effective_from", policy.asOf ?? new Date().toISOString().slice(0, 10)).order("effective_from", { ascending: false }).limit(1)
      : { data: [] },
  ]);
  const fileName = new Map<string, string>((files.data ?? []).map((file: Loose) => [file.id, file.original_filename]));
  const entries: PolicyEntry[] = rows.map((row) => ({
    id: row.id, type: row.entry_type, correctsType: row.corrects_type, amountCents: Number(row.amount_cents), transactionDate: row.transaction_date, statementDate: row.statement_date,
    rateBp: row.rate_bp, monthsAdvanced: row.months_advanced, payeeLevel: row.payee_level, agentIdentifier: row.agent_identifier, reversalReason: row.reversal_reason,
    fileName: fileName.get(row.file_id) ?? null, rowNumber: row.row_number, createdAt: row.created_at, heldByStatement: flagged.has(row.file_id),
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
export type LedgerRow = PolicyEntry & { carrierId: string; carrierName: string; policyNumber: string; agentUserId: string | null; orphan: boolean };

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
    fileName: fileName.get(row.file_id) ?? null, rowNumber: row.row_number, createdAt: row.created_at,
    heldByStatement: flagged.has(row.file_id), orphan: !known.has(`${row.carrier_id}|${row.policy_number}`),
  }));
  return { available: true as const, entries, totals: rollup(rows.filter((row) => !flagged.has(row.file_id))), scoped: viewer.role === "producer" };
}
