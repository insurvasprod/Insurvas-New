/**
 * LA-4.5 (Notion sprint) · the shared status vocabulary and the unknown-status gate.
 *
 * Nine values (Module 4 doc §5), each with a different meaning for money. The carrier's own word is
 * always kept beside ours. Matching is exact — no trimming, no case folding, nothing fuzzy — and a
 * word nobody has mapped never maps silently: its rows are held back, not guessed at.
 *
 * Pure; relative imports only.
 */

export const STATUS_VOCABULARY = ["submitted", "declined", "withdrawn", "approved_unpaid", "not_taken", "active", "at_risk", "lapsed", "paid_up"] as const;
export type NormalizedStatus = (typeof STATUS_VOCABULARY)[number];

export const STATUS_LABELS: Record<NormalizedStatus, { label: string; meaning: string }> = {
  submitted: { label: "Submitted", meaning: "Sent to the carrier, not decided. Nothing yet." },
  declined: { label: "Declined", meaning: "The carrier said no. The case may go to another carrier." },
  withdrawn: { label: "Withdrawn", meaning: "Pulled or never completed. Nothing." },
  approved_unpaid: { label: "Approved, unpaid", meaning: "Approved; the first premium has not been paid. On first-draft carriers, no commission yet." },
  not_taken: { label: "Not taken", meaning: "Approved, but the client never paid. Any advance will be charged back." },
  active: { label: "Active", meaning: "In force, premiums being paid. Earning." },
  at_risk: { label: "At risk", meaning: "In force but behind on payment. The advance is at risk; the save window is counting down." },
  lapsed: { label: "Lapsed", meaning: "Cancelled for non-payment. A chargeback is coming or has happened." },
  paid_up: { label: "Paid up", meaning: "Fully paid; no more premiums. No more earnings, no more risk." },
};

export function isNormalizedStatus(value: unknown): value is NormalizedStatus {
  return typeof value === "string" && (STATUS_VOCABULARY as readonly string[]).includes(value);
}

/** The approved mappings for one carrier and file type: the carrier's word, exactly, to ours. */
export type StatusMap = ReadonlyMap<string, NormalizedStatus>;

export type GatedRow<T> = T & { values: Record<string, string | number | null> & { status_normalized: NormalizedStatus } };

export type GateResult<T> = {
  /** Rows whose word is mapped: they carry both carrier_status_raw and status_normalized. */
  passed: Array<GatedRow<T>>;
  /** Each unmapped word, verbatim, and how many rows wait on it. */
  held: Array<{ raw: string; rows: number }>;
  heldRows: number;
};

/**
 * The gate. A row passes only if its carrier_status_raw is, character for character, a word with an
 * approved mapping. A row with no status at all is held under "" — it has nothing to map.
 */
export function gateStatuses<T extends { values: Record<string, string | number | null> }>(rows: T[], map: StatusMap): GateResult<T> {
  const passed: Array<GatedRow<T>> = [];
  const held = new Map<string, number>();
  for (const row of rows) {
    const raw = row.values.carrier_status_raw;
    const word = typeof raw === "string" ? raw : "";
    const normalized = word ? map.get(word) : undefined;
    if (normalized) passed.push({ ...row, values: { ...row.values, status_normalized: normalized } } as GatedRow<T>);
    else held.set(word, (held.get(word) ?? 0) + 1);
  }
  const heldList = [...held.entries()].filter(([raw]) => raw !== "").map(([raw, count]) => ({ raw, rows: count })).sort((a, b) => b.rows - a.rows);
  return { passed, held: heldList, heldRows: [...held.values()].reduce((sum, count) => sum + count, 0) };
}

/** Whole days from one ISO date to another (UTC calendar days; negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((value) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))));
  return Math.round((b - a) / 86_400_000);
}

/**
 * The second way to at_risk (LA-4.7 derives it): an active policy whose paid-to date is further
 * behind than the carrier's grace. It yields the SAME value as a carrier word mapped to at_risk —
 * downstream nothing can tell which path produced it. With no grace configured (LA-4.17: null means
 * null), nothing is derived.
 */
export function effectiveStatus(input: { normalized: NormalizedStatus; paidToDate: string | null; today: string; graceDays: number | null }): NormalizedStatus {
  if (input.normalized !== "active" || input.paidToDate === null || input.graceDays === null) return input.normalized;
  return Math.max(0, daysBetween(input.paidToDate, input.today)) > input.graceDays ? "at_risk" : "active";
}

/** A carrier word as people need to see it: in quotes, with spaces shown, so "ACTIVE " is not "ACTIVE". */
export function shownWord(raw: string): string {
  return `“${raw.replace(/ /g, "·")}”`;
}
