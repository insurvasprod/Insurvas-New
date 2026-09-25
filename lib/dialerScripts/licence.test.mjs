import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decideDialLicence, leadStateBeforeServe } from "./licence.ts";

const today = "2026-09-24";
const az = { state: "AZ", expires_at: "2026-12-04" };
const decide = (overrides) => decideDialLicence({ role: "producer", state: "AZ", agencyLicences: [az], agentStates: [], today, ...overrides });

test("a setter books only, so the dialer never asks for a licence", () => {
  assert.deepEqual(decide({ role: "setter", agencyLicences: [], state: "TX" }), { allowed: true, basis: "setter" });
});

test("an owner or producer needs an unexpired agency licence in the lead's state", () => {
  assert.equal(decide({}).allowed, true);
  assert.equal(decide({ state: "tx" }).reason, "agency_unlicensed");
  assert.equal(decide({ agencyLicences: [{ state: "AZ", expires_at: "2026-09-23" }] }).reason, "agency_expired");
  assert.equal(decide({ agencyLicences: [{ state: "AZ", expires_at: "2026-09-24" }] }).allowed, true, "valid through its expiry day");
  assert.equal(decide({ state: "" }).reason, "no_state");
});

test("recorded personal states narrow it; none recorded judges on the agency", () => {
  assert.deepEqual(decide({ agentStates: [] }), { allowed: true, basis: "agency" });
  assert.deepEqual(decide({ agentStates: ["AZ", "NV"] }), { allowed: true, basis: "agent" });
  const refused = decide({ agentStates: ["NV"] });
  assert.equal(refused.reason, "agent_unlicensed");
  assert.match(refused.message, /not licensed in AZ/);
});

test("before per-agent states can be recorded, the refusal says the agency's licences were checked", () => {
  assert.deepEqual(decide({ agentStates: null }), { allowed: true, basis: "agency" });
  assert.match(decide({ agentStates: null, state: "TX" }).message, /agency's licences are what is checked/);
});

test("roles that never dial are refused", () => {
  assert.equal(decide({ role: "assistant" }).reason, "role");
  assert.equal(decide({ role: null }).reason, "role");
});

test("a refused lead goes back in the state its serve tier implies", () => {
  assert.equal(leadStateBeforeServe(4), "retry");
  assert.equal(leadStateBeforeServe(5), "fresh");
  assert.equal(leadStateBeforeServe(6), "nurture");
  assert.equal(leadStateBeforeServe(2), null);
});

test("the dialer checks the licence before it serves, starts or dials a call", () => {
  const service = readFileSync(join(process.cwd(), "lib", "dialerScripts", "service.ts"), "utf8");
  // Every eligibility read is given the agent, so the licence gate runs on the panel, the attempt and the click.
  const calls = [...service.matchAll(/getDialerEligibility\(db, [^;]*\)/g)].map((match) => match[0]);
  assert.ok(calls.length >= 3, "expected the panel, attempt and click to read eligibility");
  for (const call of calls) assert.match(call, /agentId\)/, `eligibility read without the agent: ${call}`);
  assert.match(service, /licenceFor\(licence, state\)/, "serveNextLead must check the served lead's state");
  const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "20260924220200_dialer_serves_only_licensed_states.sql"), "utf8");
  assert.match(migration, /agent_may_work_state\(p_tenant_id, p_agent_user_id, l\.values->>''state''\)/);
});
