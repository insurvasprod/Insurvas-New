import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { acquisitionFor, bucketOf, readDefaults, scoreboard, type CostLine, type ExpenseBucket, type ExpenseCategory, type ExpenseStatus, type Recurrence, type Scoreboard } from "./expensesCore";
import type { PaidMethod } from "./invoicesCore";

/**
 * LA-7.3 (Notion sprint, Module 7 — Accounting) · expenses, server side.
 *
 * A one-off a person enters is confirmed as they save it — they are the confirmation. A recurring
 * template's instances arrive unconfirmed (generate_recurring_expenses, daily and on opening the
 * page) and book nothing until confirmed. Booking, paying and voiding go through the database's
 * writers (20261015220000).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const EXPENSES_PENDING_MESSAGE = "Expenses need a database update (20261015200000–20261015220000).";
/** Lead buys and the one-click OK (owner, 2026-11-06) wait for this paste. */
export const LEAD_BUYS_PENDING_MESSAGE = "Lead buys need a database update (supabase/deploy/2026-11-06-expense-buckets.sql). Until then, enter lead invoices in Vendor bills.";

export class ExpenseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(error: { code?: string; message: string }): never {
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new ExpenseError(EXPENSES_PENDING_MESSAGE, 503);
  if (error.code === "P0002") throw new ExpenseError(error.message.replace(/^\w+: /, ""), 404);
  if (error.code === "22023" || error.code === "23514" || error.code === "P0001") throw new ExpenseError(error.message.replace(/^\w+: /, ""), 400);
  throw new Error(error.message);
}

export type ExpenseRow = {
  id: string;
  category: ExpenseCategory;
  vendorName: string;
  description: string | null;
  amountCents: number;
  incurredOn: string;
  paidOn: string | null;
  paidMethod: PaidMethod | null;
  recurrence: Recurrence;
  recurrenceEndOn: string | null;
  parentExpenseId: string | null;
  status: ExpenseStatus;
  isAcquisitionCost: boolean;
  acquisitionOverridden: boolean;
  voidReason: string | null;
  hasReceipt: boolean;
};

const toRow = (r: Loose): ExpenseRow => ({
  id: r.id, category: r.category, vendorName: r.vendor_name, description: r.description, amountCents: Number(r.amount_cents), incurredOn: r.incurred_on,
  paidOn: r.paid_on, paidMethod: r.paid_method, recurrence: r.recurrence, recurrenceEndOn: r.recurrence_end_on, parentExpenseId: r.parent_expense_id,
  status: r.status, isAcquisitionCost: !!r.is_acquisition_cost, acquisitionOverridden: !!r.acquisition_overridden, voidReason: r.void_reason,
  hasReceipt: !!r.document_path,
});

export async function acquisitionDefaults(tenantId: string) {
  const { data } = await db().from("accounting_settings").select("acquisition_defaults").eq("tenant_id", tenantId).maybeSingle();
  return readDefaults(data?.acquisition_defaults);
}

/** Bring recurring templates up to today: unconfirmed instances, never booked. */
export async function generateRecurring(tenantId: string): Promise<number> {
  const { data, error } = await db().rpc("generate_recurring_expenses", { p_tenant_id: tenantId, p_through: new Date().toISOString().slice(0, 10) });
  if (error) fail(error);
  return Number(data ?? 0);
}

export async function listExpenses(tenantId: string): Promise<ExpenseRow[]> {
  const { data, error } = await db().from("expense").select("*").eq("tenant_id", tenantId).order("incurred_on", { ascending: false }).order("id").limit(1000);
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map(toRow);
}

export type ExpenseInput = {
  category: ExpenseCategory;
  vendorName: string;
  description: string | null;
  amountCents: number;
  incurredOn: string;
  recurrence: Recurrence;
  recurrenceEndOn: string | null;
  /** null = the agency's default for the category. */
  isAcquisitionCost: boolean | null;
  paidOn?: string | null;
  paidMethod?: PaidMethod | null;
  paymentReference?: string | null;
};

