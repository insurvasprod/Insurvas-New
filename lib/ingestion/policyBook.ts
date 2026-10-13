/**
 * LA-4.11 (Notion sprint) · the policy list and detail page, as plain functions: the filters (and
 * their query string, which is what a saved filter stores), the sort, the totals that follow the
 * filter, the CSV export of exactly what is on screen, and the merged timeline.
 *
 * No I/O here; policyBookStore.ts reads, this decides. Safe for the browser.
 */

import { STATUS_LABELS, type NormalizedStatus } from "./statuses.ts";

export type RiskBand = "none" | "watch" | "at_risk" | "critical";

export const RISK_LABELS: Record<RiskBand, string> = { none: "Low", watch: "Watch", at_risk: "At risk", critical: "Critical" };
const RISK_ORDER: Record<RiskBand, number> = { none: 0, watch: 1, at_risk: 2, critical: 3 };

/** Statuses with a save window: the only ones a risk band means anything for. */
export const inForce = (status: string | null) => status === "active" || status === "at_risk" || status === "approved_unpaid";

export const statusLabel = (status: string | null) => (status && status in STATUS_LABELS ? STATUS_LABELS[status as NormalizedStatus].label : "Unknown");

/** A sale recorded as issued whose carrier file hasn't listed the policy yet (Module 4 · Door 1). */
export const AWAITING_FILE = "Issued, waiting for the carrier's file";

/** The status words a row shows: the carrier's status, or the recorded sale's own. */
export const rowStatusLabel = (row: Pick<BookRow, "status" | "source">) => (row.source === "issued" ? AWAITING_FILE : statusLabel(row.status));

/**
 * One row of the list: policy_current plus the names it points at, or (`source: "hand"`) a policy
 * the agency entered or imported by hand (tenant_policies), which opens its own page at `href`, or
 * (`source: "issued"`) a sale recorded as issued that no carrier file has listed yet (Module 4,
 * Door 1: "an application in LA-3 reaches issued" and the policy is in the book) — it leaves the
 * list by itself once the carrier's own row arrives for the same carrier and number.
 */
export type BookRow = {
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  contactId: string | null;
  provisional: boolean;
  product: string | null;
  premiumCents: number | null;
  premiumMode: string | null;
  annualCents: number | null;
  faceCents: number | null;
  status: string | null;
  statusRaw: string | null;
  daysPastDue: number | null;
  daysLeft: number | null;
  riskBand: RiskBand;
  issueDate: string | null;
  agentUserId: string | null;
  agentName: string | null;
  agency: string | null;
  leadSource: string | null;
  source?: "hand" | "issued";
  href?: string;
};

export type BookFilters = {
  q: string;
  carrier: string;
  product: string;
  status: string;
  risk: string;
  agent: string;
  agency: string;
  lead: string;
  issuedFrom: string;
  issuedTo: string;
  /** "carrier" (from the carriers' files), "hand" (entered or imported by hand), "issued" (a recorded sale awaiting its file), or all. */
  source: string;
};

export const SORT_KEYS = ["client", "carrier", "product", "policy", "premium", "face", "status", "dpd", "risk", "issued", "agent"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = { key: SortKey; dir: "asc" | "desc" };

export const EMPTY_FILTERS: BookFilters = { q: "", carrier: "", product: "", status: "", risk: "", agent: "", agency: "", lead: "", issuedFrom: "", issuedTo: "", source: "" };
export const DEFAULT_SORT: Sort = { key: "risk", dir: "desc" };

const FILTER_PARAMS: Record<keyof BookFilters, string> = { q: "q", carrier: "carrier", product: "product", status: "status", risk: "risk", agent: "agent", agency: "agency", lead: "lead", issuedFrom: "from", issuedTo: "to", source: "source" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The list's state from a query string; anything unknown or malformed is dropped, never trusted. */
export function readQuery(query: string | URLSearchParams): { filters: BookFilters; sort: Sort } {
  const params = typeof query === "string" ? new URLSearchParams(query.replace(/^\?/, "")) : query;
  const filters = { ...EMPTY_FILTERS };
  for (const key of Object.keys(FILTER_PARAMS) as Array<keyof BookFilters>) {
    const value = (params.get(FILTER_PARAMS[key]) ?? "").slice(0, 200);
    filters[key] = (key === "issuedFrom" || key === "issuedTo") && value && !DAY.test(value) ? "" : value;
  }
  const key = params.get("sort");
  const sort: Sort = key && (SORT_KEYS as readonly string[]).includes(key) ? { key: key as SortKey, dir: params.get("dir") === "asc" ? "asc" : "desc" } : DEFAULT_SORT;
  return { filters, sort };
}

/** The query string for a state: only what differs from the default, in a fixed order (so a saved filter compares equal). */
export function writeQuery(filters: BookFilters, sort: Sort): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(FILTER_PARAMS) as Array<keyof BookFilters>) if (filters[key].trim()) params.set(FILTER_PARAMS[key], filters[key].trim());
  if (sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir) { params.set("sort", sort.key); params.set("dir", sort.dir); }
  return params.toString();
}

