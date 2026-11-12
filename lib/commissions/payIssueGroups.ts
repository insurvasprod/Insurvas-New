import type { DiscrepancyType } from "../ingestion/discrepancyEngine.ts";

/**
 * Commissions › Pay issues (round 7, owner pick 2·A, 2026-11-10; docs/la4/mockups-r7/commissions.html 2·A–2·5):
 * every issue from both sources (the carriers' own files and statements imported by hand) in one shape, grouped
 * by carrier and kind. A group opens its own page (/app/discrepancies/group), an issue its own page
 * (/app/discrepancies/[id]); the letter is drafted from the group. Money is two columns, never netted: what the
 * carrier owes you and what you owe the carrier.
 *
 * Pure: no server, no React (lib/commissions/commissionsBoards.test.mjs runs it under node).
 */

/** The short "usually" hint per kind: what settles most of them. */
export const PAY_ISSUE_USUALLY: Record<DiscrepancyType, string> = {
  missing: "not paid yet, or no rate to price it: check the pay lag, then a letter",
  short_paid: "a letter with the figures",
  over_paid: "may be taken back: hold it",
  mis_rated: "the rate card or the file's layout is off: fix the rate first",
  duplicate_chargeback: "dispute: one lapse, one chargeback",
  unexpected_chargeback: "dispute, unless the policy lapsed",
  missing_chargeback: "coming back: don't spend it",
  held_building_up: "ask the carrier when it releases",
  debit_balance_growing: "chargebacks outrun pay: watch the account",
  not_received: "check the bank deposit, then ask the carrier",
};

/** "What to do" in a group's row: the usual next step, in words (mockup 2·A). */
export const PAY_ISSUE_NEXT: Record<DiscrepancyType, string> = {
  missing: "Check the pay lag, then a letter",
  short_paid: "Put them on a letter",
  over_paid: "Hold it: may be taken back",
  mis_rated: "Fix the rate first",
  duplicate_chargeback: "Dispute it: one lapse, one chargeback",
  unexpected_chargeback: "Dispute it, unless the policy lapsed",
  missing_chargeback: "Coming back: don't spend it",
  held_building_up: "Ask the carrier when it releases",
  debit_balance_growing: "Watch the account",
  not_received: "Check the bank deposit, then ask",
};

/** Kinds the agency holds rather than disputes: no primary on their group's page. */
export const HOLD_KINDS: ReadonlySet<DiscrepancyType> = new Set(["over_paid", "missing_chargeback", "held_building_up", "debit_balance_growing", "not_received"]);

/** A hand-imported statement's kind, named as the carrier-file kind it is (one vocabulary for both sources). */
export const HAND_TYPE = { never_paid: "missing", short_paid: "short_paid", mis_rated: "mis_rated", duplicate_chargeback: "duplicate_chargeback", unexpected_chargeback: "unexpected_chargeback" } as const satisfies Record<string, DiscrepancyType>;

/** Where an issue stands, worded once for both sources ("In a letter", never "Disputed"). */
export type PayIssueStatus = "open" | "letter" | "closed";
export const PAY_ISSUE_STATUS_WORD: Record<PayIssueStatus, string> = { open: "Open", letter: "In a letter", closed: "Closed" };

export type PayIssue = {
  id: string;
  source: "carrier" | "hand";
  type: DiscrepancyType;
  /** null when a hand-imported statement names a carrier the library does not know. */
  carrierId: string | null;
  carrierName: string;
  /** null for a whole-account issue (held money, a debit balance). */
  policyNumber: string | null;
  clientName: string | null;
  issuedOn: string | null;
  expectedCents: number | null;
  paidCents: number | null;
  /** Never netted: a group sums each side on its own. */
  owedToYouCents: number;
  owedToCarrierCents: number;
  /** Missing commission with no rate to price it. */
  unpriced: boolean;
  /** Still inside the carrier's pay lag: kept off a letter by default. */
  withinLag: boolean;
  /** Can go on a dispute letter now (open, of a kind that is argued). */
  disputable: boolean;
  status: PayIssueStatus;
  /** The word for a closed issue (Resolved, Dismissed, Written off…); the status word otherwise. */
  statusWord: string;
  foundAt: string;
  disputeId: string | null;
};

export type PayIssueGroup = {
  key: string;
  carrierKey: string;
  type: DiscrepancyType;
  carrierId: string | null;
  carrierName: string;
  count: number;
  owedToYouCents: number;
  owedToCarrierCents: number;
  unpriced: number;
  /** The first-found issue's date. */
  oldest: string | null;
  usually: string;
  next: string;
  href: string;
};

/** A group's carrier, in the address: the carrier's id, or its name for one the library does not know. */
export const payIssueCarrierKey = (issue: { carrierId: string | null; carrierName: string }) => issue.carrierId ?? `name:${issue.carrierName.trim().toLowerCase()}`;

export function payIssueGroupHref(carrierKey: string, type: DiscrepancyType, tab?: "letter" | "closed"): string {
  return `/app/discrepancies/group?${new URLSearchParams({ carrier: carrierKey, kind: type, ...(tab ? { tab } : {}) })}`;
}

/** An issue's page; a hand-statement finding says so (its id is another table's). */
export const payIssueHref = (issue: { id: string; source: "carrier" | "hand" }, tab?: string) => {
  const q = new URLSearchParams({ ...(issue.source === "hand" ? { source: "hand" } : {}), ...(tab ? { tab } : {}) }).toString();
  return `/app/discrepancies/${issue.id}${q ? `?${q}` : ""}`;
};

export const payIssueLetterHref = (id: string) => `/app/discrepancies/letters/${id}`;

