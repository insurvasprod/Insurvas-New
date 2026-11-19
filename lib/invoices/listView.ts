// Admin › Billing › Invoices (billing-r2 screen 5): what the list shows, read from the address.
//
// The lens, the search, the customer, the status, the Issued window and the overdue age all live in the
// URL, so a link from the Billing workspace (/admin/invoices?lens=overdue&age=60+) lands on exactly that
// list, a refresh keeps it, and the figures and the rows come from one filter. Plain module: the page,
// the table and node:test all use it.

import { csvCell } from "../csv/cell.ts";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatus, type ReconciliationState } from "./constants.ts";

/** The fields of a list row this module reads (lib/invoices/queries.ts InvoiceListRow). */
export type ListInvoice = {
  id: string;
  number: string;
  tenant_id: string;
  tenant_name: string;
  status: InvoiceStatus;
  total_cents: number;
  provider_total_cents: number | null;
  reconciliation: ReconciliationState;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export const INVOICE_LENSES = ["all", "overdue", "mismatched"] as const;
export type InvoiceLens = (typeof INVOICE_LENSES)[number];
export const INVOICE_LENS_LABELS: Record<InvoiceLens, string> = { all: "All", overdue: "Overdue", mismatched: "Don't match" };

export const OVERDUE_AGES = ["0-30", "31-60", "60+"] as const;
export type OverdueAge = (typeof OVERDUE_AGES)[number];
export const OVERDUE_AGE_LABELS: Record<OverdueAge, string> = { "0-30": "0–30 days", "31-60": "31–60 days", "60+": "60+ days" };

export const ISSUED_WINDOWS = ["this-month", "last-month", "90d", "this-year"] as const;
export type IssuedWindow = (typeof ISSUED_WINDOWS)[number];
export const ISSUED_WINDOW_LABELS: Record<IssuedWindow, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "90d": "Last 90 days",
  "this-year": "This year",
};

export type InvoiceView = {
  lens: InvoiceLens;
  q: string;
  tenant: string;
  status: InvoiceStatus | "all";
  issued: IssuedWindow | "any";
  age: OverdueAge | "any";
};

export const DEFAULT_INVOICE_VIEW: InvoiceView = { lens: "all", q: "", tenant: "", status: "all", issued: "any", age: "any" };

/** Spellings a link may reasonably use for each lens; anything else reads as All. */
const LENS_ALIASES: Record<string, InvoiceLens> = {
  all: "all",
  overdue: "overdue",
  late: "overdue",
  mismatched: "mismatched",
  mismatch: "mismatched",
  "dont-match": "mismatched",
  "don't-match": "mismatched",
  unmatched: "mismatched",
};