export const activeFilterCount = (filters: BookFilters) => (Object.keys(filters) as Array<keyof BookFilters>).filter((key) => key !== "q" && filters[key].trim()).length;

/** "None" in a filter means the value is missing, so a gap can be found as easily as a value. */
export const NONE = "__none__";
const matches = (want: string, have: string | null) => !want || (want === NONE ? !have : have === want);

export function filterRows(rows: BookRow[], filters: BookFilters): BookRow[] {
  const needle = filters.q.trim().toLowerCase();
  return rows.filter((row) =>
    (!filters.source || (filters.source === "carrier" ? !row.source : row.source === filters.source)) &&
    (!needle || `${row.policyNumber} ${row.clientName ?? ""} ${row.carrierName} ${row.agentName ?? ""}`.toLowerCase().includes(needle)) &&
    matches(filters.carrier, row.carrierId) &&
    matches(filters.product, row.product) &&
    matches(filters.status, row.status) &&
    matches(filters.risk, row.riskBand) && (filters.risk !== "none" || inForce(row.status)) &&
    matches(filters.agent, row.agentUserId) &&
    matches(filters.agency, row.agency) &&
    matches(filters.lead, row.leadSource) &&
    (!filters.issuedFrom || (row.issueDate !== null && row.issueDate >= filters.issuedFrom)) &&
    (!filters.issuedTo || (row.issueDate !== null && row.issueDate <= filters.issuedTo)),
  );
}

const SORT_VALUE: Record<SortKey, (row: BookRow) => string | number | null> = {
  client: (row) => row.clientName?.toLowerCase() ?? null,
  carrier: (row) => row.carrierName.toLowerCase(),
  product: (row) => row.product?.toLowerCase() ?? null,
  policy: (row) => row.policyNumber,
  premium: (row) => row.annualCents,
  face: (row) => row.faceCents,
  status: (row) => (row.status ? statusLabel(row.status) : null),
  dpd: (row) => row.daysPastDue,
  risk: (row) => RISK_ORDER[row.riskBand],
  issued: (row) => row.issueDate,
  agent: (row) => row.agentName?.toLowerCase() ?? null,
};

