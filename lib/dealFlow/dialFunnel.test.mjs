import assert from "node:assert/strict";
import test from "node:test";

import { buildDialFunnel, isContactDisposition } from "./dialFunnel.ts";

const agents = [
  { id: "ray", name: "Ray A.", role: "producer" },
  { id: "dana", name: "Dana K.", role: "producer" },
  { id: "haxhi", name: "Haxhi A.", role: "setter" },
];
const noCosts = { leadCost: new Map(), campaignPerRecord: new Map() };

test("contact rule mirrors is_contact_disposition", () => {
  assert.equal(isContactDisposition("voicemail"), false);
  assert.equal(isContactDisposition("wrong_number"), false);
  assert.equal(isContactDisposition(null), false);
  assert.equal(isContactDisposition("application_submitted"), true);
  assert.equal(isContactDisposition("callback"), true);
});

test("steps count distinct leads and convert to the next known step", () => {
  const funnel = buildDialFunnel({
    served: [
      { lead_id: "a", agent_user_id: "ray", campaign_id: "c1" },
      { lead_id: "b", agent_user_id: "ray", campaign_id: "c1" },
      { lead_id: "c", agent_user_id: "dana", campaign_id: "c1" },
      { lead_id: "d", agent_user_id: "dana", campaign_id: "c1" },
    ],
    attempts: [
      { lead_id: "a", agent_id: "ray", dial_clicked_at: "t", disposition: "no_answer" },
      { lead_id: "a", agent_id: "ray", dial_clicked_at: "t", disposition: "application_submitted" },
      { lead_id: "b", agent_id: "ray", dial_clicked_at: "t", disposition: "voicemail" },
      { lead_id: "c", agent_id: "dana", dial_clicked_at: null, disposition: "not_interested" },
    ],
    applications: [{ lead_id: "a", opened_by: "ray" }],
    quoted: null,
    deals: [{ monthly_premium_cents: 8333 }, { monthly_premium_cents: null }],
    agents,
    costs: noCosts,
  });
  const byKey = Object.fromEntries(funnel.steps.map((step) => [step.key, step]));
  assert.equal(byKey.served.count, 4);
  assert.equal(byKey.dialed.count, 2);
  assert.equal(byKey.served.toNext, 0.5);
  // c's outcome was logged without a dial; it is still a contact by the outcome, as the SQL rule reads.
  assert.equal(byKey.contacts.count, 2);
  // Quoted is unknown (no stage), so Contacts converts straight to Applications.
  assert.equal(byKey.quoted.count, null);
  assert.equal(byKey.contacts.toNext, 0.5);
  assert.equal(byKey.applications.count, 1);
  assert.equal(funnel.quotedStageExists, false);
  assert.equal(funnel.annualisedCents, 8333 * 12);
  assert.equal(funnel.unpricedDeals, 1);

  const ray = funnel.agents.find((agent) => agent.id === "ray");
  assert.deepEqual([ray.dials, ray.contacts, ray.applications, ray.servedNeverDialed, ray.zeroClick], [3, 1, 1, 0, 0]);
  const dana = funnel.agents.find((agent) => agent.id === "dana");
  assert.deepEqual([dana.dials, dana.servedNeverDialed, dana.zeroClick, dana.contactRate], [0, 2, 1, null]);

  assert.equal(funnel.leak.servedNeverDialed, 2);
  assert.equal(funnel.leak.share, 0.5);
  assert.equal(funnel.leak.top.name, "Dana K.");
  assert.equal(funnel.leak.top.alsoMostZeroClick, true);
});

test("spend counts each served lead once, preferring its own cost over the campaign's", () => {
  const funnel = buildDialFunnel({
    served: [
      { lead_id: "a", agent_user_id: "ray", campaign_id: "c1" },
      { lead_id: "a", agent_user_id: "ray", campaign_id: "c1" },
      { lead_id: "b", agent_user_id: "ray", campaign_id: "c1" },
      { lead_id: "e", agent_user_id: "ray", campaign_id: null },
    ],
    attempts: [],
    applications: [],
    quoted: [],
    deals: [],
    agents,
    costs: { leadCost: new Map([["a:c1", 45]]), campaignPerRecord: new Map([["c1", 30]]) },
  });
  assert.equal(funnel.spendCents, 45 + 30);
  assert.equal(funnel.servedWithCost, 2);
  assert.equal(funnel.quotedStageExists, true);
  assert.equal(funnel.steps.find((step) => step.key === "quoted").count, 0);
});

test("no costs recorded reads as null, not zero; an empty day has no leak", () => {
  const funnel = buildDialFunnel({ served: [], attempts: [], applications: [], quoted: null, deals: [], agents, costs: noCosts });
  assert.equal(funnel.spendCents, null);
  assert.equal(funnel.leak.servedNeverDialed, 0);
  assert.equal(funnel.leak.share, null);
  assert.equal(funnel.leak.top, null);
  assert.equal(funnel.steps[0].toNext, null);
});
