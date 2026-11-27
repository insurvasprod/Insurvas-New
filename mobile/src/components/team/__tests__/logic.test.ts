import {
  agencyPlacement, callbackOutcome, change, checkVerdict, comparisonName, complaintLog, consentChip, countdownChip, funnelSteps, keepRate, keptWeeks,
  licenceLines, missedThisWeek, periodOf, previousPeriod, qualityRows, rankFigure, rankProducers, rateText, renewalChip, seesMoney, splitComplaints,
  vaultAppointments, wholeMoney, teamPicks, goalPassedOn, persistencyCard, leadFunnelSteps, historyLine, ownLicenceLines,
} from "../logic";
import type { CallbackItem, Complaint, ProducerScore, QualityRow } from "../types";

const score = (over: Partial<ProducerScore>): ProducerScore => ({
  producerUserId: "u", name: "Ava Kim", submitted: 0, issued: 0, placed: 0, placement: "—", m4: { text: "—" }, chargebackCents: 0, chargebacks: 0, issuedAnnualCents: 0, ...over,
});

test("money is the owner's and the bookkeeper's; a manager runs people, not money", () => {
  expect(seesMoney({ role: "owner", memberRole: "owner" })).toBe(true);
  expect(seesMoney({ role: "owner", memberRole: "admin" })).toBe(true);
  expect(seesMoney({ role: "bookkeeper", memberRole: "bookkeeper" })).toBe(true);
  expect(seesMoney({ role: "producer", memberRole: "manager" })).toBe(false);
  expect(seesMoney({ role: "producer", memberRole: "producer" })).toBe(false);
  expect(seesMoney(null)).toBe(false);
});

test("figures are whole dollars, never cents", () => {
  expect(wholeMoney(1_492_049)).toBe("$14,920");
  expect(wholeMoney(-6_200)).toBe("−$62");
  expect(wholeMoney(null)).toBe("—");
});

