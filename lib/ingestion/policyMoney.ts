/**
 * Book of business › Policies, redesign round 5 (docs/la4/mockups-r5/book-commissions-r5.html, boards 6 and 7):
 * where a policy's money stands, as plain functions. The list's Health chip, its Commission bar and sentence and
 * its one Next date, and the policy page's Money tab (the first-year bar, the 12-month strip, What's next).
 *
 * No I/O; policyMoneyStore.ts reads, this decides. Safe for the browser. Every figure comes from the ledger
 * (commission_entry), the rate card (expected_commission), policy_current and Carrier rules; a figure that
 * can't be worked out is null and the screen shows "—", never a guess.
 */

/** The facts one policy's money is worked out from. Cents throughout. */
export type MoneyFacts = {
  status: string | null;
  /** "hand": entered by hand (its money lives on its own page); "issued": a recorded sale awaiting its file. */
  source?: "hand" | "issued";
  paidTo: string | null;
  daysPastDue: number | null;
  daysLeft: number | null;
  asOf: string | null;
  effectiveDate: string | null;
  premiumMode: string | null;
  monthsPaid: number | null;
  /** First-year commission from the rate card; null when there is no expected row or it has no rate. */
  expectedCents: number | null;
  /** The expected row exists and says the rate card can't price it (LA-4.13). */
  noRate: boolean;
  /** Advance paid, net of advance reversals. */
  advancedCents: number;
  /** As-earned commission lines (not the advance). */
  earnedLineCents: number;
  /** Chargebacks, as the ledger holds them (zero or negative). */
  chargedBackCents: number;
  /** The advance not yet earned by months paid; null when the months advanced or paid aren't known. */
  unearnedCents: number | null;
  /** Unearned, less what the carrier already took back (lib/ingestion/commissionLedger.ts unearnedAdvance). */
  atRiskCents: number | null;
  /** Open "Paid short" and "Commission missing" findings, as a positive amount. */
  shortCents: number;
  /** Any ledger line at all for this policy. */
  hasLines: boolean;
  /** The carrier's grace after a missed draft (carrier_retention_rule.grace_days of the rule in force); null = not set. */
  graceDays: number | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = /^\d{4}-\d{2}-\d{2}/;

/** "Dec 2": the short day the list and the Money tab write. Built by hand so the server and the browser agree. */
export const shortDay = (value: string | null | undefined) => (value && DAY.test(value) ? `${MONTHS[Number(value.slice(5, 7)) - 1]} ${Number(value.slice(8, 10))}` : "—");
export const monthName = (value: string) => MONTHS[Number(value.slice(5, 7)) - 1];

/** $1,284.00, with a minus sign for money going out. */
export const cents = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value < 0 ? "−" : ""}$${(Math.abs(value) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export const addDays = (day: string, days: number) => new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A day `months` later, kept on the same day of the month (clamped to the month's last day). */
export function addMonths(day: string, months: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + months;
  const d = Number(day.slice(8, 10));
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Months between two drafts for a premium mode; null for a mode with no fixed step. */
export const MODE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/**
 * How many drafts have come due since the paid-to date and not been paid: every draft day from the paid-to
 * date on, a mode's step apart, that is before the as-of day. Null when the mode or the dates aren't known.
 */
export function paymentsBehind(paidTo: string | null, asOf: string | null, mode: string | null): number | null {
  const step = mode ? MODE_MONTHS[mode] : undefined;
  if (!paidTo || !asOf || !step || !DAY.test(paidTo) || !DAY.test(asOf)) return null;
  let count = 0;
  while (count < 120 && addMonths(paidTo, count * step) < asOf) count++;
  return count;
}

const IN_FORCE = new Set(["active", "at_risk"]);
export const isInForce = (status: string | null) => IN_FORCE.has(status ?? "");
export const isBehind = (facts: Pick<MoneyFacts, "status" | "daysPastDue" | "source">) => !facts.source && (facts.status === "active" || facts.status === "at_risk" || facts.status === "approved_unpaid") && (facts.daysPastDue ?? 0) > 0;

export type Tone = "good" | "info" | "warning" | "danger" | "neutral";

const STATUS_WORDS: Record<string, { label: string; tone: Tone }> = {
  lapsed: { label: "Lapsed", tone: "danger" },
  not_taken: { label: "Not taken", tone: "danger" },
  declined: { label: "Declined", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  approved_unpaid: { label: "Approved", tone: "info" },
  paid_up: { label: "Paid up", tone: "good" },
  active: { label: "Active", tone: "good" },
  at_risk: { label: "At risk", tone: "warning" },
};

/** The Health chip: "Paid to Dec 2", "1 payment behind", "Lapsed", "Approved". */
export function policyHealth(facts: Pick<MoneyFacts, "status" | "source" | "paidTo" | "daysPastDue" | "asOf" | "premiumMode">): { label: string; tone: Tone } {
  if (facts.source === "issued") return { label: "Awaiting the file", tone: "info" };
  if (facts.source === "hand") return { ...(STATUS_WORDS[facts.status ?? ""] ?? { label: "Entered by hand", tone: "neutral" as const }) };
  if (isBehind(facts)) {
    const behind = paymentsBehind(facts.paidTo, facts.asOf, facts.premiumMode);
    return { label: behind ? `${behind} payment${behind === 1 ? "" : "s"} behind` : `${facts.daysPastDue} days behind`, tone: facts.status === "at_risk" || (behind ?? 0) > 1 ? "danger" : "warning" };
  }
  if (isInForce(facts.status) && facts.paidTo) return { label: `Paid to ${shortDay(facts.paidTo)}`, tone: "good" };
  return STATUS_WORDS[facts.status ?? ""] ?? { label: "Unknown", tone: "neutral" };
}

export type MoneyFigures = {
  /** Kept for good: the advance the months paid have earned, plus as-earned lines. Null = can't be worked out. */
  earnedCents: number | null;
  /** The unearned advance the carrier could still take back. */
  atRiskCents: number | null;
  shortCents: number;
  /** The rest of the first year still to come; null without a rate card figure. */
  restCents: number | null;
  expectedCents: number | null;
  advancedCents: number;
  chargedBackCents: number;
};

/** The first-year figures: earned · at risk · short · still to come. */
export function moneyFigures(facts: MoneyFacts): MoneyFigures {
  const kept = facts.advancedCents + Math.min(0, facts.chargedBackCents);
  let earned: number | null;
  let atRisk: number | null;
  if (facts.advancedCents > 0) {
    earned = facts.unearnedCents === null ? null : Math.max(0, Math.min(kept, facts.advancedCents - facts.unearnedCents)) + facts.earnedLineCents;
    atRisk = facts.atRiskCents;
  } else {
    earned = facts.earnedLineCents;
    atRisk = 0;
  }
  const rest = facts.expectedCents !== null && earned !== null && atRisk !== null ? Math.max(0, facts.expectedCents - earned - atRisk - facts.shortCents) : null;
  return { earnedCents: earned, atRiskCents: atRisk, shortCents: facts.shortCents, restCents: rest, expectedCents: facts.expectedCents, advancedCents: facts.advancedCents, chargedBackCents: facts.chargedBackCents };
}

/** The bar's four parts as shares of the whole (earned green, at risk amber, short red, still to come the track). */
export function barParts(figures: MoneyFigures): { earned: number; atRisk: number; short: number; rest: number } | null {
  const earned = Math.max(0, figures.earnedCents ?? 0);
  const atRisk = Math.max(0, figures.atRiskCents ?? 0);
  const short = Math.max(0, figures.shortCents);
  const whole = Math.max(figures.expectedCents ?? 0, earned + atRisk + short);
  if (whole <= 0) return null;
  const share = (part: number) => Math.round((part / whole) * 1000) / 10;
  return { earned: share(earned), atRisk: share(atRisk), short: share(short), rest: share(Math.max(0, whole - earned - atRisk - short)) };
}

/** The Commission column's one sentence, e.g. "$22.60 earned · $180.80 at risk · of $271.20". */
export function moneySentence(facts: MoneyFacts, figures: MoneyFigures = moneyFigures(facts)): { text: string; addRate: boolean } {
  if (facts.source === "hand") return { text: "Entered by hand · its money is on its page", addRate: false };
  if (facts.source === "issued") return { text: "Waiting for the carrier's file", addRate: false };
  if (!facts.hasLines) {
    if (facts.noRate) return { text: "Waiting for the first payment", addRate: true };
    return { text: facts.expectedCents !== null ? `Waiting for the first payment · ${cents(facts.expectedCents)} expected` : "Waiting for the first payment", addRate: false };
  }
  const parts: string[] = [];
  if (figures.earnedCents === null) parts.push(`${cents(facts.advancedCents)} advanced · months advanced not known`);
  else parts.push(`${cents(figures.earnedCents)} earned`);
  if ((figures.atRiskCents ?? 0) > 0) parts.push(`${cents(figures.atRiskCents)} at risk`);
  if (figures.shortCents > 0) parts.push(`${cents(figures.shortCents)} short`);
  if (facts.chargedBackCents < 0) parts.push(`${cents(-facts.chargedBackCents)} charged back`);
  if (facts.expectedCents !== null) {
    const full = figures.earnedCents !== null && figures.earnedCents >= facts.expectedCents && !(figures.atRiskCents ?? 0) && !figures.shortCents;
    parts.push(full ? "all of it · paid in full" : `of ${cents(facts.expectedCents)}`);
  }
  return { text: parts.join(" · "), addRate: facts.noRate };
}

/** The advance is fully earned: there was one, and none of it can still be taken back. */
const fullyEarned = (facts: MoneyFacts) => facts.advancedCents > 0 && facts.unearnedCents === 0;

/** The next anniversary of the effective date, on or after `today`. */
export function nextAnniversary(effectiveDate: string | null, today: string): string | null {
  if (!effectiveDate || !DAY.test(effectiveDate)) return null;
  let years = Math.max(1, Number(today.slice(0, 4)) - Number(effectiveDate.slice(0, 4)));
  let day = addMonths(effectiveDate, years * 12);
  if (day < today) { years += 1; day = addMonths(effectiveDate, years * 12); }
  return day;
}

/**
 * The one date that matters now: the grace end (or the day the carrier closes it) while a draft is behind,
 * the reinstatement deadline while lapsed, the first draft while approved, the anniversary once the advance is
 * earned or the policy is paid up, else the next draft (the paid-to date).
 */
export function nextDate(facts: MoneyFacts, today: string): { label: string; date: string } | null {
  if (facts.source) return null;
  if (facts.status === "lapsed") return facts.daysLeft !== null && facts.daysLeft > 0 && facts.asOf ? { label: "Reinstate by", date: addDays(facts.asOf, facts.daysLeft) } : null;
  if (isBehind(facts)) {
    if (facts.paidTo && facts.graceDays !== null) {
      const graceEnd = addDays(facts.paidTo, facts.graceDays);
      if (graceEnd >= today) return { label: "Grace ends", date: graceEnd };
    }
    return facts.daysLeft !== null && facts.daysLeft > 0 && facts.asOf ? { label: "Carrier closes it", date: addDays(facts.asOf, facts.daysLeft) } : null;
  }
  if (facts.status === "approved_unpaid") {
    const first = facts.paidTo ?? facts.effectiveDate;
    return first ? { label: "First draft", date: first } : null;
  }
  if (facts.status === "paid_up" || (isInForce(facts.status) && fullyEarned(facts))) {
    const anniversary = nextAnniversary(facts.effectiveDate, today);
    return anniversary ? { label: "Anniversary", date: anniversary } : null;
  }
  if (isInForce(facts.status) && facts.paidTo) return { label: "Draft", date: facts.paidTo };
  return null;
}

// ─── the Money tab ─────────────────────────────────────────────────────────────────────────────

export type MonthBox = { day: string; label: string; state: "paid" | "due" | "missed" | "future"; earnedHere: boolean; note: string | null };

/**
 * The first year as twelve months from the effective date: which are paid (months paid), the one due or
 * missed now, and the month the advance is fully earned (its last advanced month). Null without an effective date.
 */
export function monthStrip(input: { effectiveDate: string | null; monthsPaid: number | null; advanceMonths: number | null; behind: boolean; paidTo: string | null }): MonthBox[] | null {
  if (!input.effectiveDate || !DAY.test(input.effectiveDate)) return null;
  const paid = Math.max(0, input.monthsPaid ?? 0);
  return Array.from({ length: 12 }, (_, index) => {
    const day = addMonths(input.effectiveDate as string, index);
    const state: MonthBox["state"] = index < paid ? "paid" : index === paid ? (input.behind ? "missed" : "due") : "future";
    const earnedHere = input.advanceMonths !== null && input.advanceMonths > 0 && index === input.advanceMonths - 1;
    const note = state === "due" ? `due ${Number((input.paidTo ?? day).slice(8, 10))}${ordinal(Number((input.paidTo ?? day).slice(8, 10)))}` : state === "missed" ? "missed" : earnedHere ? "earned" : null;
    return { day, label: monthName(day), state, earnedHere, note };
  });
}

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th");

/** The sentence under the strip: what each paid month earns, when nothing can be charged back, what's left. */
export function stripSentence(input: { advancedCents: number; months: number | null; clawbackType: "full" | "prorated" | null; effectiveDate: string | null; expectedCents: number | null; reason: string | null }): string {
  if (input.advancedCents <= 0) return input.expectedCents !== null ? `No advance on this policy: its ${cents(input.expectedCents)} first-year commission is paid as each month is paid.` : "No advance on this policy yet, and no rate card figure to say what the first year pays.";
  if (!input.months || !input.effectiveDate) return `The advance of ${cents(input.advancedCents)} can't be spread over its months: ${input.reason ?? "the months advanced aren't known"}.`;
  const lastDay = addMonths(input.effectiveDate, input.months - 1);
  const rest = input.expectedCents !== null ? input.expectedCents - input.advancedCents : null;
  const restText = rest !== null && rest > 0 ? `; the rest of the year (${cents(rest)}) is paid as it earns` : "";
  if (input.clawbackType === "full") return `The whole advance of ${cents(input.advancedCents)} can be charged back until ${monthName(lastDay)} ${lastDay.slice(0, 4)} is paid. After that it is fully earned${restText}.`;
  const perMonth = Math.round(input.advancedCents / input.months);
  return `Each paid month earns ${cents(perMonth)} of the advance. After ${monthName(lastDay)} ${lastDay.slice(0, 4)} the advance is fully earned and nothing can be charged back${restText}.`;
}

export type NextLine = { date: string; text: string; tone?: "warning" | "danger" };

/**
 * What's next: the next draft and what it earns, the one after it, and what happens if the next is missed,
 * by the carrier's grace in Carrier rules. No grace set: it says so, with no number standing in.
 */
export function whatsNext(facts: MoneyFacts & { carrierName: string; premiumCents: number | null; advanceMonths: number | null }, today: string): { lines: NextLine[]; graceMissing: boolean } {
  const lines: NextLine[] = [];
  const step = facts.premiumMode ? MODE_MONTHS[facts.premiumMode] ?? null : null;
  const draft = facts.premiumCents !== null ? cents(facts.premiumCents) : null;
  const perMonth = facts.advancedCents > 0 && facts.advanceMonths && facts.monthsPaid !== null && facts.monthsPaid < facts.advanceMonths ? Math.round(facts.advancedCents / facts.advanceMonths) : null;
  const atRisk = facts.atRiskCents;
  if (facts.status === "lapsed") {
    const until = facts.daysLeft !== null && facts.daysLeft > 0 && facts.asOf ? addDays(facts.asOf, facts.daysLeft) : null;
    lines.push({ date: until ?? "", text: until ? `Lapsed · can be reinstated until ${shortDay(until)}` : "Lapsed · no reinstatement window is set in Carrier rules", tone: "danger" });
    if (atRisk) lines.push({ date: "", text: `${cents(atRisk)} of the advance can be charged back`, tone: "danger" });
    return { lines, graceMissing: false };
  }
  if (!isInForce(facts.status) && facts.status !== "approved_unpaid") return { lines, graceMissing: false };
  const due = facts.paidTo ?? (facts.status === "approved_unpaid" ? facts.effectiveDate : null);
  if (!due) return { lines: [{ date: "", text: "No paid-to date in the carrier's file yet, so the next draft isn't known" }], graceMissing: false };
  const graceEnd = facts.graceDays !== null ? addDays(due, facts.graceDays) : null;
  if (isBehind(facts)) {
    lines.push({ date: due, text: `${shortDay(due)} · draft${draft ? ` ${draft}` : ""} not paid`, tone: "warning" });
    if (graceEnd) lines.push({ date: graceEnd, text: graceEnd >= today ? `Grace ends ${shortDay(graceEnd)}${atRisk ? `, then ${cents(atRisk)} can be charged back` : ""}` : `Grace ended ${shortDay(graceEnd)}${atRisk ? ` · ${cents(atRisk)} can be charged back` : ""}`, tone: "danger" });
    else lines.push({ date: "", text: `Grace not set for ${facts.carrierName}`, tone: "warning" });
    return { lines, graceMissing: graceEnd === null };
  }
  lines.push({ date: due, text: `${shortDay(due)} · ${facts.status === "approved_unpaid" ? "first draft" : "draft"}${draft ? ` ${draft}` : ""}${perMonth ? ` → earns ${cents(perMonth)}` : ""}` });
  if (step) {
    const after = addMonths(due, step);
    lines.push({ date: after, text: `${shortDay(after)} · draft${draft ? ` ${draft}` : ""}` });
  }
  if (graceEnd) lines.push({ date: graceEnd, text: `If ${shortDay(due)} is missed: grace ends ${shortDay(graceEnd)}${atRisk ? `, then ${cents(atRisk)} can be charged back` : ""}`, tone: "warning" });
  else lines.push({ date: "", text: `If ${shortDay(due)} is missed: grace not set for ${facts.carrierName}`, tone: "warning" });
  return { lines, graceMissing: graceEnd === null };
}

// ─── the list's chips ──────────────────────────────────────────────────────────────────────────

/** The questions an owner asks of the book (board 6), as `?show=`; the last three are reached from the strip. */
export const SHOWS = [
  { key: "", label: "All" },
  { key: "behind", label: "Behind on payment" },
  { key: "short", label: "Paid short" },
  { key: "risk", label: "Advance at risk" },
  { key: "lapsed", label: "Lapsed" },
  { key: "inforce", label: "In force", fromStrip: true },
  { key: "expected", label: "Commission this year", fromStrip: true },
  { key: "received", label: "Received this year", fromStrip: true },
] as const;
export type Show = (typeof SHOWS)[number]["key"];
export const showOf = (value: string | null | undefined): Show => (SHOWS.find((show) => show.key === value)?.key ?? "");

/** What a row is, for the chips: worked out once on the server. */
export type RowFlags = { behind: boolean; short: boolean; risk: boolean; lapsed: boolean; inforce: boolean; expected: boolean; received: boolean };

export const matchesShow = (flags: RowFlags | null, show: Show) => !show || Boolean(flags?.[show]);

/** One row's money, ready to draw. */
export type ListMoney = {
  health: { label: string; tone: Tone };
  bar: { earned: number; atRisk: number; short: number; rest: number } | null;
  sentence: string;
  /** No rate on the Rate card prices this policy: the row offers "Add the rate". */
  addRate: boolean;
  next: { label: string; date: string } | null;
  flags: RowFlags;
};

export type BookStrip = {
  inForce: { count: number; monthlyCents: number };
  /** Expected from the rate card for commission due this calendar year; null when expected commission can't be read. */
  expectedThisYear: { cents: number; unpriced: number } | null;
  /** Net received on ledger lines dated this year; null when the ledger can't be read. */
  receivedThisYear: number | null;
  /** The unearned advance still at risk; null when no advance is on file or none can be worked out. */
  atRisk: { cents: number | null; policies: number; unknown: number } | null;
  /** Open "Paid short" and "Commission missing" findings; null when findings can't be read. */
  short: { cents: number; policies: number } | null;
  year: string;
};
