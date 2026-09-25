// Run with: npm test
//
// Campaigns concept audit (LA-2 §5): the campaign comparison says when the two periods ran different
// cadences, from tenant_cadence_versions (20260925706200). History exists only from the migration's
// baseline on, and before that the answer is "not known", never "same".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cadenceCaveat, effectiveCadenceAt, periodCadence } from "./history.ts";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const baseline = { campaignId: null, ruleCount: 6, fingerprint: "default-1", savedAt: "2026-09-25T12:00:00Z", source: "baseline" };
const a = { campaignId: A, name: "DataLeads Aug", from: "2026-10-01", to: "2026-10-30" };
const b = { campaignId: B, name: "Q3 FEX", from: "2026-10-01", to: "2026-10-30" };

test("a campaign with no rules of its own runs the tenant default; with rules, only its own", () => {
  const versions = [baseline, { campaignId: A, ruleCount: 4, fingerprint: "own-a", savedAt: "2026-09-26T00:00:00Z", source: "save" }];
  assert.equal(effectiveCadenceAt(versions, B, Date.parse("2026-10-02T00:00:00Z")).kind, "default");
  assert.equal(effectiveCadenceAt(versions, A, Date.parse("2026-10-02T00:00:00Z")).fingerprint, "own-a");
  // Clearing a campaign's rules puts it back on the default.
  const cleared = [...versions, { campaignId: A, ruleCount: 0, fingerprint: "empty", savedAt: "2026-09-27T00:00:00Z", source: "save" }];
  assert.equal(effectiveCadenceAt(cleared, A, Date.parse("2026-10-02T00:00:00Z")).kind, "default");
  // A tenant default with no rules is the built-in cadence.
  assert.equal(effectiveCadenceAt([{ ...baseline, ruleCount: 0, fingerprint: "none" }], A, Date.parse("2026-10-02T00:00:00Z")).kind, "builtin");
});

test("two campaigns on different cadences get the board's caveat", () => {
  const versions = [baseline, { campaignId: A, ruleCount: 7, fingerprint: "front-loaded", savedAt: "2026-09-26T00:00:00Z", source: "save" }];
  const caveat = cadenceCaveat(versions, a, b);
  assert.equal(caveat.status, "different");
  assert.match(caveat.message, /compares two things at once/);
  assert.match(caveat.message, /DataLeads Aug ran its own cadence \(7 rules/);
  assert.match(caveat.message, /Q3 FEX ran the agency default \(6 rules/);
});

test("the same cadence is said to be the same", () => {
  assert.equal(cadenceCaveat([baseline], a, b).status, "same");
});

test("a change inside a period is called out", () => {
  const versions = [baseline, { campaignId: null, ruleCount: 5, fingerprint: "default-2", savedAt: "2026-10-15T09:00:00Z", source: "save" }];
  const period = periodCadence(versions, a);
  assert.equal(period.cadences.length, 2);
  assert.equal(cadenceCaveat(versions, a, b).status, "changed");
});

test("before history began the answer is unknown, never same", () => {
  const early = { ...a, from: "2026-09-01", to: "2026-09-30" };
  const caveat = cadenceCaveat([baseline], early, b);
  assert.equal(caveat.status, "unknown");
  assert.match(caveat.message, /Cadence history starts/);
});

test("without the versions table the comparison says history is not recorded", () => {
  const caveat = cadenceCaveat(null, a, b);
  assert.equal(caveat.status, "pending");
  assert.match(caveat.message, /not recorded yet/);
});

test("replace_cadence_rules writes a version and keeps the refusals the screen depends on", () => {
  const body = readFileSync(join(process.cwd(), "supabase", "migrations", "20260925706200_cadence_versions.sql"), "utf8");
  assert.match(body, /drop function if exists public\.replace_cadence_rules\(uuid, uuid, jsonb\)/);
  assert.match(body, /insert into tenant_cadence_versions/);
  assert.match(body, /raise exception 'CADENCE_TENANT_REQUIRED'/);
  assert.match(body, /raise exception 'CADENCE_CAMPAIGN_NOT_FOUND'/);
  assert.match(body, /grant execute on function public\.replace_cadence_rules\(uuid, uuid, jsonb, uuid\) to service_role/);
  // The save passes who saved it, and falls back to the three-argument call before the migration.
  const service = readFileSync(join(process.cwd(), "lib", "cadence", "service.ts"), "utf8");
  assert.match(service, /p_saved_by/);
  assert.match(service, /rpc\("replace_cadence_rules", args\)/);
});