test("periods are calendar weeks, months, quarters and years, and each change names what it is against", () => {
  const at = new Date(2026, 10, 25); // Wed 25 Nov 2026
  expect(periodOf("month", at)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  expect(periodOf("week", at)).toEqual({ from: "2026-11-23", to: "2026-11-29" });
  expect(periodOf("quarter", at)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  expect(previousPeriod("month", new Date(2026, 0, 10))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  expect(comparisonName("month", at)).toBe("October");
  expect(comparisonName("week", at)).toBe("last week");
  expect(change(142, 124)).toEqual({ arrow: "↑", text: "18" });
  expect(change(11.4, 13.5, 1)).toEqual({ arrow: "↓", text: "2.1" });
  expect(change(5, 5).arrow).toBeNull();
});

test("I1 · the team ranks by issued premium (or a count), highest first, and search narrows it", () => {
  const rows = [score({ producerUserId: "a", name: "Tom Baker", issuedAnnualCents: 504_000, issued: 9 }), score({ producerUserId: "b", name: "Ava Kim", issuedAnnualCents: 1_492_000, issued: 4 })];
  expect(rankProducers(rows, "premium").map((r) => r.name)).toEqual(["Ava Kim", "Tom Baker"]);
  expect(rankProducers(rows, "issued").map((r) => r.name)).toEqual(["Tom Baker", "Ava Kim"]);
  expect(rankProducers(rows, "premium", "tom").map((r) => r.name)).toEqual(["Tom Baker"]);
  expect(rankFigure(rows[1], "premium")).toBe("$14,920");
  expect(rankFigure(rows[1], "issued")).toBe("4 issued");
  expect(rankProducers([score({ name: "A", placement: "2/3" }), score({ name: "B", placement: "82%" })], "placement").map((r) => r.name)).toEqual(["B", "A"]);
  expect(agencyPlacement([score({ issued: 8, placed: 6 }), score({ issued: 4, placed: 2 })], 10)).toBe("67%");
  expect(agencyPlacement([score({ issued: 3, placed: 2 })], 10)).toBe("2/3");
});

test("I4 · the funnel runs from the quote, each step a share of the quoted", () => {
  const steps = funnelSteps({ quoted: 402, applied: { n: 142, d: 402 }, submitted: { n: 140, d: 142 }, issued: { n: 96, d: 140 } });
  expect(steps.map((s) => [s.label, s.count, s.pct])).toEqual([["Quoted", 402, null], ["Applied", 142, 35.3], ["Submitted", 140, 34.8], ["Issued", 96, 23.9]]);
});

const cb = (over: Partial<CallbackItem>): CallbackItem => ({ id: "c", leadId: "l", customerName: "Maria Alvarez", scheduledAtUtc: new Date().toISOString(), assignedTo: "u", assigneeName: "Jordan Reyes", status: "scheduled", completedVia: null, missedAt: null, ...over });

test("I4d · kept is completed, missed is missed (or stamped missed); the rate waits for five decided", () => {
  expect(callbackOutcome({ status: "completed", missedAt: "x" })).toBe("kept");
  expect(callbackOutcome({ status: "scheduled", missedAt: "x" })).toBe("missed");
  expect(callbackOutcome({ status: "cancelled", missedAt: null })).toBe("cancelled");
  const now = new Date(2026, 10, 25, 15);
  const thisWeek = new Date(2026, 10, 24, 10).toISOString();
  const lastWeek = new Date(2026, 10, 17, 10).toISOString();
  const items = [cb({ id: "1", status: "completed", scheduledAtUtc: thisWeek }), cb({ id: "2", status: "missed", scheduledAtUtc: thisWeek }), cb({ id: "3", status: "completed", scheduledAtUtc: lastWeek })];
  const weeks = keptWeeks(items, now);
  expect(weeks).toHaveLength(8);
  expect(weeks[7]).toMatchObject({ label: "This wk", kept: 1, missed: 1, rate: 50 });
  expect(weeks[6]).toMatchObject({ kept: 1, missed: 0, rate: 100 });
  expect(keepRate(weeks)).toEqual({ rate: null, kept: 2, decided: 3 });
  expect(missedThisWeek(items, now).map((c) => c.id)).toEqual(["2"]);
});

test("I4c · a save rate over 10 decided is a percent, under it the counts", () => {
  expect(rateText({ saved: 3, lost: 2, rate: null })).toBe("3 of 5 saved");
  expect(rateText({ saved: 23, lost: 18, rate: 23 / 41 })).toBe("56%");
  expect(rateText({ saved: 0, lost: 0, rate: null })).toBe("—");
});

test("I4e · best partner first; Best only with enough leads, Many returns when a tenth came back", () => {
  const q = (over: Partial<QualityRow>): QualityRow => ({ partner_id: "p", partner_name: "P", sent: 0, worked: 0, submitted: 0, disqualified: 0, disqualification_rate: null, previous: { sent: 0, submitted: 0 }, ...over });
  const out = qualityRows([q({ partner_id: "a", sent: 412, submitted: 41 }), q({ partner_id: "b", sent: 62, submitted: 9, disqualified: 2 }), q({ partner_id: "c", sent: 140, submitted: 5, disqualified: 19 }), q({ partner_id: "d" })]);
  expect(out.map((r) => [r.row.partner_id, r.per100, r.chip?.text ?? null])).toEqual([["b", 14.5, "Best"], ["a", 10, null], ["c", 3.6, "Many returns"]]);
});

test("I5 · a refusal is Don't call, an unanswered vendor is Can't confirm, a pass is Clear", () => {
  const checks = [{ key: "dnc", label: "National Do Not Call list", result: "Listed", tone: "error" as const, source: "Vendor", age: "live", refuses: true }];
  expect(checkVerdict({ code: "dnc_listed", error: "This number is on a DNC list.", checks }, 422)).toMatchObject({ title: "Don’t call this number", chip: { tone: "bad", text: "Blocked" } });
  expect(checkVerdict({ code: "dnc_unverified", checks }, 503).chip.text).toBe("Not verified");
  expect(checkVerdict({ ok: true, checks: [] }, 200).title).toBe("Clear to call");
});

test("I5b · only a claimed certificate is consent on file", () => {
  expect(consentChip("claimed")).toEqual({ tone: "ok", text: "Consent on file" });
  expect(consentChip("pending").tone).toBe("info");
});

const complaint = (over: Partial<Complaint>): Complaint => ({
  id: "x", channel: "doi", regulatorState: "TX", receivedAt: "2026-11-20T15:00:00Z", receivedVia: "email", complainantName: "Vernon Hayes", phoneDigits: null, policyNumber: null,
  category: "billing", summary: "Charged after cancelling", responseDueAt: "2026-11-26T15:00:00Z", respondedAt: null, responseText: null, status: "open", owner: { id: "o", name: "Tom Baker" },
  dncAddedAt: null, resolvedAt: null, notes: null, aboutAgent: null, countdown: { tone: "red", daysLeft: 2, label: "2 days left" }, ...over,
});

test("I6 · open complaints soonest deadline first, no deadline last; the countdown's chip", () => {
  const list = [complaint({ id: "a", countdown: { tone: "calm", daysLeft: 12, label: "" } }), complaint({ id: "b" }), complaint({ id: "c", countdown: { tone: "no_deadline", daysLeft: null, label: "" } }), complaint({ id: "d", status: "resolved", resolvedAt: "2026-11-14T00:00:00Z" })];
  const { open, closed } = splitComplaints(list);
  expect(open.map((c) => c.id)).toEqual(["b", "a", "c"]);
  expect(closed.map((c) => c.id)).toEqual(["d"]);
  expect(countdownChip({ tone: "red", daysLeft: 2, label: "" })).toEqual({ tone: "warn", text: "2 days left" });
  expect(countdownChip({ tone: "calm", daysLeft: 12, label: "" })).toEqual({ tone: "info", text: "12 days left" });
  expect(countdownChip({ tone: "overdue", daysLeft: -3, label: "Overdue by 3 days" })).toEqual({ tone: "bad", text: "3 days late" });
});

test("I6b · the log is built from the record's own facts, oldest first", () => {
  const log = complaintLog(complaint({ respondedAt: "2026-11-21T10:00:00Z", responseText: "Refund asked from carrier", dncAddedAt: "2026-11-20T16:00:00Z" }));
  expect(log.map((e) => e.key)).toEqual(["in", "dnc", "reply"]);
  expect(log[2].meta).toContain("Refund asked from carrier");
});

test("I7 · licences soonest renewal first with their chip; appointments grouped by carrier", () => {
  const now = new Date(2026, 10, 24);
  const vault = {
    carriers: [{ id: "m", name: "Mutual of Omaha" }, { id: "c", name: "Corebridge" }],
    licenses: [{ id: "1", state: "FL", expires_at: "2027-08-01", licence_type: "non_resident" as const }, { id: "2", state: "TX", expires_at: "2026-12-09", licence_type: "resident" as const }],
    appointments: [
      { id: "a1", carrier_id: "m", state: "TX", status: "active" as const, effective_from: "2026-01-01" },
      { id: "a2", carrier_id: "m", state: "FL", status: "active" as const, effective_from: "2026-01-01" },
      { id: "a3", carrier_id: "c", state: "TX", status: "pending" as const, effective_from: "2026-11-12" },
      { id: "a4", carrier_id: "c", state: "GA", status: "pending" as const, effective_from: "2026-11-12" },
    ],
  };
  const lines = licenceLines(vault, now);
  expect(lines.map((l) => [l.title, l.meta, l.chip.text])).toEqual([["Texas", "Resident · renews 9 Dec", "15 days"], ["Florida", "Non-resident · renews Aug 2027", "Active"]]);
  expect(renewalChip("2026-11-01", now)).toEqual({ tone: "bad", text: "Expired" });
  expect(vaultAppointments(vault).map((a) => [a.title, a.meta, a.chip.text])).toEqual([["Corebridge", "Sent 12 Nov · TX, GA", "Pending"], ["Mutual of Omaha", "2 states", "Appointed"]]);
});

test("teams are a manager and the producers who report to him", () => {
  const picks = teamPicks([
    { id: "p1", userId: "u1", displayName: "ava kim", status: "active", role: null, hiredOn: null, managerProducerId: null },
    { id: "p2", userId: "u2", displayName: "Tom Baker", status: "active", role: null, hiredOn: null, managerProducerId: "p1" },
    { id: "p3", userId: "u3", displayName: "Nia Watts", status: "active", role: null, hiredOn: null, managerProducerId: "gone" },
  ]);
  expect(picks.map((t) => t.label)).toEqual(["Ava’s team"]);
  expect([...picks[0].members].sort()).toEqual(["u1", "u2"]);
  expect(teamPicks([])).toEqual([]);
});

test("the goal is passed on the day the running total of issued premium reaches it", () => {
  expect(goalPassedOn([["2026-11-19", 800], ["2026-11-05", 600]], 1_300)).toBe("2026-11-19");
  expect(goalPassedOn([["2026-11-05", 600]], 1_300)).toBeNull();
  expect(goalPassedOn(undefined, 1_300)).toBeNull();
  expect(goalPassedOn([["2026-11-05", 600]], null)).toBeNull();
});

test("13-month persistency: the book's rate, each quarter's as the sparkline, the newest against the one before", () => {
  const cell = (rate: number | null) => [{ month: 13, eligible: 10, alive: 8, rate }];
  const card = persistencyCard({ policies: 30, overall: cell(0.84), byCohort: [{ key: "q3", label: "", policies: 10, cells: cell(0.86) }, { key: "q2", label: "", policies: 10, cells: cell(0.82) }, { key: "q1", label: "", policies: 10, cells: cell(null) }] });
  expect(card.rate).toBe(0.84);
  expect(card.quarters).toEqual([82, 86]);
  expect(card.change).toEqual({ arrow: "↑", text: "4" });
  expect(persistencyCard({ policies: 0, overall: [], byCohort: [] })).toMatchObject({ rate: null, quarters: [], change: null });
});

test("from lead to policy: each step a share of the leads, one decimal under 10%", () => {
  const steps = leadFunnelSteps({ leads_received: 4212, contacted_leads: 1604, quoted_leads: 402, applied_leads: 142, applications: 150, issued_policies: 96 });
  expect(steps.map((s) => [s.key, s.count, s.pct])).toEqual([["received", 4212, null], ["contacted", 1604, 38], ["quoted", 402, 9.5], ["applied", 142, 3.4], ["issued", 96, 2.3]]);
  // Before the scorecard's update there is no quoted count, and applications stand in for applied leads.
  expect(leadFunnelSteps({ leads_received: 10, contacted_leads: 5, quoted_leads: null, applied_leads: null, applications: 2, issued_policies: 1 }).map((s) => s.label)).toEqual(["Leads", "Contacted", "Applied", "Issued"]);
});

test("a complaint's history reads as who did what, and when", () => {
  const at = new Date(2026, 10, 25);
  expect(historyLine({ at: "2026-11-20T10:00:00Z", by: "Dana Ellery", action: "opened", fields: [] }, at)).toMatchObject({ title: "Recorded", meta: "Dana · 20 Nov" });
  expect(historyLine({ at: "2026-11-21T10:00:00Z", by: null, action: "updated", fields: ["owner_user_id", "notes"] }, at)).toMatchObject({ title: "Reassigned", meta: "Someone · 21 Nov" });
  expect(historyLine({ at: "2026-11-21T10:00:00Z", by: "Tom", action: "updated", fields: ["response_text", "responded_at", "status"] }, at).title).toBe("Reply logged");
  expect(historyLine({ at: "2026-11-21T10:00:00Z", by: "Tom", action: "updated", fields: ["status"] }, at).title).toBe("Changed status");
  expect(historyLine({ at: "2026-11-22T10:00:00Z", by: "Tom", action: "deadline_set", fields: [] }, at).title).toBe("Regulator deadline set");
});

test("your own licences, soonest renewal first; a state with no date says so", () => {
  const at = new Date(2026, 10, 25);
  const lines = ownLicenceLines([{ state: "GA", expiresOn: null }, { state: "TX", expiresOn: "2026-12-09" }], at);
  expect(lines.map((l) => [l.title, l.meta, l.chip.text])).toEqual([["Texas", "Renews 9 Dec", "14 days"], ["Georgia", "No renewal date recorded", "Licensed"]]);
});