const size = (issue: Pick<PayIssue, "owedToYouCents" | "owedToCarrierCents">) => issue.owedToYouCents + issue.owedToCarrierCents;

/** One group's issues in working order: the largest first, then the oldest, then the policy. */
export function orderPayIssues<T extends Pick<PayIssue, "owedToYouCents" | "owedToCarrierCents" | "foundAt" | "policyNumber" | "id">>(issues: T[]): T[] {
  return [...issues].sort((a, b) => size(b) - size(a) || a.foundAt.localeCompare(b.foundAt) || (a.policyNumber ?? "").localeCompare(b.policyNumber ?? "") || a.id.localeCompare(b.id));
}

/** Groups by carrier and kind; the largest money first (both sides), then the most issues, then the carrier's name. */
export function groupPayIssues(issues: ReadonlyArray<Pick<PayIssue, "type" | "carrierId" | "carrierName" | "owedToYouCents" | "owedToCarrierCents" | "unpriced" | "foundAt">>): PayIssueGroup[] {
  const groups = new Map<string, PayIssueGroup>();
  for (const issue of issues) {
    const carrierKey = payIssueCarrierKey(issue);
    const key = `${issue.type}|${carrierKey}`;
    const group = groups.get(key) ?? {
      key, carrierKey, type: issue.type, carrierId: issue.carrierId, carrierName: issue.carrierName, count: 0, owedToYouCents: 0, owedToCarrierCents: 0, unpriced: 0, oldest: null,
      usually: PAY_ISSUE_USUALLY[issue.type] ?? "", next: PAY_ISSUE_NEXT[issue.type] ?? "Open it", href: payIssueGroupHref(carrierKey, issue.type),
    };
    group.count += 1;
    group.owedToYouCents += issue.owedToYouCents;
    group.owedToCarrierCents += issue.owedToCarrierCents;
    if (issue.unpriced) group.unpriced += 1;
    if (!group.oldest || issue.foundAt < group.oldest) group.oldest = issue.foundAt;
    groups.set(key, group);
  }
  for (const group of groups.values()) if (group.type === "missing" && group.unpriced > 0) group.next = "Add the rate first";
  return [...groups.values()].sort((a, b) => size(b) - size(a) || b.count - a.count || a.carrierName.localeCompare(b.carrierName));
}

/**
 * The group page's primary (mockup 2·1): draft the letter for a kind that is argued, add or fix the rate when the
 * rate is what is wrong, none for a kind that is held.
 */
export function payIssueGroupPrimary(type: DiscrepancyType, unpriced: number): "letter" | "add_rate" | "fix_rate" | null {
  if (HOLD_KINDS.has(type)) return null;
  if (type === "mis_rated") return "fix_rate";
  if (type === "missing" && unpriced > 0) return "add_rate";
  return "letter";
}

/** The items either side of one, in the list's order. */
export function payIssueNeighbours<T>(ordered: T[], at: (item: T) => boolean): { previous: T | null; next: T | null } {
  const index = ordered.findIndex(at);
  if (index < 0) return { previous: null, next: null };
  return { previous: ordered[index - 1] ?? null, next: ordered[index + 1] ?? null };
}

/** Whole days from an ISO date to `today` (YYYY-MM-DD). */
export function daysSince(iso: string | null, today: string): number | null {
  if (!iso) return null;
  const from = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const to = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, Math.round((to - from) / 86_400_000)) : null;
}

/** Dollars with cents and a real minus sign; "—" for nothing to show. */
export function payIssueMoney(cents: number | null): string {
  if (cents === null) return "—";
  return `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The letters' two lists: waiting on someone (Letters out), or with the carrier's answer recorded (Settled). */
export const LETTER_OUT_STATUSES: ReadonlySet<string> = new Set(["draft", "sent", "acknowledged"]);
export const LETTER_SETTLED_STATUSES: ReadonlySet<string> = new Set(["accepted", "partial", "rejected"]);
export const LETTER_STATUS_WORD: Record<string, string> = { draft: "Saved, not sent", sent: "Sent, no answer", acknowledged: "Acknowledged", accepted: "Accepted in full", partial: "Partly credited", rejected: "Rejected" };
export const LETTER_NEXT: Record<string, string> = { draft: "Send it, then mark it sent", sent: "Record what the carrier did", acknowledged: "Record what the carrier did" };

/** Letters in their list's order: by carrier, then the newest first (the letter page's ‹ › walk it). */
export function orderLetters<T extends { carrierName: string; createdAt: string; id: string }>(letters: T[]): T[] {
  return [...letters].sort((a, b) => a.carrierName.localeCompare(b.carrierName) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** Each carrier's dispute record over its settled letters ("2 of 2 · credited $530.98 of $1,275.46 claimed"). */
export function disputeRecord(letters: ReadonlyArray<{ carrierId: string; carrierName: string; status: string; totalCents: number; outcomeCents: number | null }>) {
  const by = new Map<string, { carrierId: string; name: string; settled: number; won: number; claimedCents: number; creditedCents: number }>();
  for (const letter of letters) {
    if (!LETTER_SETTLED_STATUSES.has(letter.status)) continue;
    const r = by.get(letter.carrierId) ?? { carrierId: letter.carrierId, name: letter.carrierName, settled: 0, won: 0, claimedCents: 0, creditedCents: 0 };
    r.settled += 1;
    if (letter.status !== "rejected") r.won += 1;
    r.claimedCents += letter.totalCents;
    r.creditedCents += letter.outcomeCents ?? 0;
    by.set(letter.carrierId, r);
  }
  return [...by.values()].sort((a, b) => b.claimedCents - a.claimedCents || a.name.localeCompare(b.name));
}
