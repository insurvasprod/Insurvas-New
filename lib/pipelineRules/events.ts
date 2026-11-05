/**
 * Setup › Pipeline rules · the events, computed. No AI: each event is a fact read from what is already
 * stored (docs/la4/SIMPLIFY-PROPOSAL.md §4):
 *
 *   issued                   policy_current.issued_on, inside the look-back
 *   waiting_first_payment    policy_current: approved, first premium not drawn (approved_unpaid)
 *   first_payment_missed     the daily date check: the first premium late by more than the carrier's
 *                            first-payment grace (carrier rules, resolved for the agency — never a default)
 *   later_payment_missed     the daily date check: the paid-to date behind by more than the carrier's
 *                            grace after a missed payment
 *   paid_again               policy_change: paid-to moved forward after it had been behind past the grace
 *   submitted, in_force,     policy_change: the status word changed to that status — or the policy was first
 *   at_risk, paid_up,        seen at it inside the look-back (a new policy's first file shows its status with
 *   lapsed, not_taken,       no change row behind it; owner 2026-11-04: every status moves the card)
 *   declined, withdrawn
 *   cancelled                policy_change: an end date appeared, or a status word saying cancelled
 *   advance_received,        commission_entry: a new advance / earned / chargeback line that has not been
 *   commission_credited,     reversed
 *   chargeback_received
 *
 * The date checks are states: they hold while the policy stays behind, so the same key comes back each
 * morning and is recorded once. Changes and statement lines count inside EVENT_LOOKBACK_DAYS, so a policy
 * linked to its lead later still gets its recent events once (the late link). A file dated after today (a
 * carrier's post-dated run, a test) is not held back for its day to come: its events count now.
 *
 * Pure; relative imports only.
 */
import { resolveRule, daysUntilCarrierCloses, type RuleRow } from "../ingestion/carrierRules.ts";
import { daysLate, monthsPaid, ruleTypeFor } from "../ingestion/policyCurrent.ts";
import { EVENT_LOOKBACK_DAYS, noteDay, noteMoney, type FillValues, type RuleEvent } from "./rules.ts";

export type PolicyFacts = {
  carrierId: string;
  policyNumber: string;
  status: string | null;
  carrierStatusRaw?: string | null;
  paidToDate: string | null;
  effectiveDate: string | null;
  issuedOn: string | null;
  /** The carrier's own issue date from the file (policy_current.issue_date). */
  issueDate?: string | null;
  firstSeenDate: string | null;
  /** The day its current link to a lead was made (policy_match), when that link came after the policy was read. */
  linkedOn?: string | null;
  premiumCents: number | null;
  caseId: string | null;
  applicationId: string | null;
};

export type ChangeFact = { carrierId: string; policyNumber: string; field: string; oldValue: string | null; newValue: string | null; fromDate: string; toDate: string };
export type LedgerFact = { id: string; carrierId: string; policyNumber: string; entryType: string; amountCents: number; date: string; reversesEntryId: string | null };

export type RuleEventFact = {
  event: RuleEvent;
  carrierId: string;
  policyNumber: string;
  /** The day it happened (for a state, the day it began). */
  date: string;
  /** Stable across runs: the same change gives the same key, so a rule acts on it once. */
  changeKey: string;
  fills: FillValues;
  /** What the policy page and the forecast line say about why. */
  because: string;
};

/** Statuses a policy is still open in: another one of these on the same lead keeps the card where it is. */
export const OPEN_STATUSES = ["submitted", "approved_unpaid", "active", "at_risk"] as const;