/** A one-off is booked as it is saved; a recurring one becomes a template and its first instances. */
export async function createExpense(tenantId: string, userId: string, input: ExpenseInput): Promise<{ id: string; generated: number }> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new ExpenseError("Enter the amount in dollars and cents.");
  const acq = acquisitionFor(input.category, await acquisitionDefaults(tenantId), input.isAcquisitionCost);
  const template = input.recurrence !== "one_off";
  const { data, error } = await db().from("expense").insert({
    tenant_id: tenantId, category: input.category, vendor_name: input.vendorName.trim(), description: input.description?.trim() || null,
    amount_cents: input.amountCents, incurred_on: input.incurredOn, recurrence: input.recurrence, recurrence_end_on: template ? input.recurrenceEndOn : null,
    status: template ? "template" : "unconfirmed", is_acquisition_cost: acq.isAcquisitionCost, acquisition_overridden: acq.overridden, created_by: userId,
  }).select("id").single();
  // Before the 2026-11-06 paste the database does not know the leads category yet.
  if (error && input.category === "leads" && error.code === "23514") throw new ExpenseError(LEAD_BUYS_PENDING_MESSAGE, 503);
  if (error) fail(error);
  if (template) return { id: data.id as string, generated: await generateRecurring(tenantId) };
  await confirmExpense(tenantId, data.id, userId);
  if (input.paidOn) await markExpensePaid(tenantId, data.id, { paidOn: input.paidOn, method: input.paidMethod ?? null, reference: input.paymentReference ?? null });
  return { id: data.id as string, generated: 0 };
}

/** Edit a template (future instances only) or an unconfirmed instance. The database refuses a booked one. */
export async function updateExpense(tenantId: string, id: string, input: Partial<Omit<ExpenseInput, "recurrence">>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.category) patch.category = input.category;
  if (input.vendorName) patch.vendor_name = input.vendorName.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.amountCents !== undefined) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new ExpenseError("Enter the amount in dollars and cents.");
    patch.amount_cents = input.amountCents;
  }
  if (input.incurredOn) patch.incurred_on = input.incurredOn;
  if (input.recurrenceEndOn !== undefined) patch.recurrence_end_on = input.recurrenceEndOn;
  const { error } = await db().from("expense").update(patch).eq("tenant_id", tenantId).eq("id", id);
  if (error) fail(error);
}

/** Acquisition or overhead for one expense — allowed after booking: it is a classification, not money. */
export async function classifyExpense(tenantId: string, id: string, isAcquisitionCost: boolean): Promise<void> {
  const { data: row, error: re } = await db().from("expense").select("category").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (re) fail(re);
  if (!row) throw new ExpenseError("That expense isn't in this agency.", 404);
  const acq = acquisitionFor(row.category, await acquisitionDefaults(tenantId), isAcquisitionCost);
  const { error } = await db().from("expense").update({ is_acquisition_cost: acq.isAcquisitionCost, acquisition_overridden: acq.overridden }).eq("tenant_id", tenantId).eq("id", id);
  if (error) fail(error);
}

export async function confirmExpense(tenantId: string, id: string, by: string): Promise<string> {
  const { data, error } = await db().rpc("confirm_expense", { p_tenant_id: tenantId, p_expense_id: id, p_by: by });
  if (error) fail(error);
  return data as string;
}

export async function voidExpense(tenantId: string, id: string, reason: string, by: string): Promise<number> {
  const { data, error } = await db().rpc("void_expense", { p_tenant_id: tenantId, p_expense_id: id, p_reason: reason, p_by: by });
  if (error) fail(error);
  return Number(data ?? 0);
}

export async function markExpensePaid(tenantId: string, id: string, input: { paidOn: string; method: PaidMethod | null; reference: string | null }): Promise<number> {
  const { data, error } = await db().rpc("mark_expense_paid", { p_tenant_id: tenantId, p_expense_id: id, p_paid_on: input.paidOn, p_method: input.method, p_reference: input.reference });
  if (error) fail(error);
  return Number(data ?? 0);
}

const RECEIPT_TYPES = ["application/pdf", "image/png", "image/jpeg"];

