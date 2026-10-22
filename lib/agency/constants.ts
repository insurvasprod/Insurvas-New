/**
 * AG-0.1 / AG-0.6 (Notion sprint, Agency Module 0) · the agency's vocabulary, with no database and no
 * `server-only`, so client components can import it.
 *
 * An agency is one tenant with many producers inside it. A producer is a tenant_user with a role; his
 * `producer` row carries the things only an agency needs (status, can_submit, hire and offboard dates).
 */

export const PLAN_AUDIENCES = ["individual", "agency"] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];

/** plan_type → audience. `management` (the IMO product) and anything unknown answer null: absent, not guessed. */
export function audienceForPlanType(planType: string | null | undefined): PlanAudience | null {
  if (planType === "individual") return "individual";
  if (planType === "agency_no_teams" || planType === "agency_with_teams") return "agency";
  return null;
}

export const PRODUCER_STATUSES = ["invited", "onboarding", "active", "suspended", "offboarded"] as const;
export type ProducerStatus = (typeof PRODUCER_STATUSES)[number];

export const PRODUCER_STATUS_LABELS: Record<ProducerStatus, string> = {
  invited: "Invited",
  onboarding: "Onboarding",
  active: "Active",
  suspended: "Suspended",
  offboarded: "Offboarded",
};

/**
 * AG-0.6 / module doc §6: a seat is held by every person working in the agency — producers AND the people who are
 * not producers (assistants, bookkeepers, setters, retention, the owner). Exactly the rule tenant_seats_used applies:
 * the member has accepted, the account is active or suspended, and he either has no producer row or a working one
 * (an offboarded producer keeps his seat only until the period ends). Invited members hold none.
 */
export function holdsAgencySeat(member: { accepted: boolean; accountStatus: "active" | "suspended" | "invited" | "deactivated" | string; producerStatus: ProducerStatus | null; seatReleasedOn?: string | null; today?: string }): boolean {
  if (!member.accepted || (member.accountStatus !== "active" && member.accountStatus !== "suspended")) return false;
  if (member.producerStatus === null) return true;
  if (member.producerStatus === "onboarding" || member.producerStatus === "active" || member.producerStatus === "suspended") return true;
  return member.producerStatus === "offboarded" && Boolean(member.seatReleasedOn) && (member.seatReleasedOn as string) >= (member.today ?? new Date().toISOString().slice(0, 10));
}

/**
 * AG-0.6 / AG-0.12: the flat agency-wide price bands. The $799 + $79/seat plan is dead.
 * Cents, never dollars-as-floats. `max` null = no ceiling.
 */
export const SEAT_BANDS = [
  { band: "to_50", label: "1–50 seats", max: 50, priceCents: 99_900 },
  { band: "to_150", label: "51–150 seats", max: 150, priceCents: 249_900 },
  { band: "over_150", label: "151+ seats", max: null, priceCents: 499_900 },
] as const;
export type SeatBand = (typeof SEAT_BANDS)[number]["band"];

export function seatBand(band: SeatBand) {
  return SEAT_BANDS.find((b) => b.band === band) ?? SEAT_BANDS[0];
}

/** The smallest band that holds `seats`, or null when none does (never happens: the top band is open). */
export function bandFor(seats: number) {
  return SEAT_BANDS.find((b) => b.max === null || seats <= b.max) ?? null;
}

/** "$2,499" from cents, by integer arithmetic (no float). */
export function dollars(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  const text = Math.abs(whole).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "−" : ""}$${text}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * AG-0.6 · the one seat check's answer when it says no: the band it needs and what that costs, so the owner
 * can upgrade in one click instead of being told "seat limit reached".
 */
export function bandBlock(used: number, max: number) {
  const current = bandFor(max) ?? SEAT_BANDS[0];
  const needed = bandFor(used + 1) ?? SEAT_BANDS[SEAT_BANDS.length - 1];
  return {
    error: `All ${max} seats in your ${current.label} band are in use. The ${needed.label} band is ${dollars(needed.priceCents)} a month.`,
    code: "band_full" as const,
    usage: used,
    limit: max,
    currentBand: current.band,
    neededBand: needed.band,
    neededLabel: needed.label,
    neededPriceCents: needed.priceCents,
    upgrade: true,
  };
}

/**
 * "90", "85.5", "120.25" → 9000, 8550, 12025 basis points, by string handling (no float ever exists).
 * Null for anything that is not a percentage with at most two decimals.
 */
export function percentToBps(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** "1200", "1,200.50", "$74" → cents, by string handling (no float). Null for anything else. */
export function dollarsToCents(text: string): number | null {
  const m = /^\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** 9000 → "90%", 8550 → "85.5%", by string handling. Null shows as an em dash. */
export function bpsToPercent(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "—";
  const negative = bps < 0;
  const digits = String(Math.abs(bps)).padStart(3, "0");
  const whole = digits.slice(0, -2);
  const rest = digits.slice(-2).replace(/0+$/, "");
  return `${negative ? "−" : ""}${whole}${rest ? `.${rest}` : ""}%`;
}

/** AG-0.6 · an agency invite is valid for 7 days, single use, resendable. */
export const AGENCY_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