type Params = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function read(params: Params, name: string): string {
  if (typeof (params as { get?: unknown }).get === "function") return ((params as { get(name: string): string | null }).get(name) ?? "").trim();
  const raw = (params as Record<string, string | string[] | undefined>)[name];
  return (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
}

/**
 * The view from the address. Unknown values fall back to the default rather than erroring: this is a
 * screen, and a stale bookmark should still open it. `?overdue=1` and `?mismatched=1` (the API's spelling)
 * are read as their lens too, and `?status=overdue` alone stays a status filter.
 */
export function parseInvoiceView(params: Params): InvoiceView {
  const lensRaw = read(params, "lens").toLowerCase();
  let lens: InvoiceLens = LENS_ALIASES[lensRaw] ?? "all";
  if (!lensRaw && /^(1|true|yes)$/i.test(read(params, "overdue"))) lens = "overdue";
  if (!lensRaw && /^(1|true|yes)$/i.test(read(params, "mismatched"))) lens = "mismatched";
  const status = read(params, "status");
  const issued = read(params, "issued");
  const age = read(params, "age").replace(/\s/g, "");
  return {
    lens,
    q: read(params, "q"),
    tenant: read(params, "tenant") || read(params, "customer"),
    status: (INVOICE_STATUSES as readonly string[]).includes(status) ? (status as InvoiceStatus) : "all",
    issued: (ISSUED_WINDOWS as readonly string[]).includes(issued) ? (issued as IssuedWindow) : "any",
    age: (OVERDUE_AGES as readonly string[]).includes(age) ? (age as OverdueAge) : age === "60" ? "60+" : "any",
  };
}

/** The view as URL parameters: defaults are dropped (null), so the address stays short. */
export function invoiceViewParams(view: InvoiceView): Record<string, string | null> {
  return {
    lens: view.lens === "all" ? null : view.lens,
    q: view.q || null,
    tenant: view.tenant || null,
    status: view.status === "all" ? null : view.status,
    issued: view.issued === "any" ? null : view.issued,
    age: view.age === "any" ? null : view.age,
  };
}

const DAY = 86_400_000;

/** Whole days past due at `now`, for an invoice still owed; null when it is paid, void or not yet due. */
export function daysOverdue(invoice: Pick<ListInvoice, "due_at" | "status">, now: number): number | null {
  if (!invoice.due_at || invoice.status === "paid" || invoice.status === "void" || invoice.status === "draft") return null;
  const days = Math.floor((now - Date.parse(invoice.due_at)) / DAY);
  return days > 0 ? days : null;
}

/** An overdue invoice's age bucket: 0–30, 31–60, 60+ days past due. */
export function overdueAge(invoice: Pick<ListInvoice, "due_at" | "status">, now: number): OverdueAge | null {
  if (invoice.status !== "overdue") return null;
  const days = daysOverdue(invoice, now) ?? 0;
  return days <= 30 ? "0-30" : days <= 60 ? "31-60" : "60+";
}

export function overdueAgeCounts(rows: ListInvoice[], now: number): Record<OverdueAge, number> {
  const counts: Record<OverdueAge, number> = { "0-30": 0, "31-60": 0, "60+": 0 };
  for (const row of rows) {
    const age = overdueAge(row, now);
    if (age) counts[age]++;
  }
  return counts;
}

/** The [from, to) window an Issued choice covers, in UTC. */
export function issuedRange(window: IssuedWindow, now: number): { from: number; to: number } {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (window) {
    case "this-month": return { from: Date.UTC(y, m, 1), to: Date.UTC(y, m + 1, 1) };
    case "last-month": return { from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) };
    case "90d": return { from: now - 90 * DAY, to: now + DAY };
    case "this-year": return { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) };
  }
}

/** When an invoice was issued; a draft that never was falls back to when it was made. */
export const issuedOn = (invoice: Pick<ListInvoice, "issued_at" | "created_at">) => invoice.issued_at ?? invoice.created_at;

/** Every filter but the lens, so the lens chips can count what each would show. */
export function matchesFilters(invoice: ListInvoice, view: InvoiceView, now: number): boolean {
  if (view.tenant && invoice.tenant_id !== view.tenant) return false;
  if (view.status !== "all" && invoice.status !== view.status) return false;
  if (view.issued !== "any") {
    const { from, to } = issuedRange(view.issued, now);
    const at = Date.parse(issuedOn(invoice));
    if (!(at >= from && at < to)) return false;
  }
  const needle = view.q.toLowerCase();
  if (needle && !invoice.number.toLowerCase().includes(needle) && !invoice.tenant_name.toLowerCase().includes(needle)) return false;
  return true;
}

export function matchesLens(invoice: ListInvoice, lens: InvoiceLens, age: InvoiceView["age"], now: number): boolean {
  if (lens === "mismatched") return invoice.reconciliation === "mismatched";
  if (lens === "overdue") return invoice.status === "overdue" && (age === "any" || overdueAge(invoice, now) === age);
  return true;
}

export function filterInvoices(rows: ListInvoice[], view: InvoiceView, now: number): ListInvoice[] {
  return rows.filter((row) => matchesFilters(row, view, now) && matchesLens(row, view.lens, view.age, now));
}

export function hasAnyFilter(view: InvoiceView): boolean {
  return Boolean(view.q || view.tenant || view.status !== "all" || view.issued !== "any" || view.age !== "any" || view.lens !== "all");
}

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** A CSV of the given invoices, one row each, in the order given. */
export function invoicesCsv(rows: ListInvoice[], now: number): string {
  const head = ["Invoice", "Customer", "Issued", "Due", "Total", "Provider charged", "Status", "Days overdue", "Matches provider", "Paid"];
  const body = rows.map((row) => [
    row.number,
    row.tenant_name,
    day(row.issued_at),
    day(row.due_at),
    dollars(row.total_cents),
    dollars(row.provider_total_cents),
    INVOICE_STATUS_LABELS[row.status] ?? row.status,
    daysOverdue(row, now) ?? "",
    row.reconciliation === "mismatched" ? "No" : row.reconciliation === "matched" ? "Yes" : "",
    day(row.paid_at),
  ]);
  return [head, ...body].map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
