import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { signProblem, type Basis, type CostEntryType, type CounterpartyType, type NetRow, type Period } from "./costLedgerCore";

/**
 * LA-7.1 (Notion sprint, Module 7 — Accounting) · the cost ledger, server side.
 *
 * Every write goes through the database's own writers (20261015200000): record_cost_entry,
 * reverse_cost_entry, mark_cost_entries_paid. The table refuses edits and deletes, so a correction
 * here is always a reversing entry. This file — and all of LA-7 — only ever READS LA-4.12's
 * commission ledger: it is LA-4's, and immutable.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const LEDGER_PENDING_MESSAGE = "Accounting needs a database update (20261015200000).";

export class LedgerError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(error: { code?: string; message: string }): never {
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new LedgerError(LEDGER_PENDING_MESSAGE, 503);
  if (error.code === "P0002") throw new LedgerError(error.message.replace(/^\w+: /, ""), 404);
  if (error.code === "22023" || error.code === "23514" || error.code === "P0001") throw new LedgerError(error.message.replace(/^\w+: /, ""), 400);
  if (error.code === "23505") throw new LedgerError(error.message.replace(/^\w+: /, ""), 409);
  throw new Error(error.message);
}

export type NewCostEntry = {
  entryType: CostEntryType;
  amountCents: number;
  incurredOn: string;
  paidOn?: string | null;
  counterpartyType: CounterpartyType;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  campaignId?: string | null;
  vendorId?: string | null;
  partnerId?: string | null;
  policyNumber?: string | null;
  carrierId?: string | null;
  producerUserId?: string | null;
  invoiceId?: string | null;
  payoutRunId?: string | null;
  expenseId?: string | null;
  description: string;
  taxCategory?: string | null;
};

export async function recordCostEntry(tenantId: string, entry: NewCostEntry, createdBy: string | null): Promise<string> {
  const problem = signProblem(entry.entryType, entry.amountCents);
  if (problem) throw new LedgerError(problem);
  const { data, error } = await db().rpc("record_cost_entry", {
    p_tenant_id: tenantId,
    p_created_by: createdBy,
    p_entry: {
      entry_type: entry.entryType, amount_cents: entry.amountCents, incurred_on: entry.incurredOn, paid_on: entry.paidOn ?? null,
      counterparty_type: entry.counterpartyType, counterparty_id: entry.counterpartyId ?? null, counterparty_name: entry.counterpartyName ?? null,
      campaign_id: entry.campaignId ?? null, vendor_id: entry.vendorId ?? null, partner_id: entry.partnerId ?? null,
      policy_number: entry.policyNumber ?? null, carrier_id: entry.carrierId ?? null, producer_user_id: entry.producerUserId ?? null,
      invoice_id: entry.invoiceId ?? null, payout_run_id: entry.payoutRunId ?? null, expense_id: entry.expenseId ?? null,
      description: entry.description, tax_category: entry.taxCategory ?? null,
    },
  });
  if (error) fail(error);
  return data as string;
}

/** A correction. Dated today unless `on` is given; the original is never touched. */
export async function reverseCostEntry(tenantId: string, entryId: string, reason: string, by: string | null, on?: string): Promise<string> {
  if (!reason.trim()) throw new LedgerError("Say why the entry is being reversed.");
  const { data, error } = await db().rpc("reverse_cost_entry", { p_tenant_id: tenantId, p_entry_id: entryId, p_reason: reason.trim(), p_by: by, p_on: on ?? null });
  if (error) fail(error);
  return data as string;
}

/** Records when money moved. Changes nothing else; an entry already marked paid is left alone. */
export async function markCostEntriesPaid(tenantId: string, entryIds: string[], paidOn: string): Promise<number> {
  if (!entryIds.length) return 0;
  const { data, error } = await db().rpc("mark_cost_entries_paid", { p_tenant_id: tenantId, p_ids: entryIds, p_paid_on: paidOn });
  if (error) fail(error);
  return Number(data ?? 0);
}

