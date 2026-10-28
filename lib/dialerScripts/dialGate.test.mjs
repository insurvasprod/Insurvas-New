import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { campaignDialRefusal, storedLitigatorRefusal } from "./dialGate.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const gate = (campaign, extra = {}) => campaignDialRefusal({ campaignId: "c1", campaign, readFailed: false, ...extra });

test("a dial passes the campaign gate only when the campaign is active and scrubbed", () => {
  assert.equal(gate({ status: "active", scrubStatus: "scrubbed" }), null);
  for (const scrubStatus of ["unscrubbed", "scrubbing", "failed", null]) {
    assert.equal(gate({ status: "active", scrubStatus })?.reason, "campaign_not_servable", String(scrubStatus));
  }
  for (const status of ["paused", "draft", "exhausted"]) {
    const refusal = gate({ status, scrubStatus: "scrubbed" });
    assert.equal(refusal?.reason, "campaign_not_servable");
    assert.match(refusal.message, new RegExp(status));
  }
});

test("the campaign gate fails closed: unreadable is 'could not tell', missing is refused", () => {
  assert.equal(gate(null, { readFailed: true })?.reason, "policy_unavailable");
  assert.equal(gate(null)?.reason, "campaign_not_servable");
  // A lead with no campaign (partner intake, manual add) was screened per number at entry.
  assert.equal(campaignDialRefusal({ campaignId: null, campaign: null, readFailed: false }), null);
});

test("the import's stored litigator answers refuse the dial; an unreadable ledger is never clear", () => {
  assert.equal(storedLitigatorRefusal({ leadScreeningOutcome: "tcpa_litigator", ledgerListed: false })?.reason, "litigator_listed");
  assert.equal(storedLitigatorRefusal({ leadScreeningOutcome: "clear", ledgerListed: true })?.reason, "litigator_listed");
  assert.equal(storedLitigatorRefusal({ leadScreeningOutcome: null, ledgerListed: null })?.reason, "policy_unavailable");
  assert.equal(storedLitigatorRefusal({ leadScreeningOutcome: "dnc", ledgerListed: false }), null);
  assert.equal(storedLitigatorRefusal({ leadScreeningOutcome: null, ledgerListed: false }), null);
});

test("a return call skips the claim, never the gates: startDialAttempt runs eligibility before the inbound waiver", () => {
  const service = read("lib/dialerScripts/service.ts");
  const start = service.slice(service.indexOf("export async function startDialAttempt"), service.indexOf("export async function confirmDisclosure"));
  // Eligibility (window, licence, campaign scrub/paused, stored lists, litigator) is not conditional on inbound.
  assert.match(start, /getDialerEligibility\(db, input\.tenantId, \(lead\.data\.values \?\? \{\}\) as Row, text\(lead\.data\.campaign_id\) \|\| null, input\.agentId, input\.leadId\)/);
  assert.ok(start.indexOf("if (!eligibility.allowed) throw") < start.indexOf("!input.inbound"));
  assert.doesNotMatch(start.slice(start.indexOf("}) {"), start.indexOf("if (!eligibility.allowed) throw")), /inbound/);
  // The eligibility function applies both new gates, in our own tables.
  const eligibility = service.slice(service.indexOf("async function getDialerEligibility"), service.indexOf("async function readDncExemption"));
  assert.match(eligibility, /campaignDialRefusal\(/);
  assert.match(eligibility, /storedLitigatorRefusal\(/);
  assert.doesNotMatch(eligibility, /getDncDialingStatus|performDnc/);
});

test("the dialer screen has one dial door: no tel: link outside the gated dial()", () => {
  for (const file of ["components/app/dialer-workspace.tsx", "components/app/dialer/lead-column.tsx"]) {
    assert.doesNotMatch(read(file), /tel:/, `${file} renders a tel: link that bypasses the gates`);
  }
  const hook = read("components/app/dialer/use-dialer.ts");
  const telAt = hook.indexOf("tel:");
  assert.equal(hook.indexOf("tel:", telAt + 1), -1, "exactly one tel: handoff");
  const dial = hook.slice(hook.indexOf("async function dial("), hook.indexOf("function choose("));
  assert.ok(dial.includes("tel:"), "the handoff lives in dial()");
  assert.ok(dial.indexOf("/click") < dial.indexOf("tel:"), "the click gate answers before the handoff");
  assert.match(dial, /if \(!response\.ok\) throw/);
});
