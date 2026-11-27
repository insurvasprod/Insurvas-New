import { OUTCOMES, PERSON_REASONS, actionsFor, boardGroups, bucketOf, callToday, caseChip, caseSteps, casesOn, deadlineCard, groupCases, openingNote, saveRate, stepCounts, waitingChip, waitingGroups, waitingMeta, winbackChip, winbackMeta, winbackOrder, winbackStage } from "../logic";
import type { CaseDetail, CaseItem, WaitingRequest, WinbackPerson } from "../types";

/** The Retention rules the phone draws with, checked against the web's own (listOrder, case-view, servicing-shared, winback-stages). */
const item = (over: Partial<CaseItem> = {}): CaseItem => ({
  id: "c1", clientName: "Ruth Alva", carrierName: "Mutual of Omaha", policyNumber: "MO-1", step: "pending_lapse", reason: "pending_lapse",
  reasonLabel: "Carrier says lapse pending", status: "open", deadline: "2026-11-26", daysLeft: 2, contactAttempts: 0, unreachable: false,
  lastContactAt: null, lastCall: null, openedAt: "2026-11-16T10:00:00Z",
  evidence: { status: null, carrierWord: null, fileDate: null, paidTo: null, lapsedOn: null, daysPastDue: null, byPerson: false }, ...over,
});
const detail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
  ...item(), phone: "4045550142", monthlyCents: 3890, product: null, ownerName: null, servicingRequestId: null, nextAction: "Take the payment",
  resolvedAt: null, outcomeReason: null, calls: [], ...over,
});

test("a passed deadline stays passed: days over, never 'today'", () => {
  expect(caseChip(item({ daysLeft: -3, deadline: "2026-11-21" }))).toEqual({ tone: "bad", text: "3 days over" });
  expect(caseChip(item({ daysLeft: 0 }))).toEqual({ tone: "warn", text: "Due today" });
  expect(caseChip(item({ daysLeft: 1 }))).toEqual({ tone: "warn", text: "1 day left" });
  expect(caseChip(item({ daysLeft: 20, contactAttempts: 1 }))).toEqual({ tone: "info", text: "Called 1×" });
  expect(caseChip(item({ daysLeft: 20, status: "waiting_on_carrier" }))).toEqual({ tone: "info", text: "Waiting on carrier" });
  expect(caseChip(item({ daysLeft: null, deadline: null }))).toEqual({ tone: "neutral", text: "Not started" });
});

test("cases group by how soon they are lost, past due first; lost and paperwork stay off the worked list", () => {
  const cases = [item({ id: "a", daysLeft: 20 }), item({ id: "b", daysLeft: -1 }), item({ id: "c", daysLeft: 3 }), item({ id: "d", step: "paperwork", daysLeft: null }), item({ id: "e", step: "lost" })];
  const groups = groupCases(casesOn(cases, null));
  expect(groups.map((g) => [g.key, g.cases.map((c) => c.id)])).toEqual([["over", ["b"]], ["week", ["c"]], ["month", ["a"]]]);
  expect(casesOn(cases, "paperwork").map((c) => c.id)).toEqual(["d"]);
  expect(casesOn(cases, null, "omaha").length).toBe(5);
  expect(stepCounts(cases)).toMatchObject({ pending_lapse: 3, pendingThisWeek: 1, paperwork: 1 });
});

test("call today skips a case already waiting on the carrier", () => {
  const due = callToday([item({ id: "a", daysLeft: 3, status: "waiting_on_carrier" }), item({ id: "b", daysLeft: 5 }), item({ id: "c", daysLeft: -2 })]);
  expect(due.map((c) => c.id)).toEqual(["c", "b"]);
});

test("the save rate is a percentage only over ten decided cases", () => {
  expect(saveRate({ saved: 23, lost: 18 })).toMatchObject({ decided: 41, label: "56%" });
  expect(saveRate({ saved: 3, lost: 2 })).toMatchObject({ decided: 5, label: "3/5" });
  expect(saveRate({ saved: 0, lost: 0 }).label).toBe("–");
});