/** The receipt, in tenant-scoped storage (the invoices' bucket). */
export async function attachReceipt(tenantId: string, id: string, file: File): Promise<void> {
  if (!file.size) throw new ExpenseError("That file is empty.");
  if (file.size > 10 * 1024 * 1024) throw new ExpenseError("Files up to 10 MB.");
  if (!RECEIPT_TYPES.includes(file.type)) throw new ExpenseError("PDF, PNG or JPEG only.");
  const { data: row, error: re } = await db().from("expense").select("id").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (re) fail(re);
  if (!row) throw new ExpenseError("That expense isn't in this agency.", 404);
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "receipt";
  const path = `${tenantId}/expenses/${id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await db().storage.from("accounting-files").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw new ExpenseError(/bucket/i.test(error.message) ? EXPENSES_PENDING_MESSAGE : `Could not store the file: ${error.message}`, /bucket/i.test(error.message) ? 503 : 500);
  const { error: ue } = await db().from("expense").update({ document_path: path, document_name: file.name.slice(0, 200) }).eq("tenant_id", tenantId).eq("id", id);
  if (ue) fail(ue);
}

/** A 60-second link to the receipt. */
export async function receiptUrl(tenantId: string, id: string): Promise<string> {
  const { data: r, error } = await db().from("expense").select("document_path").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) fail(error);
  const path = r?.document_path as string | undefined;
  if (!path || !path.startsWith(`${tenantId}/expenses/${id}/`)) throw new ExpenseError("No receipt is attached.", 404);
  const { data, error: se } = await db().storage.from("accounting-files").createSignedUrl(path, 60);
  if (se || !data?.signedUrl) throw new ExpenseError("The receipt could not be opened.", 500);
  return data.signedUrl;
}

// ─── OK and the scoreboard (owner, 2026-11-06) ────────────────────────────────────────────────

/**
 * OK on a bill that came back: book it and stamp it paid, in one step (ok_expense, 20261106120000).
 * Before that paste, the same two writers run one after the other.
 */
export async function okExpense(tenantId: string, id: string, by: string, input: { paidOn: string; method: PaidMethod | null; reference: string | null }): Promise<void> {
  const { error } = await db().rpc("ok_expense", { p_tenant_id: tenantId, p_expense_id: id, p_by: by, p_paid_on: input.paidOn, p_method: input.method, p_reference: input.reference });
  if (!error) return;
  if (error.code !== "PGRST202" && error.code !== "42883") fail(error);
  await confirmExpense(tenantId, id, by);
  await markExpensePaid(tenantId, id, input);
}

export type ScoreboardItem = { what: string; bucket: ExpenseBucket; amountCents: number; fromInvoice: boolean };
export type MonthScoreboard = Scoreboard & { month: string; items: ScoreboardItem[] };

/**
 * The end-of-month scoreboard: everything booked in the month (by the day it was for), in total and per
 * bucket. Leads are the lead invoices from Vendor bills plus lead buys entered as expenses; reversals
 * (a voided bill) net out. With the biggest items per bucket.
 */
export async function monthScoreboard(tenantId: string, month: string): Promise<MonthScoreboard> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ExpenseError("Choose a month.");
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const rows: Loose[] = [];
  for (let at = 0; at < 50_000; at += 1000) {
    const { data, error } = await db().from("cost_entry").select("entry_type, amount_cents, expense_id, invoice_id, description, counterparty_name")
      .eq("tenant_id", tenantId).gte("incurred_on", from).lt("incurred_on", to).order("id").range(at, at + 999);
    if (error) fail(error);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const expenseIds = [...new Set(rows.map((r) => r.expense_id).filter(Boolean))] as string[];
  const categories = new Map<string, string>();
  for (let i = 0; i < expenseIds.length; i += 200) {
    const { data, error } = await db().from("expense").select("id, category").eq("tenant_id", tenantId).in("id", expenseIds.slice(i, i + 200));
    if (error) fail(error);
    for (const e of (data ?? []) as Loose[]) categories.set(e.id, e.category);
  }
  const lines: (CostLine & { what: string; fromInvoice: boolean })[] = rows.map((r) => ({
    entryType: r.entry_type, amountCents: Number(r.amount_cents), expenseCategory: r.expense_id ? categories.get(r.expense_id) ?? "other" : null,
    what: (r.counterparty_name as string | null) || String(r.description ?? "").split(" — ")[0] || "Cost", fromInvoice: !r.expense_id && r.entry_type === "lead_cost",
  }));
  const board = scoreboard(lines);
  // The biggest items: one line per bucket and payee, money out as positive cents.
  const grouped = new Map<string, ScoreboardItem>();
  for (const l of lines) {
    const bucket: ExpenseBucket | null = l.expenseCategory ? bucketOf(l.expenseCategory) : l.entryType === "lead_cost" ? "leads" : null;
    if (!bucket) continue;
    const key = `${bucket}|${l.what}`;
    const item = grouped.get(key) ?? { what: l.what, bucket, amountCents: 0, fromInvoice: l.fromInvoice };
    item.amountCents -= l.amountCents;
    grouped.set(key, item);
  }
  const items = [...grouped.values()].filter((i) => i.amountCents !== 0).sort((a, b) => b.amountCents - a.amountCents);
  return { ...board, month, items };
}
