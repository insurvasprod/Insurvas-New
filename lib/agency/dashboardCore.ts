/**
 * The agency dashboard as the page consumes it — plain types and values, never server code.
 *
 * `dashboardStore.ts` is `server-only` and returns the full `AgencyDashboard`, every producer row
 * carrying a whole `ProducerScore`. The page reads a narrower set of that, and those fields lived
 * as a private copy inside the component, which meant the sample data behind `/design/agency` had
 * nothing to be typed against. They live here so the component, the fixtures and (from Task 4) the
 * arithmetic all name the same shape.
 *
 * The store's richer type is assignable to this one, so nothing about the API changes.
 */

export type AgencyProducerRow = {
  producerUserId: string;
  /** The producer record's id (`/app/producers/<id>`); absent in older samples, null without a record. */
  producerId?: string | null;
  name: string;
  submitted: number;
  issued: number;
  /**
   * A count ("6/9") until there are enough policies for a percentage, then "67%". The honesty
   * rule the page already keeps: a rate off four policies is not a rate.
   */
  placement: string;
  m4: { text: string; building: boolean };
  /** 13-month persistency, the figure carriers actually contract on. Same count-first rule as m4. */
  m13: { text: string; building: boolean };
  advanceAtRiskCents: number;
  /** Advance already clawed back this period — the other half of "at risk". */
  chargebackCents: number;
  /** What the agency spent acquiring this producer's leads. Half of "am I making money". */
  leadSpendCents: number;
  /** Null until the payable ledger is live; the page shows a dash, never a zero. */
  balanceCents: number | null;
};

export type AgencyHealthAlert = {
  producerUserId: string;
  name: string;
  item: string;
  detail: string;
  expiresOn: string;
  daysLeft: number;
};

export type AgencyDashboardView = {
  period: { from: string; to: string };
  seats: { used: number; max: number | null };
  producers: AgencyProducerRow[];
  /** Null when the ledger is not live. Never substituted with 0. */
  payableOutCents: number | null;
  negativeCount: number | null;
  overrideCents: number | null;
  alerts: AgencyHealthAlert[];
  ledgerReady: boolean;
};

/* ── The arithmetic behind the cards and the charts ──────────────────────────────────────────── */

/**
 * Period-over-period change, as a percentage, or null when there is nothing honest to say.
 *
 * Every null here is a case where a number would look like a fact and not be one:
 *
 * - **No previous period read yet.** The comparison has not arrived; the card shows no pill.
 * - **Previous was zero.** Going from nothing to something is not "+100%" and not "+∞"; it is a
 *   start, and a percentage cannot describe it. The card says nothing rather than something silly.
 * - **The sign flipped.** An override of −$400 becoming +$900 is not "+325%". A percentage change
 *   across zero has no meaning, and printing one would misinform the person who most needs the
 *   truth.
 *
 * Both-zero is null too: no change, and no pill, rather than a confident "0%".
 */
export function periodChange(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  if (previous === 0) return null;
  if (current === 0 && previous === 0) return null;
  // A change that crosses zero cannot be expressed as a percentage of the old value.
  if ((current < 0) !== (previous < 0)) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export type StandingRow = { id: string; name: string; value: number; rank: number };

/**
 * The producers, ranked by one metric — the page's whole question in one list.
 *
 * Ties share a rank (two firsts, then a third), because telling two equal producers that one of
 * them is second is a lie the table would be making up. Order is stable: ties fall back to the
 * name, so the list does not shuffle between refreshes. A producer who wrote nothing still
 * appears, ranked last — they are on the agency's seat count and their absence would be the more
 * misleading view.
 */
export function standing(rows: readonly AgencyProducerRow[], metric: (row: AgencyProducerRow) => number): StandingRow[] {
  const sorted = [...rows]
    .map((row) => ({ id: row.producerUserId, name: row.name, value: metric(row) }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  let rank = 0;
  let previous: number | null = null;
  return sorted.map((row, index) => {
    if (previous === null || row.value !== previous) rank = index + 1;
    previous = row.value;
    return { ...row, rank };
  });
}

/**
 * Where the period's carrier money went: what the agency kept, what the producers are owed, and
 * what was spent acquiring the business. Three parts of one pound, for a `ShareBar`.
 *
 * Returns null when there is nothing to divide — a share bar of zeros is a grey rectangle that
 * says "no data" in the least honest way available.
 */
export type MoneySplit = { label: string; value: number }[];

export function moneySplit(input: { overrideCents: number | null; payableOutCents: number | null; leadSpendCents: number }): MoneySplit | null {
  const parts: MoneySplit = [];
  // A figure that was not read is left out of the bar, never drawn as zero. "Owed $0.00" while
  // the payable ledger is still coming up would tell an owner they owe their producers nothing,
  // which is the one thing on this page they must not be told wrongly.
  if (input.overrideCents !== null) parts.push({ label: "Override", value: Math.max(0, input.overrideCents) });
  if (input.payableOutCents !== null) parts.push({ label: "Owed", value: Math.max(0, input.payableOutCents) });
  parts.push({ label: "Acquisition", value: Math.max(0, input.leadSpendCents) });
  return parts.reduce((sum, part) => sum + part.value, 0) === 0 ? null : parts;
}