/** Money in and out for a period, per kind, summed in the database (bigint; no float, no row cap). */
export async function moneyNet(tenantId: string, period: Period, basis: Basis): Promise<NetRow[]> {
  const { data, error } = await db().rpc("money_net", { p_tenant_id: tenantId, p_from: period.from, p_to: period.to, p_basis: basis });
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map((r) => ({ side: r.side, entryType: r.entry_type, amountCents: Number(r.amount_cents), entries: Number(r.entries) }));
}

export type MoneyEntryRow = {
  side: "commission" | "cost";
  entryId: string;
  entryType: string;
  amountCents: number;
  incurredOn: string | null;
  paidOn: string | null;
  counterpartyType: string;
  policyNumber: string | null;
  campaignId: string | null;
  vendorId: string | null;
  invoiceId: string | null;
  payoutRunId: string | null;
  expenseId: string | null;
  sourceFileId: string | null;
  description: string | null;
  reversesEntryId: string | null;
};

export type MoneyFilter = { period?: Period; basis?: Basis; side?: "commission" | "cost"; entryTypes?: string[]; vendorId?: string; campaignId?: string; partnerId?: string; producerUserId?: string; policyNumber?: string; invoiceId?: string; payoutRunId?: string; expenseId?: string; expenseIds?: string[]; noExpense?: boolean; noPartner?: boolean };

/** The entries behind a figure — every P&L number drills through to these. Paged: the API caps a read at 1,000 rows. */
export async function moneyEntries(tenantId: string, filter: MoneyFilter, page = 0, pageSize = 200): Promise<{ rows: MoneyEntryRow[]; more: boolean }> {
  const dateCol = filter.basis === "cash" ? "paid_on" : "incurred_on";
  let q = db().from("money_entry").select("side, entry_id, entry_type, amount_cents, incurred_on, paid_on, counterparty_type, policy_number, campaign_id, vendor_id, invoice_id, payout_run_id, expense_id, source_file_id, description, reverses_entry_id").eq("tenant_id", tenantId);
  if (filter.period) q = q.gte(dateCol, filter.period.from).lt(dateCol, filter.period.to);
  if (filter.side) q = q.eq("side", filter.side);
  if (filter.entryTypes?.length) q = q.in("entry_type", filter.entryTypes);
  if (filter.vendorId) q = q.eq("vendor_id", filter.vendorId);
  if (filter.campaignId) q = q.eq("campaign_id", filter.campaignId);
  if (filter.partnerId) q = q.eq("partner_id", filter.partnerId);
  if (filter.producerUserId) q = q.eq("producer_user_id", filter.producerUserId);
  if (filter.policyNumber) q = q.eq("policy_number", filter.policyNumber);
  if (filter.invoiceId) q = q.eq("invoice_id", filter.invoiceId);
  if (filter.payoutRunId) q = q.eq("payout_run_id", filter.payoutRunId);
  if (filter.expenseId) q = q.eq("expense_id", filter.expenseId);
  if (filter.expenseIds) q = q.in("expense_id", filter.expenseIds);
  if (filter.noExpense) q = q.is("expense_id", null);
  if (filter.noPartner) q = q.is("partner_id", null);
  const { data, error } = await q.order(dateCol, { ascending: false }).order("entry_id").range(page * pageSize, page * pageSize + pageSize);
  if (error) fail(error);
  const rows = ((data ?? []) as Loose[]).map((r) => ({
    side: r.side, entryId: r.entry_id, entryType: r.entry_type, amountCents: Number(r.amount_cents), incurredOn: r.incurred_on, paidOn: r.paid_on,
    counterpartyType: r.counterparty_type, policyNumber: r.policy_number, campaignId: r.campaign_id, vendorId: r.vendor_id, invoiceId: r.invoice_id,
    payoutRunId: r.payout_run_id, expenseId: r.expense_id, sourceFileId: r.source_file_id, description: r.description, reversesEntryId: r.reverses_entry_id,
  }));
  return { rows: rows.slice(0, pageSize), more: rows.length > pageSize };
}
