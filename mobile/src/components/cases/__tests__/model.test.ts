import { caseLine, dealRows, pendingTabs, pickAttempt, requirementLine, stillToCome, unsignedLeads, versusLastWeek, waitingChip, whereItIs, type ApplicationRow, type CaseAttempt, type CaseView, type DealRow, type PendingAnswer } from "../model";

/** The rules behind board E5–E7, on answers shaped like the live routes'. */
const NOW = Date.parse("2026-11-25T15:00:00Z");

const req = (over: Partial<PendingAnswer["requirements"][number]>) => ({
  id: "r1", applicationId: "a1", caseId: "c1", clientName: "George Patel", carrierName: "Corebridge", kind: "aps" as const, description: "APS from Dr. Amin",
  waitingOn: "client" as const, status: "open" as const, raisedAt: "2026-11-19", dueAt: null, daysOpen: 6, ageing: "amber" as const, ...over,
});
const app = (over: Partial<ApplicationRow>): ApplicationRow => ({
  caseId: "c9", applicationId: "a9", leadId: "l9", clientName: "Linda Okafor", carrierName: "American Amicable", productLabel: "Term Life",
  status: "submitted", outcome: null, submittedAt: "2026-11-25T13:00:00Z", closedAt: null, updatedAt: "2026-11-25T13:00:00Z", ...over,
});

test("Needs you holds what someone other than the carrier must answer, oldest first, with the board's chips", () => {
  const pending: PendingAnswer = {
    requirements: [
      req({ id: "r1", kind: "aps", daysOpen: 6 }),
      req({ id: "r2", applicationId: "a2", caseId: "c2", clientName: "Betty Holmes", carrierName: "Mutual of Omaha", kind: "amendment", daysOpen: 12 }),
      req({ id: "r3", applicationId: "a3", caseId: "c3", clientName: "Earl Oglesby", waitingOn: "carrier", daysOpen: 40 }),
    ],
    counteroffers: [{ id: "o1", applicationId: "a4", caseId: "c4", clientName: "Carl Weber", carrierName: "Transamerica", expiresAt: null, status: "pending_client" }],
  };
  const tabs = pendingTabs(pending, [app({}), app({ applicationId: "a1", caseId: "c1", status: "pending_carrier" }), app({ applicationId: "a3", caseId: "c3", clientName: "Earl Oglesby", status: "pending_carrier", submittedAt: "2026-11-14T13:00:00Z" })], NOW);
  expect(tabs.needsYou.map((r) => [r.title, r.chip, r.meta])).toEqual([
    ["Betty Holmes", "Sign again", "Mutual of Omaha · signature missing"],
    ["George Patel", "Needs a doc", "Corebridge · doctor’s records (APS)"],
    ["Carl Weber", "Counteroffer", "Transamerica · waiting on the client"],
  ]);
  // George's attempt needs him, so it is not also "at the carrier"; Earl's waits only on the carrier.
  expect(tabs.atCarrier.map((r) => [r.title, r.chip, r.meta])).toEqual([
    ["Linda Okafor", "Submitted", "American Amicable · submitted today"],
    ["Earl Oglesby", "Pending carrier", "American Amicable · day 11"],
  ]);
});

test("Issued counts this month's issues only", () => {
  const tabs = pendingTabs({ requirements: [], counteroffers: [] }, [
    app({ applicationId: "x1", status: "closed", outcome: "issued", closedAt: "2026-11-06T17:00:00Z" }),
    app({ applicationId: "x2", status: "closed", outcome: "issued", closedAt: "2026-10-30T17:00:00Z" }),
    app({ applicationId: "x3", status: "closed", outcome: "declined", closedAt: "2026-11-10T17:00:00Z" }),
  ], NOW);
  expect(tabs.issued.map((r) => r.key)).toEqual(["iss-x1"]);
});

const attempt = (over: Partial<CaseAttempt> = {}): CaseAttempt => ({
  id: "a1", attemptNo: 1, status: "pending_carrier", outcome: null, carrierName: "Corebridge", productLabel: "SIWL", selectedQuoteId: "q1",
  quotes: [{ id: "q1", carrierName: "Corebridge", productLabel: "SIWL", faceAmountCents: 2_000_000, monthlyPremiumCents: 7140, status: "selected" }],
  requirements: [], counteroffers: [], submissions: [{ id: "s1", carrierReference: "CB-4471902", policyNumber: null, submittedAt: "2026-11-13T15:00:00Z" }],
  payment: null, welcomePack: null, ...over,
});

test("the case line keeps the premium's cents (board E6) and the requirement line counts its days", () => {
  expect(caseLine(attempt())).toBe("Corebridge SIWL · $20,000 · $71.40/mo");
  expect(requirementLine({ id: "r", applicationId: "a1", kind: "aps", description: "Dr. Amin, Savannah Heart", waitingOn: "client", status: "open", raisedAt: "2026-11-19", dueAt: "2026-12-19" }, NOW))
    .toBe("Dr. Amin, Savannah Heart · asked Thu 19 Nov · day 6 of 30");
  // Past the carrier's due date it says how far past, never "day 55 of 14".
  expect(requirementLine({ id: "r", applicationId: "a1", kind: "voice_verification", description: "", waitingOn: "client", status: "open", raisedAt: "2026-11-01", dueAt: "2026-11-15" }, NOW))
    .toBe("asked Sun 1 Nov · 10 days past the carrier's 14");
});

