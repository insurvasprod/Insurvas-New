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
  // 20260929201000 restates it (federal holidays in the state check, minutes, a Sunday window).
  assert.match(latest.name, /^(20260924230100|20260929201000)_/);
  const body = functionBody(latest, "tenant_can_dial_now");
  assert.match(body, /if public\.calling_window_rules_stale\(now\(\)\) then return false; end if;/);
  // Fail closed: no stamp at all is stale. The stamp and its triggers live where they were made.
  const feed = latestDefining(/create or replace function public\.calling_window_rules_stale/);
  assert.match(functionBody(feed, "calling_window_rules_stale"), /true\s*\)/);
  // Any write to the rules stamps the feed — the editor's writes included.
  assert.match(feed.body, /after insert or update or delete on public\.calling_window_state_rules/);
  assert.match(feed.body, /after insert or update or delete on public\.calling_window_holidays/);
});

test("a state rule that bars holidays bars the federal calendar too, and the campaign is read with the tenant's id", () => {
  // User decision 2026-09-29 (LA-2.4-3): the federal rows are stored with state_code NULL, and NULL
  // is never IN a list, so the old state check skipped them — Florida dialled on Thanksgiving.
  const file = latestDefining(/create or replace function public\.tenant_can_dial_now/);
  const body = functionBody(file, "tenant_can_dial_now");
  assert.match(body, /v_rule\.no_holidays and exists \([\s\S]*?\(h\.state_code is null or h\.state_code in \('\*', upper\(p_state\)\)\)\s*\)/);
  assert.doesNotMatch(body, /v_rule\.no_holidays and exists \([^)]*where h\.holiday_date = v_local::date\s+and h\.state_code in/);
  // Minutes and the state's own Sunday window.
  assert.match(body, /v_dow = 0 and v_rule\.sunday_start_minute is not null/);
  assert.match(body, /coalesce\(v_rule\.start_minute, v_rule\.start_hour \* 60\)/);
  // The agency switch still reads the federal calendar.
  assert.match(body, /v_options\.no_federal_holidays and exists \([\s\S]*?h\.state_code is null/);
  assert.match(body, /v_local timestamp;/);
  assert.match(body, /where id = p_campaign_id and tenant_id = p_tenant_id/);
  // The explainer carries the same predicate, and the migration checks the two agree over a
  // Thanksgiving week.
  const explain = functionBody(latestDefining(/create or replace function public\.tenant_dial_window/), "tenant_dial_window");
  assert.match(explain, /\(h\.state_code is null or h\.state_code in \('\*', upper\(p_state\)\)\)/);
  assert.match(file.body, /timestamptz '2026-11-22 00:00:00\+00'/);
  assert.match(file.body, /tenant_dial_window disagrees with tenant_can_dial_now/);
});

test("the dialer says the feed is stale rather than 'outside the window'", () => {
  const dialer = readFileSync(join(root, "lib", "dialerScripts", "service.ts"), "utf8");
  assert.match(dialer, /staleRulesReason\(\)/);
  const service = readFileSync(join(root, "lib", "callingWindow", "service.ts"), "utf8");
  assert.match(service, /rpc\("calling_window_rules_freshness"/);
  assert.match(service, /A stale feed refuses the dial rather than guessing/);
});
