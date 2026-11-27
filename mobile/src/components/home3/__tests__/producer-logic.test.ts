import { docsNeeded, goalCard, moneyDelta, pctDelta, weekSpan, workingDaysLeft, type ProducerBookAnswer } from "../producer-logic";

/** Board B1's rules, as the producer's Home reads them. */
const book = (days: ProducerBookAnswer["issued"]["days"], money = true): ProducerBookAnswer => ({ today: "2026-11-24", money, available: true, issued: { since: "2026-10-01", days }, paymentMissed: { count: 0, saveBy: null } });

test("a week runs Monday to today, against the same days of last week", () => {
  expect(weekSpan("2026-11-24")).toEqual({ from: "2026-11-23", to: "2026-11-24", lastFrom: "2026-11-16", lastTo: "2026-11-17" });
  // A Sunday is the end of the week that began on the Monday before.
  expect(weekSpan("2026-11-29")).toEqual({ from: "2026-11-23", to: "2026-11-29", lastFrom: "2026-11-16", lastTo: "2026-11-22" });
  expect(weekSpan("2026-11-23").from).toBe("2026-11-23");
});

test("working days left count today and stop at the month's end", () => {
  expect(workingDaysLeft("2026-11-24")).toBe(5);
  expect(workingDaysLeft("2026-11-28")).toBe(1);
  expect(workingDaysLeft("2026-11-30")).toBe(1);
});

test("deltas: nothing last week is no comparison; a fall is never gold", () => {
  expect(pctDelta({ now: 5, before: 0 })).toBeNull();
  expect(pctDelta({ now: 90, before: 100 })).toEqual({ strong: "↓ 10%", good: false });
  expect(moneyDelta({ now: 0, before: 0 })).toBeNull();
  expect(moneyDelta({ now: 10000, before: 74000 })).toEqual({ strong: "↓ $640", good: false });
});

test("the goal ring: the stored goal, else last month's issued premium, else nothing to measure", () => {
  const days = [{ day: "2026-10-12", count: 2, cents: 900000 }, { day: "2026-11-03", count: 1, cents: 450000 }];
  expect(goalCard(book(days), { goal: { state: "set", target: 1200000 } }, "2026-11-24")).toEqual({ title: "November goal", line: "$4,500 of $12,000 issued annual premium · 5 working days left", pct: 38, label: "38%" });
  expect(goalCard(book(days), { goal: { state: "none" } }, "2026-11-24")).toEqual({ title: "November goal", line: "$4,500 of $9,000 issued last month · no goal set · 5 working days left", pct: 50, label: "50%" });
  expect(goalCard(book([days[1]]), null, "2026-11-24")?.label).toBe("—");
  // Without money, counts only.
  expect(goalCard(book(days.map((d) => ({ ...d, cents: null })), false), null, "2026-11-24")?.line).toBe("1 policy of 2 policies issued last month · no goal set · 5 working days left");
});

test("a case needs a doc: open, not the carrier's to do, oldest first, in the tile's short words", () => {
  const req = (id: string, kind: string, extra = {}) => ({ id, applicationId: "a", caseId: "c", clientName: "X", carrierName: "Corebridge", kind, description: "", waitingOn: "client", status: "open", raisedAt: "2026-11-01", dueAt: null, daysOpen: 1, ageing: "ok", ...extra }) as never;
  expect(docsNeeded([req("1", "phone_interview"), req("2", "aps", { waitingOn: "carrier" }), req("3", "aps", { status: "satisfied" })])).toEqual({ count: 0, detail: null });
  expect(docsNeeded([req("1", "missing_info", { daysOpen: 2, carrierName: "Mutual" }), req("2", "aps", { daysOpen: 9 })])).toEqual({ count: 2, detail: "Corebridge · APS" });
});