test("Still to come: phone interview, payment, policy delivery, each only from what the case records", () => {
  expect(stillToCome(attempt(), "2026-11-25")).toEqual([["Policy delivery", "After issue"]]);
  const interview = { id: "r9", applicationId: "a1", kind: "phone_interview" as const, description: "", waitingOn: "client" as const, status: "satisfied" as const, raisedAt: "2026-11-15", dueAt: null };
  expect(stillToCome(attempt({ requirements: [interview], payment: { draftDay: 3 }, welcomePack: { status: "queued" } }), "2026-11-25")).toEqual([
    ["Phone interview", "Done"], ["Payment", "First draft 3 Dec"], ["Policy delivery", "Welcome pack queued"],
  ]);
  // A first draft already past says the day it drafts on.
  expect(stillToCome(attempt({ payment: { draftDay: 3 } }), "2027-01-10")[0]).toEqual(["Payment", "Drafts on the 3rd"]);
  expect(stillToCome(attempt({ status: "closed", outcome: "issued", submissions: [{ id: "s1", carrierReference: null, policyNumber: "P-77", submittedAt: "2026-11-13T15:00:00Z" }] }), "2026-11-25")).toEqual([["Policy delivery", "Policy P-77"]]);
});

test("pages sent from the phone turn the requirement to Sent", () => {
  const r = { id: "r", applicationId: "a1", kind: "aps" as const, description: "", waitingOn: "carrier" as const, status: "in_progress" as const, raisedAt: "2026-11-19", dueAt: null };
  expect(waitingChip(r)).toEqual({ tone: "info", text: "Sent" });
  expect(waitingChip({ ...r, status: "open" })).toEqual({ tone: "info", text: "With the carrier" });
});

test("the tapped requirement picks its attempt; otherwise the newest that reached the carrier", () => {
  const view: CaseView = { caseId: "c1", leadId: "l1", clientName: "George Patel", clientPhone: null, attempts: [
    attempt({ id: "a1", attemptNo: 1, requirements: [{ id: "r1", applicationId: "a1", kind: "aps", description: "", waitingOn: "client", status: "open", raisedAt: "2026-11-19", dueAt: null }] }),
    attempt({ id: "a2", attemptNo: 2, status: "draft" }),
  ] };
  expect(pickAttempt(view, "r1")?.id).toBe("a1");
  expect(pickAttempt(view, null)?.id).toBe("a1");
});

test("where it is keeps this attempt's events and marks only the newest as current", () => {
  const items = whereItIs([
    { id: "e1", at: "2026-11-19T15:00:00Z", title: "Corebridge asked for: APS", by: "Jordan R.", detail: null, attemptNo: 1 },
    { id: "e2", at: "2026-11-18T15:00:00Z", title: "Attempt 2 started", by: null, detail: null, attemptNo: 2 },
    { id: "e3", at: "2026-11-13T15:00:00Z", title: "Submitted to Corebridge", by: "Jordan R.", detail: null, attemptNo: 1 },
  ], 1);
  expect(items.map((i) => [i.title, i.muted])).toEqual([["Corebridge asked for: APS", false], ["Submitted to Corebridge", true]]);
});

const deal = (over: Partial<DealRow>): DealRow => ({
  id: "d1", lead_id: "l1", insured_name: "Linda Okafor", agent_name: "Ava Kim", carrier: "American Amicable", partner_name: "No partner",
  monthly_premium_cents: 5217, created_at: "2026-11-25T19:46:00Z", disposition_at: null, stage_name: "Issued", stage_type: "won", ...over,
});

test("written today: written deals only, newest first, annual premium only for premium roles, Unsigned the one chip", () => {
  const rows = [
    deal({ id: "d1" }),
    deal({ id: "d2", lead_id: "l2", insured_name: "Paul Stewart", agent_name: "Marcus Ortiz", carrier: "Corebridge", created_at: "2026-11-25T18:58:00Z", monthly_premium_cents: 9500 }),
    deal({ id: "d3", insured_name: "Lost One", created_at: "2026-11-25T20:00:00Z", stage_type: "lost", stage_name: "Not interested" }),
  ];
  const withMoney = dealRows(rows, "America/New_York", true, new Set(["l2"]));
  expect(withMoney.map((r) => [r.title, r.avatar, r.meta, r.right, r.chip])).toEqual([
    ["Linda Okafor", "AK", "Ava Kim · American Amicable · 2:46 pm", "$626", null],
    ["Paul Stewart", "MO", "Marcus Ortiz · Corebridge · 1:58 pm", "$1,140", "Unsigned"],
  ]);
  expect(dealRows(rows, "America/New_York", false).every((r) => r.right === null)).toBe(true);
});

test("a lead is unsigned while its newest primary application is a draft or waits on the signature", () => {
  const set = unsignedLeads([
    { leadId: "l1", status: "submitted", updatedAt: "2026-11-25T10:00:00Z" },
    { leadId: "l1", status: "ready", updatedAt: "2026-11-24T10:00:00Z" },
    { leadId: "l2", status: "ready", updatedAt: "2026-11-25T10:00:00Z" },
    { leadId: "l3", status: "draft", updatedAt: "2026-11-25T10:00:00Z", insuredRole: "spouse" },
  ]);
  expect([...set]).toEqual(["l2"]);
});

test("against the same weekday last week", () => {
  expect(versusLastWeek(691_200, 580_800, "2026-11-24")).toEqual({ up: true, amount: "$1,104", label: "vs last Tue" });
  expect(versusLastWeek(100, 100, "2026-11-24").label).toBe("Same as last Tue");
});
