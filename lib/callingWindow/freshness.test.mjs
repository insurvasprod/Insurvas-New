// Run with: npm test
//
// Settings › Calling windows (20260924230100, and 20260924121000 as revised before it was applied).
// The board says "Last refreshed …. A stale feed refuses the dial rather than guessing", and lists
// the states the agency works in — federal-hours states included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { statesToList } from "./engine.ts";

const root = process.cwd();
const MIGRATIONS = join(root, "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}
function functionBody(file, name) {
  const start = file.body.indexOf(`create or replace function public.${name}(`);
  return file.body.slice(start, file.body.indexOf("$function$;", start));
}

const RULES = [
  { state: "AZ", startHour: 8, endHour: 20, noSunday: false, noHolidays: true },
  { state: "FL", startHour: 8, endHour: 20, noSunday: true, noHolidays: true },
  { state: "TX", startHour: 8, endHour: 21, noSunday: false, noHolidays: true },
];
const bites = (rule) => rule.endHour < 21 || rule.noSunday;

test("the states an agency works are listed even when their law is the federal window", () => {
  const { rules, basis } = statesToList(RULES, ["tx", "AZ", "NV"], bites);
  assert.equal(basis, "worked");
  assert.deepEqual(rules.map((rule) => rule.state), ["AZ", "NV", "TX"]);
  // A worked state with no rule in force is shown at the federal hours, not dropped.
  assert.deepEqual(rules.find((rule) => rule.state === "NV"), { state: "NV", startHour: 8, endHour: 21, noSunday: false, noHolidays: false });
});

test("with no worked states known, only the states whose rule bites are listed", () => {
  const { rules, basis } = statesToList(RULES, [], bites);
  assert.equal(basis, "notable");
  assert.deepEqual(rules.map((rule) => rule.state), ["AZ", "FL"]);
  assert.equal(statesToList(RULES, null, bites).basis, "notable");
});

test("a stale rules feed refuses the dial in the one function every dial path asks", () => {
  const latest = latestDefining(/create or replace function public\.tenant_can_dial_now/);
  assert.ok(latest);
  assert.match(latest.name, /^20260924230100_/);
  const body = functionBody(latest, "tenant_can_dial_now");
  assert.match(body, /if public\.calling_window_rules_stale\(now\(\)\) then return false; end if;/);
  // Fail closed: no stamp at all is stale.
  assert.match(functionBody(latest, "calling_window_rules_stale"), /true\s*\)/);
  // Any write to the rules stamps the feed.
  assert.match(latest.body, /after insert or update or delete on public\.calling_window_state_rules/);
  assert.match(latest.body, /after insert or update or delete on public\.calling_window_holidays/);
});

test("federal holidays are the agency switch's, and the campaign is read with the tenant's id", () => {
  // 20260924121000 is applied live, so the corrections live in the latest definition.
  {
    const file = latestDefining(/create or replace function public\.tenant_can_dial_now/);
    const body = functionBody(file, "tenant_can_dial_now");
    // The state rule reads that state's own holidays, not the NULL-coded federal calendar.
    assert.match(body, /v_rule\.no_holidays and exists \([\s\S]*?h\.state_code in \('\*', upper\(p_state\)\)\s*\)/);
    assert.doesNotMatch(body, /h\.state_code is null or h\.state_code in/);
    // The agency switch still reads the federal calendar.
    assert.match(body, /v_options\.no_federal_holidays and exists \([\s\S]*?h\.state_code is null/);
    assert.match(body, /v_local timestamp;/);
    assert.match(body, /where id = p_campaign_id and tenant_id = p_tenant_id/);
  }
});

test("the dialer says the feed is stale rather than 'outside the window'", () => {
  const dialer = readFileSync(join(root, "lib", "dialerScripts", "service.ts"), "utf8");
  assert.match(dialer, /staleRulesReason\(\)/);
  const service = readFileSync(join(root, "lib", "callingWindow", "service.ts"), "utf8");
  assert.match(service, /rpc\("calling_window_rules_freshness"/);
  assert.match(service, /A stale feed refuses the dial rather than guessing/);
});
