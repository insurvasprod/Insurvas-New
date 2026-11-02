/**
 * Sample agencies for `/design/agency` (development only).
 *
 * The agency this app runs against has one seat, no producers, no ledger and no expiries — the
 * state in the owner's screenshot. Every number on it is a legitimate zero, which makes it the
 * worst possible thing to redesign against: four zeros and two empty boxes tell you nothing about
 * whether a change to the busy page is an improvement. These fixtures exist so each state can be
 * looked at on purpose.
 *
 * Plain module: no server imports, so the preview page and any test can both read it.
 */
import type { AgencyDashboardView, AgencyHealthAlert, AgencyProducerRow } from "./dashboardCore.ts";

export const SAMPLE_AGENCY_STATES = ["busy", "quiet", "empty", "error"] as const;
export type SampleAgencyState = (typeof SAMPLE_AGENCY_STATES)[number];
export const SAMPLE_AGENCY_ROLES = ["owner", "manager"] as const;
export type SampleAgencyRole = (typeof SAMPLE_AGENCY_ROLES)[number];

/** A month that has finished, so "last month" is a real comparison rather than a part-month. */
const PERIOD = { from: "2026-10-01", to: "2026-10-31" };

type Spec = {
  name: string;
  submitted: number;
  issued: number;
  /** [placed, eligible] — under the sample it prints as a count, over it as a percentage. */
  placement: [number, number];
  m4: [number, number];
  /** 13-month survival — always at or below m4, because a policy cannot un-lapse. */
  m13: [number, number];
  atRisk?: number;
  chargeback?: number;
  /** What the agency spent on this producer's leads. */
  spend?: number;
  balance?: number | null;
  /** A manager sees only their own reports; these are the two that report to them. */
  reports?: boolean;
};

/** The sample below which a rate is a count, matching the store's own rule. */
const MIN_SAMPLE = 10;

function rate([hit, of]: [number, number]): { text: string; building: boolean } {
  return of >= MIN_SAMPLE
    ? { text: `${Math.round((hit / of) * 100)}%`, building: false }
    : { text: `${hit}/${of}`, building: true };
}

function row(spec: Spec, index: number): AgencyProducerRow {
  return {
    producerUserId: `u-prod-${index}`,
    name: spec.name,
    submitted: spec.submitted,
    issued: spec.issued,
    placement: rate(spec.placement).text,
    m4: rate(spec.m4),
    m13: rate(spec.m13),
    advanceAtRiskCents: spec.atRisk ?? 0,
    chargebackCents: spec.chargeback ?? 0,
    leadSpendCents: spec.spend ?? 0,
    balanceCents: spec.balance === undefined ? 0 : spec.balance,
  };
}

/**
 * Nine producers: enough to page, and spread so every rule on the page has a case to draw —
 * a count and a percentage side by side, a negative balance, one clear worst advance risk, and
 * one producer who has submitted nothing at all.
 */
const BUSY: Spec[] = [
  { name: "Marisol Vega", submitted: 64, issued: 41, placement: [41, 64], m4: [33, 38], m13: [26, 33], atRisk: 182_400, chargeback: 48_000, spend: 612_000, balance: 1_284_00, reports: true },
  { name: "Dwayne Okafor", submitted: 52, issued: 35, placement: [35, 52], m4: [28, 31], m13: [21, 28], atRisk: 96_000, chargeback: 0, spend: 498_000, balance: 904_50, reports: true },
  { name: "Priya Raman", submitted: 47, issued: 26, placement: [26, 47], m4: [19, 24], m13: [11, 19], atRisk: 311_500, chargeback: 214_000, spend: 540_000, balance: -412_25 },
  { name: "Tomas Lindqvist", submitted: 38, issued: 22, placement: [22, 38], m4: [15, 18], m13: [12, 15], atRisk: 54_000, chargeback: 12_500, spend: 366_000, balance: 613_00 },
  { name: "Aisha Bello", submitted: 31, issued: 19, placement: [19, 31], m4: [12, 14], m13: [9, 12], atRisk: 0, chargeback: 0, spend: 288_000, balance: 488_75 },
  { name: "Grant Whitfield", submitted: 24, issued: 11, placement: [11, 24], m4: [6, 9], m13: [3, 6], atRisk: 128_900, chargeback: 61_000, spend: 294_000, balance: 201_00 },
  { name: "Lena Moreau", submitted: 17, issued: 9, placement: [9, 17], m4: [4, 7], m13: [2, 4], atRisk: 0, chargeback: 0, spend: 150_000, balance: 150_25 },
  { name: "Soren Haddad", submitted: 9, issued: 4, placement: [4, 9], m4: [2, 3], m13: [1, 2], atRisk: 41_000, chargeback: 9_000, spend: 96_000, balance: 0 },
  { name: "Caleb Nwosu", submitted: 0, issued: 0, placement: [0, 0], m4: [0, 0], m13: [0, 0], atRisk: 0, chargeback: 0, spend: 24_000, balance: 0 },
];

