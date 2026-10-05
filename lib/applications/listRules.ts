// The LA-3 list pages' rules, pure and client-safe (LA-3.5, 3.15, 3.18, 3.26).
//
// The server loaders (lists.ts, pending.ts) and the pages both use these, so the orphan rule, the
// ageing colours, the "waiting on the client first" order and the counteroffer arithmetic are
// written once and tested once (listRules.test.mjs). Imports are type-only so node --test can load
// this file directly.

import type { ApplicationOutcome, ApplicationStatus, InsuredRole, RequirementKind, WaitingOn } from "./constants.ts";
import type { ApplicationListRow, PendingRow } from "./types.ts";

// ── rows the pages render ────────────────────────────────────────────────────

/** An Applications row: the shared list row plus what the board shows beside it. */
export type ApplicationRow = ApplicationListRow & {
  submittedAt?: string | null;
  /** From the verdict frozen on the latest submission, when there is one. */
  qaBlocking?: number | null;
  qaWarnings?: number | null;
};

export type QuoteOutcome = "selected" | "superseded" | "presented" | "draft" | "discarded";

/** A saved quote with the case it belongs to — every quote, discarded ones included. No commission. */
export type QuoteRow = {
  id: string;
  caseId: string;
  applicationId: string | null;
  clientName: string;
  insuredRole: InsuredRole;
  state: string | null;
  carrierName: string;
  productLabel: string;
  productCode: string;
  tier: string | null;
  faceAmountCents: number;
  monthlyPremiumCents: number;
  outcome: QuoteOutcome;
  /** The per-$1,000 warning written when the quote was saved (QUOTE_PER1000_BAND), if any. */
  per1000Warning: string | null;
  createdAt: string;
};

/** An open requirement on the Pending cases list. */
export type RequirementRow = PendingRow & {
  insuredRole?: InsuredRole;
  lastChasedByName?: string | null;
  examVendor?: string | null;
};

/** A counteroffer waiting on the client. `applied` is the attempt's selected quote. */
export type CounterofferRow = {
  id: string;
  applicationId?: string;
  caseId: string;
  clientName: string;
  insuredRole?: InsuredRole;
  carrierName: string | null;
  receivedAt: string;
  applied: { tier: string | null; healthClass: string | null; faceCents: number; monthlyCents: number };
  offered: { tier: string | null; healthClass: string | null; faceCents: number; monthlyCents: number };
  reason: string;
  expiresAt: string | null;
  status: "pending_client" | "accepted" | "rejected" | "expired";
};

/** A submitted application still missing its carrier reference, or an issued one missing its policy number. */
export type AwaitingNumberRow = ApplicationListRow & { submittedAt: string; missing: "reference" | "policy_number" };

/** The three dashboard figures (LA-3.15, 3.18, 3.26). */
export type PendingSummary = {
  awaitingPolicyNumber: { count: number; missingReference: number; missingPolicyNumber: number };
  waitingOnClient: { count: number; overdue: number; overdueAfterDays: number };
  counteroffersExpiring: { count: number; withinDays: number; soonestExpiresAt: string | null };
};

// ── the orphan rule (LA-3.15) ───────────────────────────────────────────────

export const SUBMITTED_STATUSES: readonly ApplicationStatus[] = ["submitted", "pending_carrier", "counteroffer_pending"];

/** Submitted or pending with no carrier reference, or issued with no policy number. Otherwise null. */
export function missingNumber(row: { status: ApplicationStatus; outcome: ApplicationOutcome | null; reference: string | null; policyNumber: string | null }): "reference" | "policy_number" | null {
  if (SUBMITTED_STATUSES.includes(row.status) && !row.reference?.trim()) return "reference";
  if (row.status === "closed" && row.outcome === "issued" && !row.policyNumber?.trim()) return "policy_number";
  return null;
}

// ── ageing (LA-3.18) ─────────────────────────────────────────────────────────

export type Ageing = "ok" | "amber" | "red";

/** Amber from N days, red from 2N, counted from the day the carrier raised it. */
export function ageingFor(daysOpen: number, n: number): Ageing {
  const days = Math.max(0, daysOpen);
  const step = Math.max(1, Math.floor(n));
  if (days >= step * 2) return "red";
  if (days >= step) return "amber";
  return "ok";
}

