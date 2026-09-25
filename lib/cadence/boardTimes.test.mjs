// Run with: npm test
//
// Settings › Dialing cadence (20260924230300). The board offers "opposite half of the day",
// "morning" and "evening"; the scheduler used to know only six fixed slots, stopped after the sixth
// dial while the board said seven, merged a campaign cadence with the tenant default while the
// board said they are never merged, and saved by delete-then-insert across two requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DAY_PARTS, PREFERRED_TIMES, SLOTS, dayPartHours, firstPreferredMinute, isDayPart } from "./engine.ts";

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
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

test("the board's three times of day are storable preferences, beside the six slots", () => {
  assert.deepEqual([...DAY_PARTS], ["opposite_half", "morning", "evening"]);
  for (const value of [...DAY_PARTS, ...SLOTS]) assert.ok(PREFERRED_TIMES.includes(value));
  assert.equal(isDayPart("morning"), true);
  assert.equal(isDayPart("late_morning"), false);
  assert.equal(isDayPart(null), false);
});

test("opposite half is opposite to the previous dial", () => {
  assert.deepEqual(dayPartHours("opposite_half", 10), { from: 12, to: 24 });
  assert.deepEqual(dayPartHours("opposite_half", 15), { from: 0, to: 12 });
  assert.deepEqual(dayPartHours("morning", 15), { from: 0, to: 12 });
  assert.deepEqual(dayPartHours("evening", 9), { from: 17, to: 24 });
});

test("a preference waits for the first legal quarter hour inside it, never outside the window", () => {
  const window = { start: 8 * 60, end: 20 * 60 };
  // Dialled at 10:00, 4-hour floor → 14:00. Opposite half of a morning dial is the afternoon: 14:00.
  assert.equal(firstPreferredMinute({ part: "opposite_half", lastLocalHour: 10, floorMinute: 14 * 60, window }), 14 * 60);
  // Evening from a 14:00 floor → 17:00 the same day.
  assert.equal(firstPreferredMinute({ part: "evening", lastLocalHour: 14, floorMinute: 14 * 60, window }), 17 * 60);
  // Morning from a 14:00 floor → 08:00 the next day (the window opens at 8, not midnight).
  assert.equal(firstPreferredMinute({ part: "morning", lastLocalHour: 14, floorMinute: 14 * 60, window }), 1440 + 8 * 60);
  // A floor at 14:07 lands on the next quarter hour inside the part, 17:00 for evening.
  assert.equal(firstPreferredMinute({ part: "evening", lastLocalHour: 14, floorMinute: 14 * 60 + 7, window }), 17 * 60);
});

test("a window that never reaches the preference falls back instead of never calling", () => {
  // A 9–5 agency asking for evening: nothing in eight days, so the scheduler rotates instead.
  const window = { start: 9 * 60, end: 17 * 60 };
  assert.equal(firstPreferredMinute({ part: "evening", lastLocalHour: 10, floorMinute: 10 * 60, window }), null);
});

test("the scheduler honours the day parts, dials seven times and never merges a campaign cadence", () => {
  const latest = latestDefining(/create or replace function public\.schedule_next_attempt/);
  assert.ok(latest);
  // 20260925706600 restates it to read a recycled lead's per-pass ceiling; nothing else changes.
  assert.match(latest.name, /^(20260924230300|20260925706600)_/);
  // The function body only: the file's comments and assertions name the old forms on purpose.
  const start = latest.body.indexOf("create or replace function public.schedule_next_attempt");
  const scheduler = { body: latest.body.slice(start, latest.body.indexOf("$function$;", start)) };
  assert.match(scheduler.body, /v_preferred in \('morning', 'evening', 'opposite_half'\)/);
  // Preference chooses inside the window: every candidate instant is asked of the legal window.
  assert.match(scheduler.body, /tenant_can_dial_now\(p_tenant_id, v_state, v_campaign, v_t\)/);
  assert.match(scheduler.body, /if v_made >= v_ceiling then/);
  assert.doesNotMatch(scheduler.body, /v_made >= v_ceiling - 1/);
  assert.doesNotMatch(scheduler.body, /r\.campaign_id = v_campaign or r\.campaign_id is null/);
  // The rotation fixes of 20260917144000 survive.
  assert.match(scheduler.body, /order by max\(ca\.attempted_at\) asc/);
  assert.match(scheduler.body, /and ca\.slot is not null/);
});

test("a save is one transaction, scoped to the tenant's own campaign", () => {
  const replace = latestDefining(/create or replace function public\.replace_cadence_rules/);
  assert.ok(replace, "replace_cadence_rules is missing — the save is two requests again");
  assert.match(replace.body, /CADENCE_CAMPAIGN_NOT_FOUND/);
  assert.match(replace.body, /c\.tenant_id = p_tenant_id/);
  assert.match(replace.body, /pg_advisory_xact_lock/);
  // 20260925706200 added p_saved_by (the cadence version's author), so the grant names four types.
  assert.match(replace.body, /grant execute on function public\.replace_cadence_rules\(uuid, uuid, jsonb(, uuid)?\) to service_role/);
  assert.match(replace.body, /CADENCE_TENANT_REQUIRED/);

  const service = read("lib", "cadence", "service.ts");
  assert.match(service, /rpc\("replace_cadence_rules"/);
  // A day part is refused before the legacy delete, never halfway through it.
  assert.ok(service.indexOf("CadenceSchemaPendingError()") < service.indexOf(".delete()"));

  const route = read("app", "api", "app", "cadence", "route.ts");
  assert.match(route, /campaignBelongsToTenant\(auth\.context\.tenantId/);
  assert.match(route, /campaign_not_found/);
});