/** Two producers and a thin month: the shape most small agencies actually have. */
const QUIET: Spec[] = [
  { name: "Marisol Vega", submitted: 7, issued: 4, placement: [4, 7], m4: [2, 3], m13: [1, 2], atRisk: 0, chargeback: 0, spend: 72_000, balance: 318_00, reports: true },
  { name: "Dwayne Okafor", submitted: 3, issued: 1, placement: [1, 3], m4: [0, 1], m13: [0, 0], atRisk: 22_500, chargeback: 7_500, spend: 36_000, balance: 96_40, reports: true },
];

const ALERTS: Array<Omit<AgencyHealthAlert, "producerUserId"> & { producer: number }> = [
  { producer: 0, name: "Marisol Vega", item: "Resident licence", detail: "Texas · 1234567", expiresOn: "2026-11-09", daysLeft: 8 },
  { producer: 2, name: "Priya Raman", item: "Carrier appointment", detail: "Mutual of Omaha", expiresOn: "2026-11-13", daysLeft: 12 },
  { producer: 1, name: "Dwayne Okafor", item: "Non-resident licence", detail: "Oklahoma · 7781203", expiresOn: "2026-11-27", daysLeft: 26 },
  { producer: 3, name: "Tomas Lindqvist", item: "Carrier appointment", detail: "Aetna", expiresOn: "2026-12-10", daysLeft: 39 },
  { producer: 5, name: "Grant Whitfield", item: "Resident licence", detail: "Florida · 4410982", expiresOn: "2026-12-26", daysLeft: 55 },
];

/**
 * `previous: true` returns the month before — the same agency, a little quieter. It exists so the
 * change pills, which are the point of the period toggle, can be seen on the preview at all: the
 * real page fetches the previous period lazily, and a preview that fetches nothing would show the
 * strip permanently pill-less.
 */
export function sampleAgencyDashboard(options: { state?: SampleAgencyState; role?: SampleAgencyRole; previous?: boolean } = {}): AgencyDashboardView {
  const { state = "busy", role = "owner", previous = false } = options;
  if (state === "empty" || state === "error") {
    // The owner's screenshot, exactly: one seat and no ceiling, an empty ledger that is live and
    // honestly reports nothing owed, and nothing expiring.
    return {
      period: PERIOD,
      seats: { used: 1, max: null },
      producers: [],
      payableOutCents: 0,
      negativeCount: 0,
      overrideCents: 0,
      alerts: [],
      ledgerReady: true,
    };
  }

  // Last month: a shade quieter on production and a shade worse on risk, so the pills point in
  // both directions rather than all one way.
  const scale = (value: number, by: number) => Math.max(0, Math.round(value * by));
  const base = state === "quiet" ? QUIET : BUSY;
  const specs = previous
    ? base.map((spec) => ({ ...spec, submitted: scale(spec.submitted, 0.86), issued: scale(spec.issued, 0.82), atRisk: scale(spec.atRisk ?? 0, 1.18), chargeback: scale(spec.chargeback ?? 0, 1.4) }))
    : base;
  // A manager sees only their own reports — the same narrowing `scopeFor` applies on the server,
  // so the two roles can be compared side by side on the preview.
  const chosen = role === "manager" ? specs.filter((spec) => spec.reports) : specs;
  // Indexed against the full list, not the filtered one, so a manager's two producers keep the
  // same ids as the owner's view of them — and the alerts below still match.
  const producers = chosen.map((spec) => row(spec, specs.indexOf(spec)));
  const visible = new Set(producers.map((producer) => producer.producerUserId));
  const alerts: AgencyHealthAlert[] = (state === "quiet" ? ALERTS.slice(0, 2) : ALERTS)
    .map((alert) => ({ ...alert, producerUserId: `u-prod-${alert.producer}` }))
    .filter((alert) => visible.has(alert.producerUserId));

  const payableOutCents = producers.reduce((total, producer) => total + Math.max(0, producer.balanceCents ?? 0), 0);
  return {
    period: PERIOD,
    seats: { used: producers.length + 1, max: state === "quiet" ? null : 25 },
    producers,
    payableOutCents,
    negativeCount: producers.filter((producer) => (producer.balanceCents ?? 0) < 0).length,
    // A manager never sees the override; the component hides the tile, and the figure is not here.
    overrideCents: role === "manager" ? null : state === "quiet" ? (previous ? 38_900 : 41_200) : (previous ? 281_400 : 318_900),
    alerts,
    ledgerReady: true,
  };
}
