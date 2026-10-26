import test from "node:test";
import assert from "node:assert/strict";

import { funnelMap, pathMap, roleMapKey, setterMap, worstDrop } from "./roleFlow.ts";

const view = {
  empty: false,
  stages: [
    { key: "served", label: "Leads served", count: 100, value: "100", note: "$1,000 spent" },
    { key: "dialed", label: "Dialled", count: 80, value: "80", note: "$12.50 each" },
    { key: "contacts", label: "Reached", count: 20, value: "20", note: "$50.00 each" },
    { key: "applications", label: "Applications", count: 6, value: "6", note: "$167 each" },
  ],
  drops: [
    { from: 0, lost: 20, kept: 0.8, text: "−20 never dialled" },
    { from: 1, lost: 60, kept: 0.25, text: "−60 not reached" },
    { from: 2, lost: 14, kept: 0.3, text: "−14 no application" },
  ],
  leak: { drop: 1, percent: "25%", from: "Dialled", to: "Reached", lost: 60, lostAs: "not reached", lostSpendCents: 60000, topAgent: { name: "Jordan", count: 12 } },
  spendCents: 100000,
  annualisedCents: 1440000,
  deals: 4,
  costPerApplicationCents: 16667,
};

test("the agency title picks the map: a manager is not an owner, an admin is", () => {
  assert.equal(roleMapKey("owner", "manager"), "manager");
  assert.equal(roleMapKey("producer", "admin"), "owner");
  assert.equal(roleMapKey("owner", null), "owner");
  assert.equal(roleMapKey("setter", "setter"), "setter");
});

test("the owner's map ends in premium and carries costs; the manager's carries no money at all", () => {
  const owner = funnelMap("owner", view, "/app/deal-flow", "today");
  assert.equal(owner.stages.at(-1).label, "Premium written");
  assert.equal(owner.stages.at(-1).value, "$14,400");
  assert.equal(owner.stages[1].note, "$12.50 each");
  assert.equal(owner.lead.rows[0].value, "$600");

  const manager = funnelMap("manager", view, "/app/deal-flow", "today");
  const text = JSON.stringify(manager);
  assert.equal(manager.stages.at(-1).label, "Deals");
  assert.ok(!text.includes("$"), `a manager's map shows no money: ${text}`);
  assert.equal(manager.worst, 1);
});

test("a producer's map is their own: premium yes, another agent's name no", () => {
  const producer = funnelMap("producer", view, "/app/deal-flow", "today");
  assert.equal(producer.stages.at(-1).label, "Your premium");
  assert.ok(!JSON.stringify(producer.lead).includes("Jordan"));
});

test("the setter's leak is the step that keeps the smallest share", () => {
  const map = setterMap({ dials: 200, reached: 50, booked: 10, showed: 7 }, { dialer: "/app/dialer", activity: "/app/activity", calendar: "/app/calendar" });
  assert.equal(map.worst, 1); // reached → booked keeps 20%
  assert.equal(map.lead.big, "20%");
  assert.equal(worstDrop([{ label: "a", value: "3", count: 3 }, { label: "b", value: "0", count: 0 }]), null); // under five is no finding
});

test("a path lights the first urgent stop, leaves out what the person cannot open, and never peels", () => {
  const map = pathMap("Your day", [
    { label: "Inbox", href: "/app/inbound", figure: "0", count: 0, urgent: false, note: "", next: "then" },
    { label: "Callbacks", href: "/app/callbacks", figure: "7", count: 7, urgent: true, note: "", next: "then" },
    { label: "Assign", href: null, figure: null, count: 0, urgent: false, note: "", next: "" },
  ]);
  assert.deepEqual(map.stages.map((stage) => stage.label), ["Inbox", "Callbacks"]);
  assert.equal(map.hot, 1);
  assert.equal(map.lead.cta.href, "/app/callbacks");
  assert.ok(map.drops.every((drop) => drop.lost === 0));
});