const DAY = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY);
export const addDays = (iso: string, days: number) => new Date((dayNumber(iso) + days) * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const policyKey = (carrierId: string, policyNumber: string) => `${carrierId}|${policyNumber}`;

/** Every normalized status (LA-4.5) as the event it raises when a policy reaches it. */
const STATUS_EVENTS: Partial<Record<string, RuleEvent>> = {
  // Approved, first premium not drawn: the carrier has issued it. Its own event key, so it counts even when the
  // file leaves the issue date empty (Aetna, Aflac and AHL do on many rows; real files 2026-10-01).
  submitted: "submitted", approved_unpaid: "issued", active: "in_force", at_risk: "at_risk", paid_up: "paid_up",
  lapsed: "lapsed", not_taken: "not_taken", declined: "declined", withdrawn: "withdrawn",
};
/** The status events, for the store to know which reads they need. */
export const STATUS_EVENT_NAMES: readonly RuleEvent[] = [...new Set(Object.values(STATUS_EVENTS) as RuleEvent[])];

/**
 * A policy that ends before its first premium was ever paid was never taken, whatever word the carrier used
 * (owner's SOP "Unified Pipeline SOP": a cancellation inside the first draft's grace is a cancellation, after it a
 * failed payment). Americo writes "Cancelled" for both; AMAM "Terminated" with no paid-to date is the same case.
 * Paid at least once (paid-to past the effective date) → lapsed as the carrier said.
 * A carrier with no paid-to date (Americo's file has none) is read from the status it left: submitted or
 * approved-unpaid → never taken; in force → a lapse. Neither known → the carrier's own word stands.
 */
const NOT_YET_IN_FORCE = new Set(["submitted", "approved_unpaid"]);
export function statusEvent(status: string | null | undefined, p: Pick<PolicyFacts, "paidToDate" | "effectiveDate"> | undefined, previous?: string | null): RuleEvent | undefined {
  const event = STATUS_EVENTS[status ?? ""];
  if (event !== "lapsed" || !p) return event;
  if (p.paidToDate) return p.effectiveDate !== null && p.paidToDate <= p.effectiveDate ? "not_taken" : "lapsed";
  if (previous) return NOT_YET_IN_FORCE.has(previous) ? "not_taken" : "lapsed";
  return "lapsed";
}
const LEDGER_EVENTS: Partial<Record<string, RuleEvent>> = { advance: "advance_received", earned: "commission_credited", chargeback: "chargeback_received" };
const CLOSED_BY_STATUS = new Set(["lapsed", "not_taken", "declined", "withdrawn"]);
/** Statuses that say the carrier issued the policy. */
const ISSUED_STATUSES = new Set(["approved_unpaid", "active", "at_risk", "paid_up"]);

/**
 * The day a policy was issued, for the Issued event: issued_on when a file showed the policy change to issued.
 * A policy whose first file already shows it issued (most new business) has no such change, so issued_on stays
 * empty; then the carrier's own issue date counts, when its status says issued. A whole book imported at once
 * carries old issue dates, which fall outside the look-back, so it does not read as issued today.
 */
export function issuedDay(p: PolicyFacts): string | null {
  if (p.issuedOn) return p.issuedOn;
  return p.issueDate && ISSUED_STATUSES.has(p.status ?? "") ? p.issueDate : null;
}

export type ComputeInput = {
  tenantId: string;
  /** Today in the agency's calendar (ISO day). */
  asOf: string;
  policies: PolicyFacts[];
  changes: ChangeFact[];
  ledger: LedgerFact[];
  carrierRules: RuleRow[];
  carrierNames: Map<string, string>;
  lookbackDays?: number;
};

export type ComputeResult = {
  events: RuleEventFact[];
  /** Carriers whose policies are behind but which have no grace set: no missed-payment event for them (null means null). */
  carriersWithoutGrace: string[];
};

function baseFills(p: PolicyFacts | undefined, carrierName: string, policyNumber: string): FillValues {
  return {
    carrier: carrierName,
    policy_number: policyNumber,
    premium: noteMoney(p?.premiumCents ?? null),
    paid_to_date: noteDay(p?.paidToDate ?? null),
    months_paid: p ? monthsPaid(p.effectiveDate, p.paidToDate) : null,
  };
}

/** Every event the rules can act on today, for one agency. */
export function computeEvents(input: ComputeInput): ComputeResult {
  const since = addDays(input.asOf, -(input.lookbackDays ?? EVENT_LOOKBACK_DAYS));
  const byKey = new Map(input.policies.map((p) => [policyKey(p.carrierId, p.policyNumber), p]));
  const name = (carrierId: string) => input.carrierNames.get(carrierId) ?? "the carrier";
  const events = new Map<string, RuleEventFact>();
  const noGrace = new Set<string>();
  const add = (fact: RuleEventFact) => { if (!events.has(fact.changeKey)) events.set(fact.changeKey, fact); };
  const key = (p: { carrierId: string; policyNumber: string }, rest: string) => `${p.carrierId}:${p.policyNumber}:${rest}`;
  const grace = (carrierId: string, type: "first_payment" | "ongoing_payment") => resolveRule(input.carrierRules, { tenantId: input.tenantId, carrierId, ruleType: type, asOf: input.asOf });

  const statusChanged = new Set(input.changes.filter((c) => c.field === "status_normalized").map((c) => policyKey(c.carrierId, c.policyNumber)));
  for (const p of input.policies) {
    const fills = baseFills(p, name(p.carrierId), p.policyNumber);
    const issued = issuedDay(p);
    if (issued && issued >= since) {
      add({ event: "issued", carrierId: p.carrierId, policyNumber: p.policyNumber, date: issued, changeKey: key(p, `issued:${issued}`), fills, because: `issued ${noteDay(issued)}` });
    }
    const status = p.status ?? "";
    // First seen at a status inside the look-back: the file that brought the policy is the change. A later file
    // that changes the status adds its own change row, so the two events keep their own days.
    // Only while the policy still has the status it was first seen with: once a later file changed it, the status
    // today is not what that first file said (E2E 2026-11-05: Americo "Issued, not paid", later "Cancelled", was
    // replayed as a first-seen lapse and outranked its own Not taken), and the change rows carry the news.
    const seenAs = statusEvent(status, p);
    if (seenAs && p.firstSeenDate && p.firstSeenDate >= since && !statusChanged.has(policyKey(p.carrierId, p.policyNumber))) {
      add({ event: seenAs, carrierId: p.carrierId, policyNumber: p.policyNumber, date: p.firstSeenDate, changeKey: key(p, `status:${status}:${p.firstSeenDate}`), fills, because: `first seen ${status.replace("_", " ")} · file ${noteDay(p.firstSeenDate)}` });
    }
    // Linked to its lead after the file that brought it (a person in the review queue, or a policy number added to
    // the submission later): the link is the news, at the status the policy has now (E2E 2026-11-05: Loretta
    // Sutherland, linked by hand six weeks after her policy was read, was never moved).
    if (seenAs && p.linkedOn && p.linkedOn >= since && (!p.firstSeenDate || p.linkedOn > p.firstSeenDate)) {
      add({ event: seenAs, carrierId: p.carrierId, policyNumber: p.policyNumber, date: p.linkedOn, changeKey: key(p, `status:${status}:linked:${p.linkedOn}`), fills, because: `linked ${noteDay(p.linkedOn)} · ${status.replace("_", " ")}` });
    }
    if (!["approved_unpaid", "active", "at_risk"].includes(status)) continue;

    const type = ruleTypeFor(p.effectiveDate, p.paidToDate);
    const firstUnpaid = status === "approved_unpaid" && Boolean(p.effectiveDate) && (!p.paidToDate || (p.effectiveDate !== null && p.paidToDate <= p.effectiveDate));
    if (status === "approved_unpaid" && (!p.paidToDate || !p.effectiveDate || p.paidToDate <= p.effectiveDate)) {
      const began = p.issuedOn ?? p.firstSeenDate ?? p.effectiveDate ?? input.asOf;
      const dpd = daysLate(input.asOf, p.status, p.effectiveDate, p.paidToDate);
      const rule = grace(p.carrierId, "first_payment");
      add({ event: "waiting_first_payment", carrierId: p.carrierId, policyNumber: p.policyNumber, date: began, changeKey: key(p, `waiting:${p.effectiveDate ?? began}`), fills: { ...fills, days_past_due: dpd, days_left: dpd === null ? null : daysUntilCarrierCloses(rule, dpd) }, because: "first premium not drawn yet" });
    }

    // The date check. The day the premium was due: the effective date while nothing is paid, else paid-to.
    const due = firstUnpaid ? p.effectiveDate : p.paidToDate;
    if (!due) continue;
    const dpd = daysLate(input.asOf, p.status, p.effectiveDate, p.paidToDate) ?? 0;
    const event: RuleEvent = type === "first_payment" ? "first_payment_missed" : "later_payment_missed";
    const rule = grace(p.carrierId, type);
    if (dpd <= 0) continue;
    if (!rule || rule.graceDays === null) {
      noGrace.add(p.carrierId);
      continue;
    }
    if (dpd <= rule.graceDays) continue;
    const missedOn = addDays(due, rule.graceDays + 1);
    add({
      event, carrierId: p.carrierId, policyNumber: p.policyNumber, date: missedOn,
      changeKey: key(p, `${event === "first_payment_missed" ? "first_missed" : "later_missed"}:${due}`),
      fills: { ...fills, days_past_due: dpd, days_left: daysUntilCarrierCloses(rule, dpd) },
      because: `${plural(dpd, "day")} past due, grace ${plural(rule.graceDays, "day")}`,
    });
  }

  for (const c of input.changes) {
    if (c.toDate < since) continue;
    const p = byKey.get(policyKey(c.carrierId, c.policyNumber));
    const fills = baseFills(p, name(c.carrierId), c.policyNumber);
    // A status the policy has since left is history, not news: an older Active change must not move a card after a
    // later file said Terminated (E2E 2026-11-05: Tess went Lapsed → In force on a Terminated file, from the earlier
    // Active change a new rule version had not acted on yet).
    if (c.field === "status_normalized" && c.newValue && STATUS_EVENTS[c.newValue] && (!p || p.status === c.newValue)) {
      const event = (statusEvent(c.newValue, p, c.oldValue) ?? STATUS_EVENTS[c.newValue]) as RuleEvent;
      add({ event, carrierId: c.carrierId, policyNumber: c.policyNumber, date: c.toDate, changeKey: key(c, `status:${c.newValue}:${c.toDate}`), fills, because: `status ${c.newValue.replace("_", " ")} · file ${noteDay(c.toDate)}` });
    }
    const cancelledWord = c.field === "carrier_status_raw" && c.newValue !== null && /cancel/i.test(c.newValue);
    const endDate = c.field === "termination_date" && !c.oldValue && Boolean(c.newValue);
    if ((cancelledWord || endDate) && !CLOSED_BY_STATUS.has(p?.status ?? "")) {
      add({ event: "cancelled", carrierId: c.carrierId, policyNumber: c.policyNumber, date: c.toDate, changeKey: key(c, `cancelled:${c.toDate}`), fills, because: endDate ? `end date ${noteDay(c.newValue)} · file ${noteDay(c.toDate)}` : `status word “${c.newValue}” · file ${noteDay(c.toDate)}` });
    }
    if (c.field === "paid_to_date" && c.oldValue && c.newValue && c.newValue > c.oldValue) {
      // Was it behind past the grace before this file? Against the rule for the kind of payment it was.
      const type = p ? ruleTypeFor(p.effectiveDate, c.oldValue) : "ongoing_payment";
      const rule = grace(c.carrierId, type);
      const behind = daysBetween(c.oldValue, c.toDate);
      if (rule && rule.graceDays !== null && behind > rule.graceDays) {
        add({ event: "paid_again", carrierId: c.carrierId, policyNumber: c.policyNumber, date: c.toDate, changeKey: key(c, `paid_again:${c.newValue}`), fills: { ...fills, paid_to_date: noteDay(c.newValue) }, because: `paid to ${noteDay(c.oldValue)} → ${noteDay(c.newValue)}` });
      }
    }
  }

  const reversed = new Set(input.ledger.map((line) => line.reversesEntryId).filter((id): id is string => Boolean(id)));
  // A statement line older than the policy's latest status change is history too: the later file is newer news
  // (E2E 2026-11-05: a new Chargeback rule version moved Tess, reinstated since, back to Charged back).
  const lastStatusChange = new Map<string, string>();
  for (const c of input.changes) {
    if (c.field !== "status_normalized") continue;
    const k = policyKey(c.carrierId, c.policyNumber);
    if (!lastStatusChange.has(k) || c.toDate > lastStatusChange.get(k)!) lastStatusChange.set(k, c.toDate);
  }
  for (const line of input.ledger) {
    const event = LEDGER_EVENTS[line.entryType];
    if (!event || reversed.has(line.id) || line.date < since) continue;
    const changedOn = lastStatusChange.get(policyKey(line.carrierId, line.policyNumber));
    if (changedOn && line.date < changedOn) continue;
    const p = byKey.get(policyKey(line.carrierId, line.policyNumber));
    add({ event, carrierId: line.carrierId, policyNumber: line.policyNumber, date: line.date, changeKey: key(line, `ledger:${line.id}`), fills: { ...baseFills(p, name(line.carrierId), line.policyNumber), amount: noteMoney(Math.abs(line.amountCents)) }, because: `${line.entryType} ${noteMoney(Math.abs(line.amountCents))} · ${noteDay(line.date)}` });
  }

  return { events: [...events.values()].sort((a, b) => a.date.localeCompare(b.date) || a.changeKey.localeCompare(b.changeKey)), carriersWithoutGrace: [...noGrace] };
}
