import {
  appsToday, chargebacks, chartLabels, chartMax, complaintsChip, complaintsDue, dayKey, depositsShort, dollars, floorCounts, floorRows,
  lateCarriers, leaders, licencesExpiring, monthRange, perHundred, premiumMonth, prevMonth, setupGroups, toApprove, unitPrice, vendorCampaigns,
} from "../logic";
import type { AppRow, FloorMember, ProducerScore, ScoreCampaign, TodoItem } from "../types";

/** Noon on a day of this phone's calendar, so a day never slips across midnight in the test's zone. */
const at = (day: string, hour = 12) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour).toISOString();
const app = (over: Partial<AppRow>): AppRow => ({ applicationId: "a", caseId: "c", status: "submitted", outcome: null, monthlyPremiumCents: 5000, submittedAt: null, closedAt: null, updatedAt: at("2026-11-01"), ...over });

test("submitted premium runs day by day against the same days of last month, monthly × 12", () => {
  const apps = [
    app({ submittedAt: at("2026-11-01"), monthlyPremiumCents: 5000 }),
    app({ submittedAt: at("2026-11-03"), monthlyPremiumCents: 10000, outcome: "issued", closedAt: at("2026-11-04") }),
    app({ submittedAt: at("2026-10-02"), monthlyPremiumCents: 2500 }),
    app({ submittedAt: at("2026-10-20"), monthlyPremiumCents: 9999 }),
  ];
  const m = premiumMonth(apps, "2026-11-03");
  expect(m.series).toEqual([60000, 60000, 180000]);
  expect(m.before).toEqual([0, 30000, 30000]);
  expect(m.totalCents).toBe(180000);
  expect(m.change).toBe(500);
  expect(m.issued).toEqual({ count: 1, cents: 120000 });
  expect(m.placement).toEqual({ pct: 50, issued: 1, submitted: 2 });
  expect(m.previous).toBe("2026-10");
});

test("a month longer than the one before holds last month's total for the extra days", () => {
  const m = premiumMonth([app({ submittedAt: at("2026-02-28"), monthlyPremiumCents: 100 })], "2026-03-31");
  expect(m.before).toHaveLength(31);
  expect(m.before[30]).toBe(1200);
  expect(m.change).toBe(-100);
});

test("the chart scale and day labels follow the board's lines()", () => {
  expect(chartMax([8_642_000], [6_700_000])).toBe(90);
  expect(chartMax([0], [0])).toBe(10);
  expect(chartLabels(16).filter(Boolean)).toEqual(["1", "8", "16"]);
  expect(chartLabels(2)).toEqual(["1", "2"]);
});

const score = (over: Partial<ProducerScore>): ProducerScore => ({ producerUserId: "u", producerId: null, name: "X", submitted: 0, issued: 0, placement: "", chargebackCents: 0, ...over });

test("producers rank by policies issued, each bar against the leader; chargebacks count producers", () => {
  const rows = [score({ producerUserId: "b", name: "JORDAN REYES", issued: 3, submitted: 5 }), score({ producerUserId: "a", name: "Ava Kim", issued: 4, chargebackCents: -21400 }), score({ producerUserId: "c", name: "Sam Lee", issued: 3, submitted: 9, chargebackCents: -1000 })];
  expect(leaders(rows).map((r) => [r.rank, r.name, r.share])).toEqual([[1, "Ava Kim", 100], [2, "Sam Lee", 75], [3, "Jordan Reyes", 75]]);
  expect(chargebacks(rows)).toEqual({ cents: 22400, producers: 2 });
});

test("licences expiring name the soonest state and day; complaints say the late and the nearest", () => {
  expect(licencesExpiring([
    { producerUserId: "a", name: "A", item: "Appointment", detail: "Aetna · TX", expiresOn: "2026-12-01", daysLeft: 6 },
    { producerUserId: "b", name: "B", item: "Licence", detail: "State licence · TX", expiresOn: "2026-12-09", daysLeft: 14 },
  ])).toEqual({ count: 1, soonest: "TX · 9 Dec" });
  const c = (daysLeft: number | null, respondedAt: string | null = null) => ({ id: "x", status: "open", respondedAt, resolvedAt: null, countdown: { tone: "amber", daysLeft, label: "" } });
  const due = complaintsDue([c(2), c(9), c(-1, "2026-11-01"), c(null)]);
  expect(due).toEqual({ count: 2, overdue: 0, nearest: 2 });
  expect(complaintsChip(due)).toBe("1 in 2 days");
  expect(complaintsChip({ overdue: 2, nearest: 1 })).toBe("2 overdue");
  expect(complaintsChip({ overdue: 0, nearest: 20 })).toBeNull();
});

const item = (over: Partial<TodoItem>): TodoItem => ({ key: "k", group: "bills", what: "w", detail: "d", amountCents: 1000, since: null, yours: true, href: "/app/x", ...over });