/** Sorted on one column; a missing value always sorts last, either way; ties fall back to carrier then policy number. */
export function sortRows(rows: BookRow[], sort: Sort): BookRow[] {
  const value = SORT_VALUE[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => {
      if (a.value === null && b.value !== null) return 1;
      if (b.value === null && a.value !== null) return -1;
      if (a.value !== null && b.value !== null && a.value !== b.value) return (a.value < b.value ? -1 : 1) * sign;
      if (sort.key === "risk" && a.row.daysLeft !== b.row.daysLeft) {
        // Same band: the one closest to closing first.
        if (a.row.daysLeft === null) return 1;
        if (b.row.daysLeft === null) return -1;
        return a.row.daysLeft - b.row.daysLeft;
      }
      return a.row.carrierName.localeCompare(b.row.carrierName) || a.row.policyNumber.localeCompare(b.row.policyNumber) || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** The header figures, for exactly the filtered set. Premium is annualised; a policy without one adds nothing and is counted. */
export function totals(rows: BookRow[]) {
  let annualCents = 0;
  let withoutPremium = 0;
  let atRisk = 0;
  for (const row of rows) {
    if (row.annualCents === null) withoutPremium++;
    else annualCents += row.annualCents;
    if (row.riskBand === "at_risk" || row.riskBand === "critical") atRisk++;
  }
  return { count: rows.length, annualCents, monthlyCents: Math.round(annualCents / 12), withoutPremium, atRisk };
}

export const CSV_HEADER = ["Client", "Carrier", "Product", "Policy number", "Premium", "Premium mode", "Annual premium", "Face amount", "Status", "Carrier status", "Days past due", "Risk", "Issue date", "Agent", "Lead source", "Source"];

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

/** One CSV line per row, in the order given (the on-screen order). */
export function csvRows(rows: BookRow[]): Array<Array<string | number | null>> {
  return rows.map((row) => [
    row.clientName, row.carrierName, row.product, row.policyNumber, dollars(row.premiumCents), row.premiumMode, dollars(row.annualCents), dollars(row.faceCents),
    rowStatusLabel(row), row.statusRaw, row.daysPastDue, inForce(row.status) && !row.source ? RISK_LABELS[row.riskBand] : "", row.issueDate, row.agentName, row.leadSource, row.source === "hand" ? "Entered by hand" : row.source === "issued" ? "Recorded sale" : "Carrier file",
  ]);
}

/**
 * A CSV document. A text cell starting with = + - @ (or a tab/CR) is prefixed with ' so a
 * spreadsheet shows it rather than running it; carrier files are outside input. Numbers pass as is.
 */
export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const cell = (value: string | number | null) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return String(value);
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

// ─── the detail page's timeline ────────────────────────────────────────────────────────────────

/** `source`: the carrier file line the item was read from (LA-4.20), shown as a link under it. */
export type TimelineItem = { date: string; kind: "sale" | "carrier" | "change" | "money"; label: string; detail?: string | null; source?: { href: string; text: string } | null; order: number };

const FIELD_WORDS: Record<string, string> = {
  status_normalized: "Status",
  carrier_status_raw: "Carrier's status",
  paid_to_date: "Paid-to date",
  premium_cents: "Premium",
  premium_mode: "Premium mode",
  payment_method: "Payment method",
  face_amount_cents: "Face amount",
  product_code: "Product",
  product_tier: "Product tier",
  termination_date: "Termination date",
  agent_identifier: "Writing agent",
};

export const fieldWord = (field: string) => FIELD_WORDS[field] ?? field;

/** A changed value as a person reads it: statuses by name, cents as dollars, dates as given. */
export function changeValue(field: string, value: string | null): string {
  if (value === null || value === "") return "none";
  if (field === "status_normalized") return statusLabel(value);
  if (field === "premium_cents" || field === "face_amount_cents") return Number.isFinite(Number(value)) ? `$${(Number(value) / 100).toFixed(2)}` : value;
  if ((field === "paid_to_date" || field === "termination_date") && DAY.test(value)) return readableDay(value);
  return value;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sep 1, 2026", built by hand: Intl prints "Sept" on the server's ICU and the page would differ from the browser. */
export const readableDay = (value: string) => `${MONTHS[Number(value.slice(5, 7)) - 1]} ${Number(value.slice(8, 10))}, ${value.slice(0, 4)}`;

/** What a change means, in a phrase: a paid-to date moving forward is a payment credited. */
export function changeLabel(change: { field: string; oldValue: string | null; newValue: string | null }): string {
  if (change.field === "paid_to_date" && change.oldValue && change.newValue && change.newValue > change.oldValue) return "Payment credited: paid-to date moved forward";
  if (change.field === "paid_to_date" && change.oldValue && change.newValue && change.newValue < change.oldValue) return "Paid-to date moved back";
  if (change.field === "status_normalized") return `Status changed to ${statusLabel(change.newValue)}`;
  return `${fieldWord(change.field)} changed`;
}

/** Every source in one list, oldest first; on the same day, the sale comes before the carrier, the carrier before changes. */
export function mergeTimeline(items: Array<Omit<TimelineItem, "order"> & { order?: number }>): TimelineItem[] {
  const KIND_ORDER = { sale: 0, carrier: 1, change: 2, money: 3 } as const;
  return items
    .filter((item) => DAY.test(item.date.slice(0, 10)))
    .map((item, index) => ({ ...item, date: item.date.slice(0, 10), order: item.order ?? index }))
    .sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.order - b.order);
}