test("the deadline card keeps the real date and says how far past it is", () => {
  expect(deadlineCard(detail())).toMatchObject({ label: "Lost on", big: "Thu 26 Nov", line: "2 days left · grace ends at the carrier", ring: "2d" });
  expect(deadlineCard(detail({ deadline: "2026-11-20", daysLeft: -4 }))).toMatchObject({ big: "Fri 20 Nov", line: "4 days over · ask the carrier where it stands", pct: 100, ring: "Over" });
  expect(deadlineCard(detail({ deadline: null, daysLeft: null }))).toMatchObject({ big: "No carrier window" });
  expect(deadlineCard(detail({ step: "paperwork", deadline: null, daysLeft: null }))).toBeNull();
});

test("the steps tick off from the case: a logged call, then a change sent to the carrier", () => {
  const fresh = caseSteps(detail({ reason: "bounced_draft", step: "payment_problem" }));
  // Board F4's four steps for a payment that didn't clear.
  expect(fresh.map((s) => [s.title, s.done])).toEqual([
    ["Call Ruth and find a draft date that clears", false], ["Take a new bank or a new date", false],
    ["Send the change to Mutual of Omaha", false], ["Wait for the next file to show it paid", false],
  ]);
  expect(fresh[2].sub).toBe("Their service line or the agent portal");
  // Another reason keeps its own plan.
  expect(caseSteps(detail({ reason: "mailed_bill", step: "paperwork" }))[0].title).toBe("Call before the next bill is due");
  const worked = caseSteps(detail({ calls: [{ at: "2026-11-23T15:00:00Z", outcome: "no_answer", did: null, note: null, by: "Jo" }], status: "waiting_on_carrier" }));
  expect(worked[0]).toMatchObject({ done: true, sub: "Called 23 Nov · no answer" });
  expect(worked[1].done).toBe(true);
});

test("what was done follows the outcome", () => {
  expect(actionsFor("no_answer")).toEqual(["none"]);
  expect(actionsFor("reached_refused")).toEqual(["none", "review_coverage", "courtesy_call"]);
  expect(actionsFor("reached_agreed")).not.toContain("none");
});

const request = (over: Partial<WaitingRequest> = {}): WaitingRequest => ({
  id: "r1", caseId: null, clientName: "Mae Thompson", carrierName: "Royal Neighbors", policyNumber: "RN-1", type: "draft_date_change", status: "submitted",
  createdAt: "2026-11-19T12:00:00Z", submittedAt: "2026-11-19T12:00:00Z", expectedEffectiveDate: null, verifiedAt: null, verifiedSnapshotDate: null,
  checkedSnapshotDate: null, unprovable: false, ...over,
});

test("a sent change waits, then needs a check once its date passes or the carrier says done", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  expect(bucketOf(request(), "2026-11-24")).toBe("waiting");
  expect(waitingChip(request(), "2026-11-24", now)).toEqual({ tone: "info", text: "5 days" });
  expect(waitingChip(request({ expectedEffectiveDate: "2026-11-20" }), "2026-11-24", now)).toEqual({ tone: "warn", text: "5 days, check" });
  expect(waitingChip(request({ status: "draft", submittedAt: null }), "2026-11-24", now).text).toBe("Not sent yet");
  expect(waitingChip(request({ status: "verified_in_file", caseId: "c1" }), "2026-11-24", now)).toEqual({ tone: "ok", text: "Saved" });
  expect(waitingMeta(request(), now)).toBe("New draft date · sent to Royal Neighbors 19 Nov");
});

const person = (over: Partial<WinbackPerson> = {}): WinbackPerson => ({
  id: "w1", clientName: "Vernon Hayes", carrierName: "Transamerica", policyNumber: "TA-1", lapsedOn: "2026-06-10", category: "affordability", band: "fair",
  eligibleFrom: "2026-10-01", releasedAt: "2026-10-02T00:00:00Z", leadId: "lead-1", blockedReason: null, ...over,
});

test("win-back: ready first, then stuck, then the cooling-off ones with their month", () => {
  const today = "2026-11-25";
  const rows = [person({ id: "a", releasedAt: null, leadId: null, eligibleFrom: "2026-12-10" }), person({ id: "b" }), person({ id: "c", releasedAt: null, leadId: null, blockedReason: "No phone on file" })];
  expect(winbackOrder(rows, today).map((r) => r.id)).toEqual(["b", "c", "a"]);
  expect(winbackStage(rows[0], today)).toBe("soon");
  expect(winbackChip(rows[0], today)).toEqual({ tone: "info", text: "Try in Dec" });
  expect(winbackChip(rows[1], today)).toEqual({ tone: "ok", text: "Ready" });
});