/** Whole days from `from` (an ISO date or time) to `now`, never negative. Calendar days for a date. */
export function wholeDaysSince(from: string | null | undefined, now: number): number | null {
  if (!from) return null;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00Z`) : Date.parse(from);
  if (Number.isNaN(at)) return null;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) : now;
  return Math.max(0, Math.floor((today - at) / 86_400_000));
}

/** Waiting on the client first — the one column the agent can move — then the oldest raised. */
export function byRisk(a: { waitingOn: WaitingOn; raisedAt: string; daysOpen: number; clientName: string }, b: { waitingOn: WaitingOn; raisedAt: string; daysOpen: number; clientName: string }) {
  const client = Number(b.waitingOn === "client") - Number(a.waitingOn === "client");
  return client || a.raisedAt.localeCompare(b.raisedAt) || b.daysOpen - a.daysOpen || a.clientName.localeCompare(b.clientName);
}

/** The requirement names the board uses. */
export const REQUIREMENT_SHORT_LABEL: Record<RequirementKind, string> = {
  aps: "APS",
  phone_interview: "Phone health interview",
  voice_verification: "Voice verification",
  missing_info: "Missing information",
  amendment: "Amendment",
  paramed_exam: "Paramed exam",
  counteroffer: "Counteroffer",
  other: "Other",
};

/** Who the requirement waits on, as a person reads it: "The client", "ExamOne", "The carrier". */
export function waitingOnText(row: { waitingOn: WaitingOn; examVendor?: string | null }): string {
  if (row.waitingOn === "client") return "The client";
  if (row.waitingOn === "carrier") return "The carrier";
  if (row.waitingOn === "agent") return "You";
  return row.examVendor?.trim() || "A third party";
}

// ── counteroffers (LA-3.26) ─────────────────────────────────────────────────

/** Difference and its percentage of the applied-for value, to one decimal. Integer cents in and out. */
export function delta(appliedCents: number, offeredCents: number): { cents: number; pct: number | null } {
  const cents = offeredCents - appliedCents;
  if (appliedCents <= 0) return { cents, pct: null };
  // Tenths of a percent, half away from zero, without float drift: 5000/15000 → −33.3.
  const tenths = Math.round((Math.abs(cents) * 1000) / appliedCents);
  return { cents, pct: (cents < 0 ? -tenths : tenths) / 10 };
}

/** "−$5,000 · −33.3%", "+$4.20 · +6.1%", "No change". `whole` drops the cents (face amounts). */
export function deltaText(appliedCents: number, offeredCents: number, whole = false): string {
  const d = delta(appliedCents, offeredCents);
  if (d.cents === 0) return "No change";
  const sign = d.cents > 0 ? "+" : "−";
  const abs = Math.abs(d.cents);
  const dollars = whole ? `$${Math.round(abs / 100).toLocaleString("en-US")}` : `$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return d.pct === null ? `${sign}${dollars}` : `${sign}${dollars} · ${sign}${Math.abs(d.pct).toFixed(1)}%`;
}

export type Countdown = { tone: "danger" | "warning" | "neutral"; label: string; expired: boolean };

/** "in 4 days", "in 5 hours", "Expired": red inside 2 days, amber inside 5, grey after. */
/** How long a quote stands when its quotation template says nothing (Settings › Quotation's default). */
export const DEFAULT_QUOTE_VALID_DAYS = 30;

/**
 * A quote older than its template's validity (LA-3.4 `valid_days`) is expired: the carrier's
 * premium may have moved. It is a warning, never a block — the carrier's own tool is the authority.
 */
export function quoteExpired(createdAt: string, validDays: number | null | undefined, now: number): boolean {
  const days = typeof validDays === "number" && validDays > 0 ? validDays : DEFAULT_QUOTE_VALID_DAYS;
  const at = Date.parse(createdAt);
  return Number.isFinite(at) && now - at > days * 86_400_000;
}

export function expiryCountdown(expiresAt: string | null, now: number): Countdown | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { tone: "danger", label: "Expired", expired: true };
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return { tone: "danger", label: hours <= 1 ? "in 1 hour" : `in ${hours} hours`, expired: false };
  const days = Math.ceil(ms / 86_400_000);
  return { tone: days <= 2 ? "danger" : days <= 5 ? "warning" : "neutral", label: `in ${days} ${days === 1 ? "day" : "days"}`, expired: false };
}

/** The Pending tab's summary figures and the dashboard card's, from the same rows. */
export function summarise(input: { requirements: RequirementRow[]; counteroffers: CounterofferRow[]; awaiting: AwaitingNumberRow[]; ageingDays: number; now: number; expiringWithinDays?: number }): PendingSummary {
  const within = input.expiringWithinDays ?? 5;
  const client = input.requirements.filter((row) => row.waitingOn === "client");
  const expiring = input.counteroffers
    .filter((row) => row.status === "pending_client" && row.expiresAt && Date.parse(row.expiresAt) - input.now <= within * 86_400_000)
    .sort((a, b) => (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""));
  return {
    awaitingPolicyNumber: {
      count: input.awaiting.length,
      missingReference: input.awaiting.filter((row) => row.missing === "reference").length,
      missingPolicyNumber: input.awaiting.filter((row) => row.missing === "policy_number").length,
    },
    waitingOnClient: { count: client.length, overdue: input.requirements.filter((row) => ageingFor(row.daysOpen, input.ageingDays) === "red").length, overdueAfterDays: input.ageingDays * 2 },
    counteroffersExpiring: { count: expiring.length, withinDays: within, soonestExpiresAt: expiring[0]?.expiresAt ?? null },
  };
}

// ── quotes (LA-3.5) ─────────────────────────────────────────────────────────

/**
 * A quote's outcome as the list reads it. A selected quote on an attempt that ended without a policy
 * and was followed by a new attempt is "superseded" — the price she was read, kept, not the live one.
 */
export function quoteOutcome(status: "draft" | "presented" | "selected" | "discarded", attempt: { status: ApplicationStatus; outcome: ApplicationOutcome | null; followedByNewAttempt: boolean } | null): QuoteOutcome {
  if (status === "selected" && attempt && attempt.status === "closed" && attempt.outcome !== "issued" && attempt.followedByNewAttempt) return "superseded";
  return status;
}

// ── dates as the boards print them ──────────────────────────────────────────

/** "28 Sep". */
export function dayMonth(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const at = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  // Month names by hand: Node's ICU prints "Sept" where browsers print "Sep", which breaks hydration.
  const parts = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "numeric", timeZone }).formatToParts(at);
  const day = parts.find((p) => p.type === "day")?.value ?? String(at.getUTCDate());
  const month = Number(parts.find((p) => p.type === "month")?.value ?? at.getUTCMonth() + 1);
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]}`;
}

/** "28 Sep 2:41pm". */
export function dayMonthTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(at).replace(/\s/g, "").toLowerCase();
  return `${dayMonth(iso, timeZone)} ${time}`;
}

/** "Priya S." from "Priya Sharma". */
export function shortPersonName(name: string | null | undefined): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** The calendar day an ISO time falls on in a zone, YYYY-MM-DD. */
export function localDay(iso: string, timeZone = "UTC"): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
