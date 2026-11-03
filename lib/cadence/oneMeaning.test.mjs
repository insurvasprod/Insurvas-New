// Run with: npm test
//
// LA-2.7-3 / LA-2.7-8 (20260929201100). "Rule N" has ONE meaning — the wait before dial N, counted
// from dial N-1 — in the scheduler, the ladder, DEFAULT_CADENCE and the lead record. The built-in
// ladder is the spec's +2h, +1d, +1d, +2d (weekend), +3d, +5d. Max attempts is a setting per tenant
// with a campaign override, and a recycled lead's own ceiling still wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_CADENCE, DEFAULT_CEILING, MAX_ATTEMPTS_RANGE, attemptsWithin, effectiveCeiling, parseInterval, scheduleNextAttempt } from "./engine.ts";

const root = process.cwd();
const MIGRATIONS = join(root, "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
function latestBody(name) {
  for (let index = files.length - 1; index >= 0; index--) {
    const text = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    const start = text.indexOf(`create or replace function public.${name}(`);
    if (start === -1) continue;
    return { file: files[index], body: text.slice(start, text.indexOf("$function$;", start)) };
  }
  return null;
}
const HOUR = 3_600_000;

test("the built-in table starts at attempt 2: attempt 1 is the first dial and has no wait", () => {
  assert.deepEqual(DEFAULT_CADENCE.map((row) => row.attemptNumber), [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(DEFAULT_CADENCE.map((row) => row.delayInterval), ["2 hours", "1 day", "1 day", "2 days", "3 days", "5 days"]);
  assert.deepEqual(DEFAULT_CADENCE.map((row) => row.preferredSlot ?? null), [null, null, null, "weekend", null, null]);
});

test("the scheduler's built-in fallback is exactly DEFAULT_CADENCE, in the same numbering", () => {
  const scheduler = latestBody("schedule_next_attempt");
  assert.ok(scheduler);
  assert.match(scheduler.file, /^20260929201100_/);
  const fallback = scheduler.body.slice(scheduler.body.indexOf("if v_delay is null then"));
  const cases = [...fallback.slice(0, fallback.indexOf("end case") > 0 ? fallback.indexOf("end case") : fallback.indexOf("    end;")).matchAll(/when (\d+) then interval '([^']+)'/g)]
    .map((match) => ({ attemptNumber: Number(match[1]), delayInterval: match[2] }));
  // Attempts 2 to 6 by name, and the last row (attempt 7) is the `else` every later attempt shares.
  assert.deepEqual(cases, DEFAULT_CADENCE.slice(0, -1).map(({ attemptNumber, delayInterval }) => ({ attemptNumber, delayInterval })));
  assert.equal(DEFAULT_CADENCE.at(-1).attemptNumber, 7);
  assert.match(fallback, new RegExp(`else interval '${DEFAULT_CADENCE.at(-1).delayInterval}'`));
  assert.match(fallback, /if v_next = 5 then v_preferred := 'weekend'; end if;/);
  assert.doesNotMatch(scheduler.body, /when 1 then interval/, "an attempt-1 row the scheduler never reads is back");
  // The lookup that gives "rule N" its meaning.
  assert.match(scheduler.body, /v_next := v_made \+ 1;/);
  assert.match(scheduler.body, /r\.attempt_number = v_next/);
});

test("the engine and the scheduler walk the same default ladder: 0, 2h, 26h, 50h, 98h, 170h, 290h", () => {
  let at = 0;
  const offsets = [0];
  for (let made = 1; made < DEFAULT_CEILING; made += 1) {
    const next = scheduleNextAttempt({ attemptsMade: made, triedSlots: [], now: new Date(at) });
    assert.equal(next.exhausted, false);
    assert.equal(next.attemptNumber, made + 1);
    at = next.dueAt.getTime();
    offsets.push(at / HOUR);
  }
  assert.deepEqual(offsets, [0, 2, 26, 50, 98, 170, 290]);
  assert.equal(scheduleNextAttempt({ attemptsMade: DEFAULT_CEILING, triedSlots: [], now: new Date(0) }).exhausted, true);
  // The spec's table lands four of seven inside 72 hours (the criterion's "five" is a population
  // target, decision 2): the arithmetic is asserted as it is.
  assert.equal(attemptsWithin(72), 4);
  for (const row of DEFAULT_CADENCE) assert.ok(parseInterval(row.delayInterval).ok);
});

test("the ladder and the lead record read DEFAULT_CADENCE by attempt number, the scheduler's way", () => {
  const ladder = read("lib", "cadence", "ladder.ts");
  assert.match(ladder, /DEFAULT_CADENCE\.find\(\(entry\) => entry\.attemptNumber === attempt\)/);
  const record = read("lib", "leadWorkspace", "record.ts");
  assert.match(record, /DEFAULT_CADENCE\.find\(\(entry\) => entry\.attemptNumber === attempt\)/);
  // The record shows rung N as "<delay> after #N-1", which is the same meaning.
  assert.match(read("components", "app", "lead-record-tabs.tsx"), /\$\{rung\.delay\} after #\$\{rung\.attempt - 1\}/);
});

test("max attempts: lead recycle ceiling > campaign > tenant > seven", () => {
  assert.equal(effectiveCeiling({}), 7);
  assert.equal(effectiveCeiling({ tenant: 9 }), 9);
  assert.equal(effectiveCeiling({ tenant: 9, campaign: 4 }), 4);
  assert.equal(effectiveCeiling({ tenant: 9, campaign: 4, leadCeiling: 3 }), 3);
  assert.equal(scheduleNextAttempt({ attemptsMade: 3, triedSlots: [], ceiling: 3, now: new Date(0) }).exhausted, true);
  assert.equal(scheduleNextAttempt({ attemptsMade: 8, triedSlots: [], ceiling: 9, now: new Date(0) }).exhausted, false);

  const scheduler = latestBody("schedule_next_attempt").body;
  const setting = scheduler.indexOf("v_ceiling := coalesce(public.cadence_max_attempts(p_tenant_id, v_campaign), v_ceiling);");
  const lead = scheduler.indexOf("v_ceiling := coalesce(v_lead_ceiling, v_ceiling);");
  assert.ok(setting > 0 && lead > setting, "the recycle ceiling must be applied after, and so win over, the setting");
  assert.match(scheduler, /if v_made >= v_ceiling then/);

  const limits = latestBody("cadence_max_attempts").body;
  assert.match(limits, /l\.campaign_id = p_campaign_id[\s\S]*l\.campaign_id is null[\s\S]*7\s*\);/, "campaign, then tenant, then seven");
  const migration = read("supabase", "migrations", "20260929201100_cadence_default_ladder_and_max_attempts.sql");
  assert.match(migration, /check \(max_attempts between 1 and 20\)/);
  assert.equal(MAX_ATTEMPTS_RANGE.min, 1);
  assert.equal(MAX_ATTEMPTS_RANGE.max, 20);
  assert.match(migration, /unique nulls not distinct \(tenant_id, campaign_id\)/);
  // The writer checks the campaign is the tenant's, and only the service role may call it.
  assert.match(latestBody("set_cadence_max_attempts").body, /CADENCE_CAMPAIGN_NOT_FOUND/);
  assert.match(migration, /revoke all on function public\.set_cadence_max_attempts\(uuid, uuid, integer, uuid\) from public, anon, authenticated, tenant_app;/);
  // Exhaustion is proved against the database, rolled back, in the migration's own check block.
  assert.match(migration, /exhausting a lead did not stamp nurture_entered_at/);
  assert.match(migration, /the per-lead recycle ceiling no longer wins over max attempts/);
});

test("the cadence API saves max attempts first, and answers 503 before its migration", () => {
  const route = read("app", "api", "app", "cadence", "route.ts");
  assert.match(route, /maxAttempts: z\.number\(\)\.int\(\)\.min\(MAX_ATTEMPTS_RANGE\.min\)\.max\(MAX_ATTEMPTS_RANGE\.max\)\.nullable\(\)\.optional\(\)/);
  assert.ok(route.indexOf("await saveMaxAttempts(") < route.indexOf("await saveCadence("), "max attempts must be refused before the rules are saved");
  assert.match(route, /error instanceof CadenceLimitsPendingError/);
  const service = read("lib", "cadence", "service.ts");
  assert.match(service, /This setting needs a database update that has not been applied yet\./);
  assert.match(service, /rpc\("set_cadence_max_attempts"/);
  // Reads tolerate the missing table: the scheduler then still stops at seven.
  assert.match(service, /if \(isSchemaGap\(result\.error\)\) return \{ own: null, inherited: DEFAULT_CEILING, effective: DEFAULT_CEILING, ready: false \}/);
  const editor = read("components", "app", "cadence-settings.tsx");
  assert.match(editor, /id="cadence-max-attempts"/);
  assert.match(editor, /\.\.\.\(maxDirty \? \{ maxAttempts: maxValue \} : \{\}\)/, "the editor sends max attempts only when it changed");
});