test("the books: what waits on you and its money, short carrier money, late files", () => {
  const items = [item({ amountCents: 1153600 }), item({ key: "2", yours: false, amountCents: 5000 }), item({ key: "3", group: "bank", tone: "bad", amountCents: 21400 }), item({ key: "4", group: "bank", amountCents: 900 })];
  expect(toApprove(items)).toEqual({ count: 3, cents: 1153600 + 21400 + 900 });
  expect(depositsShort(items)).toEqual({ count: 1, cents: 21400 });
  expect(lateCarriers([{ id: "1", carrierId: "a", carrierName: "Corebridge", due: "", daysLate: 4 }, { id: "2", carrierId: "b", carrierName: "RN", due: "", daysLate: 2 }, { id: "3", carrierId: "c", carrierName: "Aetna", due: "", daysLate: 1 }])).toBe("Corebridge, RN +1");
  expect(dollars(12140000)).toBe("$121,400");
  expect(dollars(-21400)).toBe("−$214");
  expect(unitPrice(2800)).toBe("$28.00");
  expect(unitPrice(38.15)).toBe("$0.38");
});

const member = (over: Partial<FloorMember>): FloorMember => ({ id: "m", name: "Ava Kim", role: "producer", availability: "off", away: false, lastSeenAt: null, statusChangedAt: null, call: null, lastCall: null, ...over });

test("the floor: on a call first with its clock, then ready, then away; the viewer is left out", () => {
  const now = Date.parse("2026-11-25T17:00:00Z");
  const members = [
    member({ id: "me", name: "Dana Ellery", availability: "ready" }),
    member({ id: "t", name: "Tom Baker", availability: "off", statusChangedAt: "2026-11-25T16:20:00Z" }),
    member({ id: "s", name: "Sam Lee", availability: "ready", statusChangedAt: "2026-11-25T16:57:00Z" }),
    member({ id: "a", name: "Ava Kim", availability: "on_call", call: { workItemId: "w", leadId: "l", customer: "LINDA OKAFOR", partnerName: null, startedAt: "2026-11-25T16:53:48Z" } }),
  ];
  const rows = floorRows(members, "me", now);
  expect(rows.map((r) => [r.name, r.chip.label])).toEqual([["Ava Kim", "On a call"], ["Sam Lee", "Ready"], ["Tom Baker", "Away"]]);
  expect(rows[0].meta).toBe("On a call · 6:12 · Linda Okafor");
  expect(rows[1].meta).toBe("Waiting for a transfer · 3 min");
  expect(rows[2].meta).toMatch(/^Not taking calls since \d{1,2}:20$/);
  expect(floorCounts(members, "me")).toEqual({ onCall: 1, taking: 2, people: 3 });
});

test("a call the server never closed (days long) says when it began, not a 128-hour clock", () => {
  const now = Date.parse("2026-11-25T17:00:00Z");
  const rows = floorRows([member({ id: "d", name: "Demo Producer", availability: "on_call", call: { workItemId: "w", leadId: "l", customer: "Dana Whitfield", partnerName: null, startedAt: "2026-11-20T12:09:17Z" } })], null, now);
  expect(rows[0].meta).toMatch(/^On a call · since 20 Nov · Dana Whitfield$/);
});

test("applications today against the same weekday last week", () => {
  const apps = [app({ submittedAt: at("2026-11-24") }), app({ submittedAt: at("2026-11-24", 9) }), app({ submittedAt: at("2026-11-17") }), app({ submittedAt: at("2026-11-23") })];
  expect(appsToday(apps, "2026-11-24")).toEqual({ today: 2, lastWeek: 1, weekday: "Tue" });
});

test("setup counts the steps that make you ready; optional ones wait for later", () => {
  const s = (key: string, complete: boolean, optional = false) => ({ key, label: key, path: "/app/x", action: "", why: "", complete, optional });
  const g = setupGroups([s("carriers", true), s("team", false), s("import", false), s("queue-sla", false, true), s("phone", true, true)]);
  expect([g.done, g.required]).toEqual([1, 3]);
  expect(g.next.map((x) => x.key)).toEqual(["team", "import"]);
  expect(g.later.map((x) => x.key)).toEqual(["queue-sla"]);
  expect(g.doneSteps.map((x) => x.key)).toEqual(["carriers", "phone"]);
});

const camp = (over: Partial<ScoreCampaign>): ScoreCampaign => ({ campaign_id: "c", vendor_id: "v", campaign_name: "C", leads_received: 10, issued_policies: 1, cost_per_record_cents: 2800, effective_cost_per_issued_policy_cents: 24000, contact_rate_percent: 38, cost_rank: null, ...over });

test("a vendor's campaigns: those with leads this month, the report's costliest marked only among two ranked", () => {
  const out = vendorCampaigns([camp({ campaign_id: "a", leads_received: 180, cost_rank: 1 }), camp({ campaign_id: "b", leads_received: 100, cost_rank: 3 }), camp({ campaign_id: "c", leads_received: 132, cost_rank: 2 }), camp({ campaign_id: "d", leads_received: 0 })]);
  expect(out.rows.map((r) => r.campaign_id)).toEqual(["a", "c", "b"]);
  expect(out.costliest).toBe("b");
  expect(vendorCampaigns([camp({ cost_rank: 1 })]).costliest).toBeNull();
  expect(perHundred(41, 412)).toBe("10 per 100");
  expect(perHundred(1, 0)).toBeNull();
  expect(monthRange("2026-11", "2026-11-25")).toEqual({ from: "2026-11-01", to: "2026-11-25" });
  expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  expect(prevMonth("2026-01")).toBe("2025-12");
  expect(dayKey(new Date(2026, 0, 5, 23))).toBe("2026-01-05");
});
