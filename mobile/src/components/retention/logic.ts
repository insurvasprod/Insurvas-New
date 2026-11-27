import { displayName } from "@/lib/format";
import type { Tone } from "@/theme/tokens";
import type { IconName } from "@/components/icon";

import type { CaseDetail, CaseItem, RequestType, Step, WaitingRequest, WinbackPerson } from "./types";

/**
 * The Retention screens' rules, pure, so they can be tested without a phone. Each one is the web's rule
 * (lib/retention/cases/listOrder.ts, components/app/retention/case-view.tsx, servicing-shared.ts and
 * winback-stages.tsx) written again for the phone, because the app cannot import the web's modules.
 */

// ─── dates, from the server's YYYY-MM-DD (read as UTC so no time zone moves a day) ─────────────
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const asDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "19 Nov". */
export const dayMonth = (iso: string) => { const d = asDate(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`; };
/** "Thu 26 Nov". */
export const weekdayDayMonth = (iso: string) => `${DAYS[asDate(iso).getUTCDay()]} ${dayMonth(iso)}`;
/** "Nov". */
export const monthShort = (iso: string) => MONTHS[asDate(iso).getUTCMonth()].slice(0, 3);
/** "November". */
export const monthLong = (iso: string) => MONTHS[asDate(iso).getUTCMonth()];
/** Whole days from one date to another. */
export const daysBetween = (from: string, to: string) => Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);
/** Today on this phone's calendar (toISOString would be tomorrow on a US evening). */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
export const firstWord = (name: string | null) => (name ? name.trim().split(/\s+/)[0] : null);
/** The client's name, else the policy number (a case can lack a linked client). */
export const caseName = (c: { clientName: string | null; policyNumber: string }) => displayName(c.clientName) ?? `Policy ${c.policyNumber}`;

// ─── the ladder ────────────────────────────────────────────────────────────────────────────────
export const LADDER: Step[] = ["payment_problem", "pending_lapse", "lapsed_reinstatable", "lost"];
export const STEP_LABEL: Record<Step, string> = {
  payment_problem: "Payment problem", pending_lapse: "Pending lapse", lapsed_reinstatable: "Reinstatable", lost: "Lost", paperwork: "Paperwork",
};
/** The steps a person works from the list; Lost is closed to win-back on the computer, Paperwork sits beside. */
const WORKED: Step[] = ["payment_problem", "pending_lapse", "lapsed_reinstatable"];

/** How soon a case is lost: past the carrier's date, this week, this month, later, or no window at all. */
export type Urgency = "over" | "week" | "month" | "later" | "none";
export const URGENCY_ORDER: Urgency[] = ["over", "week", "month", "later", "none"];
export function urgencyOf(c: { daysLeft: number | null }): Urgency {
  if (c.daysLeft === null) return "none";
  if (c.daysLeft < 0) return "over";
  if (c.daysLeft <= 7) return "week";
  return c.daysLeft <= 31 ? "month" : "later";
}
export const URGENCY_TITLE: Record<Urgency, string> = {
  over: "Past the carrier’s date", week: "Lost this week unless worked", month: "This month", later: "Later", none: "No carrier window",
};

/** Cases grouped by how soon they are lost, in the server's working order inside each group. */
export function groupCases(cases: CaseItem[]): { key: Urgency; cases: CaseItem[] }[] {
  return URGENCY_ORDER.map((key) => ({ key, cases: cases.filter((c) => urgencyOf(c) === key) })).filter((g) => g.cases.length > 0);
}

/**
 * Board F3's two groups, exactly as drawn: "Lost this week unless worked" (past the carrier's date too: those need the
 * call most) and "This month" — the rest of the open list, a case further out or with no carrier window after the
 * month's own (the board draws no third group). Inside a group the server's working order holds, except that a case
 * given a "Try again" day (F5) moves to that day: it waits behind the ones due now, soonest first.
 */
export type BoardGroup = "week" | "month";
export const BOARD_GROUP_TITLE: Record<BoardGroup, string> = { week: "Lost this week unless worked", month: "This month" };
const boardGroupOf = (c: CaseItem): BoardGroup => { const u = urgencyOf(c); return u === "over" || u === "week" ? "week" : "month"; };
const furtherOut = (c: CaseItem) => (urgencyOf(c) === "month" ? 0 : 1);
export function boardGroups(cases: CaseItem[], now = Date.now()): { key: BoardGroup; cases: CaseItem[] }[] {
  const waiting = (c: CaseItem) => (c.nextAttemptAt && Date.parse(c.nextAttemptAt) > now ? Date.parse(c.nextAttemptAt) : null);
  return (["week", "month"] as BoardGroup[]).map((key) => {
    // Within "This month", the month's own cases come before the ones further out (a stable sort keeps the server's order).
    const inGroup = cases.filter((c) => boardGroupOf(c) === key).sort((a, b) => furtherOut(a) - furtherOut(b));
    const dueNow = inGroup.filter((c) => waiting(c) === null);
    const later = inGroup.filter((c) => waiting(c) !== null).sort((a, b) => (waiting(a) ?? 0) - (waiting(b) ?? 0));
    return { key, cases: [...dueNow, ...later] };
  }).filter((g) => g.cases.length > 0);
}

/** The list a step shows: one step, or the three steps worked from the list when none is picked. */
export function casesOn(cases: CaseItem[], step: Step | null, needle = ""): CaseItem[] {
  const q = needle.trim().toLowerCase();
  return cases.filter((c) => (q
    ? [c.clientName, c.policyNumber, c.carrierName].some((v) => v?.toLowerCase().includes(q))
    : step ? c.step === step : WORKED.includes(c.step)));
}

/**
 * The cases to call, in order: past the carrier's date first, then the rest of this week. A case sent to the
 * carrier waits for a file, so it is not called again.
 */
export function callToday(cases: CaseItem[]): CaseItem[] {
  const due = cases.filter((c) => WORKED.includes(c.step) && c.status !== "waiting_on_carrier");
  return URGENCY_ORDER.flatMap((u) => due.filter((c) => urgencyOf(c) === u));
}

/** The one chip a case row carries: the countdown when it is close, else where the work stands. */
export function caseChip(c: CaseItem, now = Date.now()): { tone: Tone; text: string } {
  const u = urgencyOf(c);
  if (u === "over") return { tone: "bad", text: `${plural(-(c.daysLeft ?? 0), "day", "days")} over` };
  if (u === "week") return { tone: "warn", text: c.daysLeft === 0 ? "Due today" : `${plural(c.daysLeft ?? 0, "day", "days")} left` };
  if (c.status === "waiting_on_carrier") return { tone: "info", text: "Waiting on carrier" };
  // A "Try again" day set on the last attempt (F5): the case waits for it.
  if (c.nextAttemptAt && Date.parse(c.nextAttemptAt) > now) return { tone: "info", text: `Try ${weekdayDayMonth(localDay(new Date(c.nextAttemptAt)))}` };
  if (c.unreachable) return { tone: "warn", text: "Unreachable" };
  if (c.contactAttempts > 0) return { tone: "info", text: `Called ${c.contactAttempts}×` };
  if (c.lastCall || c.lastContactAt) return { tone: "info", text: "Called" };
  return { tone: "neutral", text: "Not started" };
}

/** What the file says, short: "reinstatable until 30 Dec", else the reason in words. */
export function caseWhy(c: CaseItem): string {
  if (c.step === "lapsed_reinstatable" && c.deadline) return `reinstatable until ${dayMonth(c.deadline)}`;
  return lowerFirst(c.reasonLabel);
}

/** The tiles over the list: a count a step, and on Pending lapse how many are lost this week. */
export function stepCounts(cases: CaseItem[]) {
  const on = (s: Step) => cases.filter((c) => c.step === s);
  return {
    payment_problem: on("payment_problem").length,
    pending_lapse: on("pending_lapse").length,
    pendingThisWeek: on("pending_lapse").filter((c) => urgencyOf(c) === "week").length,
    lapsed_reinstatable: on("lapsed_reinstatable").length,
    paperwork: on("paperwork").length,
  };
}

/** The save rate, the scorecard's way: saved ÷ (saved + lost), as a percentage only over 10 decided cases. */
export const MIN_DECIDED = 10;
export function saveRate(month: { saved: number; lost: number }): { decided: number; pct: number; label: string } {
  const decided = month.saved + month.lost;
  const pct = decided ? (month.saved / decided) * 100 : 0;
  return { decided, pct, label: decided === 0 ? "–" : decided >= MIN_DECIDED ? `${Math.round(pct)}%` : `${month.saved}/${decided}` };
}

// ─── one case (F4) ─────────────────────────────────────────────────────────────────────────────
export const isOpenCase = (c: { status: string }) => c.status === "open" || c.status === "working" || c.status === "waiting_on_carrier";

/** The deadline card: what happens on the date, the date as it is (never moved to today), and the countdown. */
export function deadlineCard(c: CaseDetail): { label: string; big: string; line: string; pct: number; ring: string } | null {
  if (!c.deadline || c.daysLeft === null) {
    if (c.step === "lost" || c.step === "paperwork") return null;
    return { label: "Carrier date", big: "No carrier window", line: "The carrier’s rules give no date", pct: 0, ring: "–" };
  }
  // Board F4: at Pending lapse the date is when the policy is lost ("Lost on Thu 26 Nov · grace ends at the carrier").
  const label = c.step === "payment_problem" ? "Pending lapse on" : c.step === "pending_lapse" || c.step === "lapsed_reinstatable" ? "Lost on" : "Carrier date";
  const after = c.step === "payment_problem" ? "then it’s a pending lapse" : c.step === "pending_lapse" ? "grace ends at the carrier" : c.step === "lapsed_reinstatable" ? "the reinstatement window closes" : "the carrier’s date";
  const line = c.daysLeft < 0
    ? `${plural(-c.daysLeft, "day", "days")} over · ask the carrier where it stands`
    : c.daysLeft === 0 ? `Due today · ${after}` : `${plural(c.daysLeft, "day", "days")} left · ${after}`;
  // How much of the time from opening to the date has gone: a real proportion, not a guess at the grace period.
  const total = daysBetween(c.openedAt.slice(0, 10), c.deadline);
  const gone = total > 0 ? Math.min(total, Math.max(0, total - c.daysLeft)) : total === 0 ? 1 : 0;
  const pct = c.daysLeft < 0 ? 100 : total > 0 ? (gone / total) * 100 : 100;
  return { label, big: weekdayDayMonth(c.deadline), line, pct, ring: c.daysLeft < 0 ? "Over" : `${c.daysLeft}d` };
}

export const OUTCOME_WORDS: Record<string, string> = {
  reached_agreed: "reached, agreed", reached_refused: "reached, said no", voicemail: "left voicemail",
  wrong_number: "wrong number", no_answer: "no answer", already_fixed: "already fixed",
};

const PAYMENT_FIXES = ["first_draft_failed", "later_draft_failed", "bounced_draft", "banking_problem", "pending_lapse", "lapse_notice"];

/**
 * "What to do" for this reason, the web case page's plan: each step done or not, from what the case shows
 * (a call logged, a change sent to the carrier). The last step is always the file's: nothing to press.
 */
export function caseSteps(c: CaseDetail): { key: string; title: string; done: boolean; sub?: string }[] {
  const who = firstWord(c.clientName) ?? "the client";
  const called = Boolean(c.lastContactAt || c.lastCall || c.contactAttempts > 0 || c.calls.length);
  const fixed = c.status === "waiting_on_carrier" || Boolean(c.servicingRequestId);
  const last = c.calls[0] ?? (c.lastCall ? { at: c.lastCall.at, outcome: c.lastCall.outcome } : null);
  const callSub = last ? `Called ${dayMonth(last.at)} · ${OUTCOME_WORDS[last.outcome] ?? last.outcome.replace(/_/g, " ")}` : undefined;
  const file = c.evidence.fileDate ? `Latest file ${dayMonth(c.evidence.fileDate)}` : undefined;
  if (c.step === "lost") {
    return [
      { key: "why", title: "Nothing left to save: the files show the policy gone", done: false },
      { key: "close", title: "Close it to win-back; the client is called again after the cooling-off", done: false },
    ];
  }
  if (c.step === "lapsed_reinstatable") {
    return [
      { key: "call", title: `Call ${who}: the carrier still takes it back`, done: called, sub: callSub },
      { key: "agree", title: `Agree it with ${who}, and what the carrier needs`, done: fixed },
      { key: "send", title: `Send it to ${c.carrierName}`, done: fixed },
      { key: "file", title: "The next file shows it back in force", done: false, sub: file },
    ];
  }
  if (c.reason === "pending_manual_action") {
    return [
      { key: "find", title: "Find out what the carrier needs", done: called, sub: callSub },
      { key: "get", title: `Get it from ${who}`, done: fixed },
      { key: "send", title: `Send it to ${c.carrierName}`, done: fixed },
    ];
  }
  if (c.reason === "payment_date_change") {
    return [
      { key: "confirm", title: `Confirm the new date with ${who}`, done: called, sub: callSub },
      { key: "fix", title: `Send the change to ${c.carrierName}`, done: fixed, sub: fixed ? undefined : "Their service line or the agent portal" },
      { key: "file", title: "The next file shows the new date", done: false, sub: file },
    ];
  }
  // Board F4: a payment that didn't clear, on Payment problem or Pending lapse — four steps, the last the file's.
  if (PAYMENT_FIXES.includes(c.reason) && (c.step === "payment_problem" || c.step === "pending_lapse")) {
    return [
      { key: "call", title: `Call ${who} and find a draft date that clears`, done: called, sub: callSub },
      { key: "fix", title: "Take a new bank or a new date", done: fixed },
      { key: "send", title: `Send the change to ${c.carrierName}`, done: fixed, sub: fixed ? undefined : "Their service line or the agent portal" },
      { key: "file", title: "Wait for the next file to show it paid", done: false, sub: file },
    ];
  }
  const callTitle = c.reason === "mailed_bill" ? "Call before the next bill is due"
    : c.reason === "cancellation_request" ? `Call ${who}: find out why they want to cancel` : `Call ${who}`;
  const fixTitle = c.reason === "mailed_bill" ? "Offer a bank payment on the day their money arrives"
    : c.reason === "cancellation_request" ? "Offer a fix, or close it without a save"
      : c.step === "paperwork" ? "Get what is needed and send it"
        : PAYMENT_FIXES.includes(c.reason) ? "Take the payment, or fix the bank or the date" : "Take the payment";
  return [
    { key: "call", title: callTitle, done: called, sub: callSub },
    { key: "fix", title: fixTitle, done: fixed, sub: fixed ? undefined : `Then send the change to ${c.carrierName}` },
    { key: "file", title: "The next carrier file closes it", done: false, sub: file },
  ];
}

/** "Mutual of Omaha · Living promise · MO-87004213 · $38.90/mo": the money is the monthly premium only. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

// ─── log an attempt (F5): the board's five outcomes, each filed as one of the server's ─────────────
/**
 * Board F5's outcomes and what each is filed as on the server (lib/retention/constants.ts CONTACT_OUTCOMES). The board
 * draws them for Ruth ("Reached her", "She'll call the carrier"); a contact carries no gender, so the phone says them
 * without one. Reaching them is a reached call ("reached_agreed": the server has no plain "reached"); "They'll call the
 * carrier" is a reached call too, and the server keeps that the client will call the carrier beside it
 * (`client_calls_carrier`).
 */
export const OUTCOMES: { key: string; label: string; icon: IconName; outcome: string; clientCallsCarrier?: boolean }[] = [
  { key: "reached", label: "Reached them", icon: "checkC", outcome: "reached_agreed" },
  { key: "no_answer", label: "No answer", icon: "phoneOff", outcome: "no_answer" },
  { key: "voicemail", label: "Left voicemail", icon: "mic", outcome: "voicemail" },
  { key: "wrong_number", label: "Wrong number", icon: "ban", outcome: "wrong_number" },
  { key: "client_calls", label: "They’ll call the carrier", icon: "phoneOut", outcome: "reached_agreed", clientCallsCarrier: true },
];
export const ACTION_LABELS: Record<string, string> = {
  none: "Nothing changed", move_draft_date: "Agreed to move the payment date", convert_to_draft: "Agreed to switch to bank payment",
  confirm_card_funded: "Confirmed the card will be funded", confirm_account: "Confirmed the account", review_coverage: "Reviewed the coverage", courtesy_call: "Courtesy check-in",
};
const FIX_ACTIONS = ["move_draft_date", "convert_to_draft", "confirm_card_funded", "confirm_account", "review_coverage", "courtesy_call"];
export const isUnreached = (outcome: string) => outcome === "voicemail" || outcome === "no_answer" || outcome === "wrong_number";
/** lib/retention/callLog.ts `actionsFor`: what was done follows what happened, so a refusal can't also be an agreement. */
export function actionsFor(outcome: string): string[] {
  if (outcome === "reached_agreed") return FIX_ACTIONS;
  if (outcome === "reached_refused") return ["none", "review_coverage", "courtesy_call"];
  if (outcome === "already_fixed") return ["none", "confirm_account", "confirm_card_funded"];
  return ["none"];
}

// ─── open a case (F3d): the board's five reasons, each filed under one the server opens a case for ─
/**
 * Board F3d's reasons. The server opens a person's case for three reasons only (PERSON_REASONS: asked to cancel, a new
 * payment date, something the carrier needs; the database's own list), so each of the board's five is filed under
 * the nearest one, and its own words lead the note ("Changed banks: …") so the case says what the client said.
 */
export const PERSON_REASONS: { key: string; label: string; icon: IconName; reason: string }[] = [
  { key: "changed_banks", label: "Changed banks", icon: "landmark", reason: "payment_date_change" },
  { key: "cant_afford", label: "Can’t afford it", icon: "dollar", reason: "cancellation_request" },
  { key: "moved", label: "Moved", icon: "pin", reason: "pending_manual_action" },
  { key: "wants_cancel", label: "Wants to cancel", icon: "x", reason: "cancellation_request" },
  { key: "beneficiary", label: "Beneficiary change", icon: "users", reason: "pending_manual_action" },
];
/** The note the case opens with: the board's reason, then what she said. */
export function openingNote(reasonKey: string, said: string): string {
  const label = PERSON_REASONS.find((r) => r.key === reasonKey)?.label ?? "";
  const words = said.trim();
  return words ? `${label}: ${words}` : label;
}

// ─── waiting on the carrier (F3b) ──────────────────────────────────────────────────────────────
export const CHANGE_LABEL: Record<RequestType, string> = {
  draft_date_change: "New draft date", payment_method_change: "New bank", bill_to_draft_conversion: "Bank payment for a mailed bill", address_change: "Address change",
  reinstatement: "Reinstatement paid",
};
/** What a carrier file proved, in the board's words ("Draft cleared · Transamerica file 21 Nov"). */
export const PROVEN_LABEL: Record<RequestType, string> = {
  draft_date_change: "Draft cleared", payment_method_change: "Draft cleared", bill_to_draft_conversion: "Draft cleared", address_change: "Address updated",
  reinstatement: "Back in force",
};
export type Bucket = "check" | "send" | "waiting" | "proven";
/** servicing-shared.ts `bucketOf`: sent requests need a person once the carrier says done, the file can't show it, or the date passed. */
export function bucketOf(r: WaitingRequest, today: string): Bucket {
  if (r.status === "draft") return "send";
  if (r.status === "verified_in_file") return "proven";
  return r.status === "confirmed_by_carrier" || r.unprovable || (r.expectedEffectiveDate !== null && r.expectedEffectiveDate < today) ? "check" : "waiting";
}
/** Days since it was sent (or saved, if never sent). */
export const waitedDays = (r: WaitingRequest, now = Date.now()) => Math.max(0, Math.floor((now - Date.parse(r.submittedAt ?? r.createdAt)) / 86_400_000));

/**
 * The open ones (check first, then not sent, then waiting, the longest wait first) and the ones a file proved this
 * week (board: "Proved by a file this week"), newest first.
 */
export function waitingGroups(rows: WaitingRequest[], today: string, now = Date.now()) {
  const order: Bucket[] = ["check", "send", "waiting"];
  const open = rows.filter((r) => bucketOf(r, today) !== "proven")
    .sort((a, b) => order.indexOf(bucketOf(a, today)) - order.indexOf(bucketOf(b, today)) || waitedDays(b, now) - waitedDays(a, now));
  const weekAgo = now - 7 * 86_400_000;
  const proven = rows.filter((r) => bucketOf(r, today) === "proven" && Date.parse(r.verifiedAt ?? r.createdAt) >= weekAgo).sort((a, b) => (b.verifiedAt ?? "").localeCompare(a.verifiedAt ?? ""));
  return { open, proven };
}

export function waitingChip(r: WaitingRequest, today: string, now = Date.now()): { tone: Tone; text: string } {
  const b = bucketOf(r, today);
  const days = waitedDays(r, now);
  if (b === "proven") return { tone: "ok", text: r.caseId ? "Saved" : "Done" };
  if (b === "send") return { tone: "neutral", text: "Not sent yet" };
  if (b === "check") return { tone: "warn", text: `${plural(days, "day", "days")}, check` };
  return { tone: "info", text: days === 0 ? "Today" : plural(days, "day", "days") };
}

export function waitingMeta(r: WaitingRequest, now = Date.now()): string {
  const change = CHANGE_LABEL[r.type] ?? "A change";
  if (r.status === "verified_in_file") return `${PROVEN_LABEL[r.type] ?? change} · ${r.carrierName} file ${dayMonth(r.verifiedSnapshotDate ?? r.verifiedAt ?? r.createdAt)}`;
  // As drawn, a reinstatement ("Reinstatement paid · AMAM 16 Nov") and an address change ("Address change · AMAM
  // 12 Nov") name the carrier and the day without "sent to"; the bank and draft-date changes say "sent to".
  if (r.type === "reinstatement" || (r.type === "address_change" && r.submittedAt)) return `${change} · ${r.carrierName} ${dayMonth(r.submittedAt ?? r.createdAt)}`;
  if (!r.submittedAt) return `${change} · not sent yet`;
  return `${change} · sent to ${r.carrierName} ${waitedDays(r, now) === 0 ? "today" : dayMonth(r.submittedAt)}`;
}

// ─── win-back (F3c) ────────────────────────────────────────────────────────────────────────────
export type WinbackStage = "released" | "blocked" | "soon" | "resting";
/** winback-stages.tsx: on the Win-back list, stuck, due within 30 days, or still cooling off. */
export function winbackStage(r: WinbackPerson, today: string): WinbackStage {
  if (r.releasedAt) return "released";
  if (r.blockedReason) return "blocked";
  return r.eligibleFrom && daysBetween(today, r.eligibleFrom) <= 30 ? "soon" : "resting";
}
const WHY_SHORT: Record<string, string> = {
  mechanical: "a payment failed", administrative: "bank or card changed", unknown: "no reason given", carrier_declined: "carrier declined",
  affordability: "price", no_longer_wanted: "didn’t want it", do_not_contact: "asked not to be called", deceased: "deceased",
};
/** Ready to call first, then stuck, then soonest out of the cooling-off. */
export function winbackOrder(rows: WinbackPerson[], today: string): WinbackPerson[] {
  const order: WinbackStage[] = ["released", "blocked", "soon", "resting"];
  return [...rows].sort((a, b) => order.indexOf(winbackStage(a, today)) - order.indexOf(winbackStage(b, today)) || (a.eligibleFrom ?? "").localeCompare(b.eligibleFrom ?? ""));
}
const DISPOSITION_WORDS: Record<string, string> = { no_answer: "no answer", voicemail: "left voicemail", busy: "busy", wrong_number: "wrong number", callback: "asked for a callback" };
/**
 * "Lapsed Jun · price", and once the lead has been dialed "Lapsed Mar · called 2× · no answer" (the dialer's attempts
 * on the released lead). The board's price comparison ("TA $62 → AMAM $49") needs a quote the server doesn't make.
 */
export function winbackMeta(r: WinbackPerson): string {
  const why = r.blockedReason ?? WHY_SHORT[r.category] ?? r.category.replace(/_/g, " ");
  const calls = r.calls && r.calls.count > 0 ? [`called ${r.calls.count}×`, r.calls.lastDisposition ? DISPOSITION_WORDS[r.calls.lastDisposition] ?? r.calls.lastDisposition.replace(/_/g, " ") : null] : [why];
  return [`Lapsed ${monthShort(r.lapsedOn)}`, ...calls].filter(Boolean).join(" · ");
}
export function winbackChip(r: WinbackPerson, today: string): { tone: Tone; text: string } {
  const s = winbackStage(r, today);
  if (s === "released") return { tone: "ok", text: "Ready" };
  if (s === "blocked") return { tone: "neutral", text: "Can’t write" };
  return { tone: "info", text: r.eligibleFrom ? `Try in ${monthShort(r.eligibleFrom)}` : "Cooling off" };
}
