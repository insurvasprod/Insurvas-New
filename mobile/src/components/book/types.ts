/**
 * What the server's Book answers hold (GET /api/app/policy-book, lib/ingestion/policyPhone.ts) and what Needs you
 * answers hold (GET /api/app/needs-you/item, lib/needsYou/store.ts). Typed here once so the screens and their
 * tests agree with the server.
 */

/** The web's chip tones (lib/ingestion/policyMoney.ts Tone). */
export type WebTone = "good" | "info" | "warning" | "danger" | "neutral";

/** Board F1's chips; "behind" is still answered for an older app, not offered. */
export type BookChip = "inforce" | "pending" | "lapsed" | "chargedback" | "behind";

export type BookRow = {
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  premiumCents: number | null;
  premiumMode: string | null;
  health: { label: string; tone: WebTone };
  opens: "policy" | "computer";
  webPath: string | null;
};

export type BookPage = {
  ok: true;
  rows: BookRow[];
  counts: Record<BookChip, number> & { all: number };
  total: number;
  offset: number;
  next: number | null;
  available: boolean;
  moneyOk: boolean;
  scoped: boolean;
};

export type LedgerLine = {
  id: string;
  label: string;
  type: string;
  monthsAdvanced: number | null;
  amountCents: number;
  date: string | null;
  fileName: string | null;
  upline: boolean;
  held: boolean;
};

export type CarrierPolicy = {
  kind: "policy";
  title: string;
  carrierName: string;
  product: string | null;
  policyNumber: string;
  /** Null while the policy is behind: "N payments behind" is said on the figure instead (owner 2026-11-10). */
  health: { label: string; tone: WebTone } | null;
  statusRaw: string | null;
  premiumCents: number | null;
  premiumMode: string | null;
  monthlyCents: number | null;
  faceCents: number | null;
  issuedOn: string | null;
  effectiveDate: string | null;
  paidTo: string | null;
  monthsPaid: number | null;
  inClawbackWindow: boolean | null;
  clawbackMonths: number | null;
  behind: string | null;
  next: { label: string; date: string; detail: string } | null;
  draftDay: number | null;
  agentName: string | null;
  agentCode: string | null;
  file: { name: string; date: string | null; rowNumber: number | null } | null;
  /** Where each value came from, in the web's words; null when it can't be said. */
  sources: { status: string | null; premium: string | null; face: string | null; issued: string | null; agent: string | null; paidTo: string | null };
  money: {
    available: boolean;
    advancedCents: number | null;
    advancedOn: string | null;
    earnedCents: number | null;
    atRiskCents: number | null;
    paidToDateCents: number | null;
    lines: LedgerLine[];
  };
  leadId: string | null;
  caseId: string | null;
  /** Board F2 / F2b (lib/ingestion/policyPhoneMore.ts); absent from an older server. */
  beneficiary?: string | null;
  draftsCleared?: number | null;
  expected?: ExpectedLine[];
  split?: Split | null;
};

/** A commission line not posted yet: the rest of the first year, or a renewal year (amount null: no rate). */
export type ExpectedLine = { key: string; label: string; startsOn: string | null; amountCents: number | null; kind: "as_earned" | "renewal" };

/** The writing agent's pay-plan share of the advance; the agency's amount is null for a producer ("not shown"). */
export type Split = { agentName: string; agentPctBp: number; agentCents: number; agencyPctBp: number; agencyCents: number | null };

/** A sale recorded as issued whose carrier file hasn't listed the policy yet. */
export type AwaitingPolicy = {
  kind: "awaiting";
  title: string;
  carrierName: string;
  product: string | null;
  policyNumber: string;
  health: { label: string; tone: WebTone };
  monthlyCents: number | null;
  faceCents: number | null;
  issuedOn: string | null;
  agentName: string | null;
  leadId: string | null;
};

export type PolicyAnswer = { ok: true; policy: CarrierPolicy | AwaitingPolicy; role: string; readOnly: boolean; /** May open Retention cases (owner, producer, retention on the plan). */ canOpenCase?: boolean };

// ─── Needs you ────────────────────────────────────────────────────────────────────────────────────

export type NeedsYouItem = {
  kind: string;
  id: string;
  label: string;
  todo: string;
  about: string;
  why: string;
  since: string;
  ageDays: number;
  tone: "neutral" | "warning" | "danger" | "info";
  webPath: string;
};

export type NeedsYouList = {
  ok: true;
  total: number;
  phone: { total: number; items: NeedsYouItem[] };
  computer: { total: number; items: NeedsYouItem[] };
  notes: string[];
  readOnly: boolean;
};

export type FieldOutcome = "match" | "partial" | "mismatch" | "missing";

export type Candidate = {
  index: number;
  type: "deal_flow" | "application";
  date: string;
  name: string;
  dob: string | null;
  fields: Record<string, FieldOutcome>;
  score: number;
  likely: boolean;
};

export type PickClientItem = {
  ok: true;
  detail: {
    kind: "pick-client";
    reviewId: string;
    policyNumber: string;
    carrierName: string;
    carrierRow: { name: string; dob: string | null; fileDate: string | null };
    candidates: Candidate[];
  };
  row: { fileName: string; rowNumber: number } | null;
  readOnly: boolean;
  /** Board F6: who each candidate is in the agency (lead stage and agent, or a policy held); by candidate index. */
  candidateFacts?: CandidateFacts[];
};

export type CandidateFacts = { index: number; stage: string | null; agentName: string | null; policyNumber: string | null; policyAgentName: string | null };
