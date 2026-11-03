/**
 * LA-5.7 (Notion sprint) · win-back, as plain rules: the words for each reason and band, which
 * candidates are due for release, and the note the agent reads on the lead — what the client had, what
 * they paid, for how long, and why it ended. That context is the whole advantage over a cold call.
 *
 * Classification itself is sync_winback_candidates' (the database); a `never` candidate is refused
 * there on any release path, and filtered here as well.
 *
 * Pure; relative imports only.
 */

export const CATEGORIES = ["mechanical", "administrative", "unknown", "carrier_declined", "affordability", "no_longer_wanted", "do_not_contact", "deceased"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  mechanical: "A payment failed; they never said no",
  administrative: "Card expired, bank closed or moved",
  unknown: "Just stopped, no reason given",
  carrier_declined: "The carrier declined reinstatement",
  affordability: "Said they could not afford it",
  no_longer_wanted: "Said they no longer wanted it",
  do_not_contact: "Asked not to be contacted",
  deceased: "Deceased",
};

export const BANDS = ["strong", "fair", "poor", "never"] as const;
export type WinbackBand = (typeof BANDS)[number];
export const BAND_LABELS: Record<WinbackBand, string> = { strong: "Strong", fair: "Fair", poor: "Poor", never: "Never call" };

export const SOURCES = ["client_said", "save_call", "carrier_status", "reinstatement_decline", "do_not_call_list", "payment_history", "none"] as const;
export type ReasonSource = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<ReasonSource, string> = {
  client_said: "the client told us",
  save_call: "from a save call",
  carrier_status: "from the carrier's file",
  reinstatement_decline: "the client told us (reinstatement call)",
  do_not_call_list: "your do-not-call list",
  payment_history: "inferred from payments",
  none: "nothing on record",
};

export type DueCandidate = { band: WinbackBand; eligibleFrom: string | null; releasedAt: string | null; blockedReason: string | null };

/** Due for the Win-back list: its cooling-off is over, it is not `never`, and it has not gone already. */
export const isDue = (c: DueCandidate, today: string) =>
  c.band !== "never" && c.releasedAt === null && c.eligibleFrom !== null && c.eligibleFrom <= today;

const money = (cents: number | null) => (cents === null ? null : `$${(cents / 100).toFixed(2)}`);
const wholeDollars = (cents: number | null) => (cents === null ? null : `$${Math.round(cents / 100).toLocaleString("en-US")}`);

/** The note on the released lead: the card's context, in plain words. */
export function leadNote(c: {
  carrierName: string; policyNumber: string; premiumCents: number | null; faceCents: number | null; monthsPaid: number | null;
  lapsedOn: string; category: Category; detail: string | null; inferred: boolean; band: WinbackBand;
}): string {
  const had = [c.faceCents !== null ? `${wholeDollars(c.faceCents)} of cover` : null, `with ${c.carrierName}`, `(policy ${c.policyNumber})`].filter(Boolean).join(" ");
  const paid = c.premiumCents !== null ? `paid ${money(c.premiumCents)} a month` : "paid";
  const months = c.monthsPaid !== null ? ` for ${c.monthsPaid} ${c.monthsPaid === 1 ? "month" : "months"}` : "";
  const why = `${CATEGORY_LABELS[c.category]}${c.inferred ? " (inferred, not said)" : ""}${c.detail ? `: ${c.detail}` : "."}`;
  return [
    `Win-back · a former client (${BAND_LABELS[c.band].toLowerCase()} chance).`,
    `They had ${had}, ${paid}${months}, and it lapsed on ${c.lapsedOn}.`,
    `Why it ended: ${why}`,
  ].join("\n");
}
