// DESIGN FIXTURE — the raw rows the Sales performance page computes from at ?preview=sample (outside
// production), and the input the report tests count by hand. Deterministic: the same rows every
// render, dated relative to `now`. Names are invented. No server route imports this file.

import type { ApplicationOutcome, ApplicationStatus, InsuredRole, RequirementKind } from "./constants.ts";
import type { ReportAttempt, ReportCounteroffer, ReportInput, ReportQuote, ReportRequirement } from "./reportRules.ts";

const CARRIERS = [
  { id: "car-mutual", name: "Mutual of Omaha" },
  { id: "car-gerber", name: "Gerber Life" },
  { id: "car-americo", name: "Americo" },
  { id: "car-foresters", name: "Foresters" },
];
const PRODUCERS = [
  { id: "usr-priya", name: "Priya Sharma" },
  { id: "usr-rinor", name: "Rinor Gashi" },
  { id: "usr-dwayne", name: "Dwayne Adams" },
];
const REASONS = ["medication", "height_weight", "recent_hospitalisation", "prior_decline", "banking_nsf", "client_changed_mind"] as const;

/** A tiny linear-congruential sequence, so the sample is stable between renders. */
function sequence(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function sampleReportInput(now: number = Date.now(), cases = 180): ReportInput {
  const rand = sequence(42);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const hour = 3_600_000; const day = 24 * hour;

  const reportCases: ReportInput["cases"] = [];
  const attempts: ReportAttempt[] = [];
  const quotes: ReportQuote[] = [];
  const counteroffers: ReportCounteroffer[] = [];
  const requirements: ReportRequirement[] = [];

  for (let i = 0; i < cases; i += 1) {
    const caseId = `case-s${i}`; const leadId = `lead-s${i}`;
    reportCases.push({ id: caseId, source: rand() < 0.45 ? "inbound" : "outbound", campaignId: rand() < 0.5 ? "cmp-tx-sept" : null });
    const producer = pick(PRODUCERS).id;
    const roles: InsuredRole[] = rand() < 0.12 ? ["primary", "spouse"] : ["primary"];
    for (const role of roles) {
      const quotedAgo = Math.floor(rand() * 110) * day + Math.floor(rand() * 10) * hour;
      const carrier = pick(CARRIERS).id;
      const premium = 3_500 + Math.floor(rand() * 6_000);
      const quoteIds: string[] = [];
      const offers = 1 + Math.floor(rand() * 3);
      for (let q = 0; q < offers; q += 1) {
        const id = `q-s${i}-${role}-${q}`;
        quoteIds.push(id);
        quotes.push({ id, caseId, leadId, insuredRole: role, carrierId: q === 0 ? carrier : pick(CARRIERS).id, productCode: "final_expense", monthlyPremiumCents: premium + q * 310, createdBy: producer, createdAt: iso(quotedAgo - q * 60_000) });
      }
      const roll = rand();
      let status: ApplicationStatus = "draft"; let outcome: ApplicationOutcome | null = null; let reason: string | null = null;
      let submittedAt: string | null = null; let outcomeAt: string | null = null;
      const submitAgo = Math.max(0, quotedAgo - Math.floor(rand() * 30) * hour);
      if (roll > 0.25) { status = "submitted"; submittedAt = iso(submitAgo); }
      if (roll > 0.25 && roll <= 0.3) status = "ready";
      if (status === "ready") submittedAt = null;
      if (submittedAt) {
        const decided = rand();
        const decidedAgo = Math.max(0, submitAgo - (2 + Math.floor(rand() * 14)) * day);
        if (decided < 0.55) { status = "closed"; outcome = "issued"; outcomeAt = iso(decidedAgo); }
        else if (decided < 0.75) { status = "closed"; outcome = rand() < 0.8 ? "declined" : "postponed"; reason = pick(REASONS.slice(0, 5)); outcomeAt = iso(decidedAgo); }
        else if (decided < 0.8) { status = "closed"; outcome = "withdrawn"; reason = "client_changed_mind"; outcomeAt = iso(decidedAgo); }
        else if (decided < 0.9) {
          const coStatus = pick(["pending_client", "accepted", "rejected", "expired"] as const);
          counteroffers.push({ id: `co-s${i}-${role}`, applicationId: `app-s${i}-${role}`, status: coStatus, receivedAt: iso(Math.max(0, submitAgo - 3 * day)), reasonCode: pick(REASONS.slice(0, 3)) });
          if (coStatus === "pending_client") status = "counteroffer_pending";
          else if (coStatus === "accepted") status = "pending_carrier";
          else { status = "closed"; outcome = coStatus === "rejected" ? "declined_by_client" : "offer_expired"; outcomeAt = iso(Math.max(0, submitAgo - 8 * day)); }
        } else status = "pending_carrier";
        if (rand() < 0.4) {
          const kind: RequirementKind = pick(["aps", "phone_interview", "voice_verification", "missing_info", "paramed_exam"] as const);
          const raised = new Date(now - Math.max(0, submitAgo - day)).toISOString().slice(0, 10);
          const satisfied = rand() < 0.7 ? new Date(now - Math.max(0, submitAgo - (3 + Math.floor(rand() * 12)) * day)).toISOString().slice(0, 10) : null;
          requirements.push({ applicationId: `app-s${i}-${role}`, kind, raisedAt: raised, satisfiedAt: satisfied && satisfied >= raised ? satisfied : null });
        }
      }
      attempts.push({
        id: `app-s${i}-${role}`, caseId, leadId, insuredRole: role, attemptNo: 1, carrierId: carrier, productCode: "final_expense", quoteId: quoteIds[0],
        status, outcome, outcomeReasonCode: reason, createdBy: producer, createdAt: iso(quotedAgo), updatedAt: iso(Math.max(0, submitAgo - hour)), submittedAt, outcomeRecordedAt: outcomeAt,
      });
    }
  }

  return {
    timeZone: "UTC",
    carriers: CARRIERS,
    products: [{ code: "final_expense", label: "Final Expense" }],
    campaigns: [{ id: "cmp-tx-sept", name: "TX aged FE — Sept" }],
    producers: PRODUCERS,
    cases: reportCases,
    attempts,
    quotes,
    counteroffers,
    requirements,
    rates: CARRIERS.map((c, index) => ({ carrierId: c.id, productCode: "final_expense", rateBp: [11_000, 10_000, 9_500, 10_500][index] })),
    reasonLabels: {
      medication: "Medication disclosed", recent_hospitalisation: "Recent hospitalisation", height_weight: "Height / weight (build chart)",
      prior_decline: "Prior decline", banking_nsf: "Banking / NSF", client_changed_mind: "Client changed their mind",
    },
  };
}