test("F3 · the board's two groups: lost this week (past the date too), then this month with the rest after; a Try again day waits its turn", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  const cases = [
    item({ id: "a", daysLeft: 20 }), item({ id: "b", daysLeft: -1 }), item({ id: "c", daysLeft: 3 }), item({ id: "d", daysLeft: null, deadline: null }),
    item({ id: "e", daysLeft: 2, nextAttemptAt: "2026-11-26T15:00:00Z" }), item({ id: "f", daysLeft: 60 }),
  ];
  expect(boardGroups(cases, now).map((g) => [g.key, g.cases.map((c) => c.id)])).toEqual([["week", ["b", "c", "e"]], ["month", ["a", "d", "f"]]]);
  // A Try again day is the chip once the countdown isn't the news.
  expect(caseChip(item({ daysLeft: 20, contactAttempts: 1, nextAttemptAt: "2026-11-27T15:00:00Z" }), now).text).toMatch(/^Try (Thu|Fri) 2[67] Nov$/);
  expect(caseChip(item({ daysLeft: 20, contactAttempts: 1, nextAttemptAt: "2026-11-20T15:00:00Z" }), now).text).toBe("Called 1×");
});

test("F5 · five outcomes, each filed as one of the server's; the carrier call is a reached one that says so", () => {
  expect(OUTCOMES.map((o) => o.label)).toEqual(["Reached them", "No answer", "Left voicemail", "Wrong number", "They’ll call the carrier"]);
  expect(OUTCOMES.map((o) => o.outcome)).toEqual(["reached_agreed", "no_answer", "voicemail", "wrong_number", "reached_agreed"]);
  expect(OUTCOMES.find((o) => o.key === "client_calls")?.clientCallsCarrier).toBe(true);
});

test("F3d · five reasons, filed under the server's three, with the board's word leading the note", () => {
  expect(PERSON_REASONS.map((r) => r.label)).toEqual(["Changed banks", "Can’t afford it", "Moved", "Wants to cancel", "Beneficiary change"]);
  expect(new Set(PERSON_REASONS.map((r) => r.reason))).toEqual(new Set(["payment_date_change", "cancellation_request", "pending_manual_action"]));
  expect(openingNote("changed_banks", " New account at Navy Federal ")).toBe("Changed banks: New account at Navy Federal");
  expect(openingNote("moved", "")).toBe("Moved");
});

test("F3b · a reinstatement waits as paid; a proved row names what the file showed; only this week's proofs show", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  expect(waitingMeta(request({ type: "reinstatement", submittedAt: "2026-11-16T12:00:00Z" }), now)).toBe("Reinstatement paid · Royal Neighbors 16 Nov");
  expect(waitingMeta(request({ status: "verified_in_file", verifiedAt: "2026-11-21T09:00:00Z", verifiedSnapshotDate: "2026-11-21" }), now)).toBe("Draft cleared · Royal Neighbors file 21 Nov");
  const { proven } = waitingGroups([request({ id: "new", status: "verified_in_file", verifiedAt: "2026-11-21T09:00:00Z" }), request({ id: "old", status: "verified_in_file", verifiedAt: "2026-11-10T09:00:00Z" })], "2026-11-24", now);
  expect(proven.map((r) => r.id)).toEqual(["new"]);
});

test("F3c · stuck reads Can't write; a dialed lead says how many calls and the last outcome", () => {
  const today = "2026-11-25";
  expect(winbackChip(person({ releasedAt: null, leadId: null, blockedReason: "moved to OR, not licensed" }), today)).toEqual({ tone: "neutral", text: "Can’t write" });
  expect(winbackMeta(person({ lapsedOn: "2026-03-02", calls: { count: 2, lastDisposition: "no_answer" } }))).toBe("Lapsed Mar · called 2× · no answer");
  expect(winbackMeta(person())).toBe("Lapsed Jun · price");
});