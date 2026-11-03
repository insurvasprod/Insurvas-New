/**
 * QA R-3.2: "Preview the queue" timed out (7.8–8.4 s on 12,957 queue rows) because every per-lead rule
 * was a function call per queue row. 20261103200000 asks the state rules once per state and the
 * suppression and callback rules only where an indexed probe says they can be true — pinned here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const file = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261103200000_m2_scoring_preview_asks_each_rule_once.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const body = file.slice(file.indexOf("v_new constant text := $new$"), file.indexOf("\n$new$;"));
const code = body.replace(/--[^\n]*/g, "");
const calls = (name) => code.split(`${name}(`).length - 1;

test("the state rules are asked once per state, not once per queue row", () => {
  assert.equal(calls("agent_may_work_state"), 1);
  assert.equal(calls("current_slot_for_state"), 1);
  assert.match(code, /states as materialized \(\s*select s\.state_key,\s*agent_may_work_state\(p_tenant_id, p_agent_user_id, s\.state_key\) as may_work,\s*current_slot_for_state\(s\.state_key, v_now\) as slot\s*from \(select distinct p\.state_key from pool p\) s/);
  // Both functions read a missing state as '', so that is the key.
  assert.match(code, /coalesce\(l\.values->>'state', ''\) as state_key/);
  assert.match(code, /join states st on st\.state_key = p\.state_key\s*where st\.may_work/);
});

test("suppression and the callback tier run only behind an indexed probe that can make them true", () => {
  assert.equal(calls("is_phone_suppressed"), 1);
  assert.match(code, /not case when exists \(select 1 from tenant_suppression_list s\s*where s\.tenant_id = p_tenant_id and s\.phone_digits = p\.phone_digits\)\s*or exists \(select 1 from tenant_do_not_call d\s*where d\.tenant_id = p_tenant_id and d\.phone_digits = p\.phone_digits and d\.is_active\)\s*then \(select sup\.suppressed from is_phone_suppressed\(p_tenant_id, p\.raw_phone\) sup\)\s*else false end/);
  // the probe uses is_phone_suppressed's own normalisation
  assert.match(code, /regexp_replace\(coalesce\(l\.values->>'phone', ''\), '\[\^0-9\]', '', 'g'\)/);
  assert.match(code, /when length\(ph\.digits\) = 11 and left\(ph\.digits, 1\) = '1' then right\(ph\.digits, 10\) else ph\.digits end as phone_digits/);
  assert.equal(calls("callback_tier_due"), 1);
  assert.match(code, /cb\.status in \('scheduled', 'due'\) and cb\.scheduled_at_utc <= v_now\)\s*then public\.callback_tier_due\(p_tenant_id, p\.qid, v_now\) else false end then 2/);
});

test("the queue is read once over plain columns, and no per-row function is left in it", () => {
  const pool = code.slice(code.indexOf("with pool as materialized ("), code.indexOf("states as materialized ("));
  assert.doesNotMatch(pool, /agent_may_work_state|is_phone_suppressed|callback_tier_due|callback_work_item_holder|lead_queue_assignee|current_slot_for_state/);
  assert.match(pool, /campaigns_servable/);
  assert.match(pool, /l\.lead_state <> 'exhausted'/);
  // claimed rows still need the holder-first check, after the cheap filters
  assert.match(code, /and \(not p\.own\s*or coalesce\(public\.callback_work_item_holder\(p_tenant_id, p\.qid\), lead_queue_assignee\(p_tenant_id, p\.qid\)\) = p_agent_user_id\)/);
});

test("every rule from due onward is the live text, unchanged", () => {
  for (const line of [
    "coalesce(tenant_can_dial_now(p_tenant_id, d.raw_state, d.campaign_id, d.at_lead_clock), false) as can_dial",
    "when u.dial_tz in (select tz.timezone from state_timezones tz)",
    "from tenant_dial_window(p_tenant_id, k.raw_state, k.campaign_id, k.at_lead_clock) tw",
    "where k.can_dial and k.dial_tz is not distinct from u.dial_tz",
    "where not k.can_dial and k.dial_tz is not distinct from u.dial_tz",
    "cross join lateral score_lead(p_tenant_id, c.lid, v_now) sl",
    "[711400] LA-2.20-5",
  ]) assert.ok(body.includes(line), line);
});

test("leads that tie on every key are listed in work-item order, so the preview is the same on each refresh", () => {
  assert.match(code, /case when m\.ranked then -extract\(epoch from s\.aged_at\) else extract\(epoch from s\.aged_at\) end,\s*s\.qid\s*limit v_candidate_cap/);
  assert.match(code, /sc\.aged_at,\s*sc\.qid\s*\) as position/);
  assert.match(code, /order by h\.minutes_until_open nulls last, h\.priority, h\.aged_at, h\.qid\)/);
  assert.match(code, /order by hh\.minutes_until_open nulls last, hh\.priority, hh\.aged_at, hh\.qid\s*limit v_held_limit/);
});

test("the migration replaces only the body it was written from, proves parity, and carries no transaction control", () => {
  assert.match(file, /if md5\(v_live\) <> '[0-9a-f]{32}' then/);
  assert.match(file, /v_live := replace\(pg_get_functiondef\(v_sig\), E'\\r\\n', E'\\n'\);/);
  // what a tie cannot change: every count and setting, the listed tiers, the held-back (minutes, tier)
  assert.equal(file.split("select (x.j - 'generated_at' - 'rows' - 'held_back')").length - 1, 2);
  assert.match(file, /'row_tiers', \(select coalesce\(jsonb_agg\(r->'tier' order by/);
  assert.match(file, /'held_keys', \(select coalesce\(jsonb_agg\(jsonb_build_array\(h->'minutes_until_open', h->'tier_name'\)/);
  assert.match(file, /if v_before is distinct from v_after then\s*raise exception/);
  assert.match(file, /grant execute on function public\.scoring_queue_preview\(uuid, uuid, integer\) to tenant_app, service_role;/);
  assert.doesNotMatch(file.replace(/--[^\n]*/g, ""), /^\s*(begin|commit|rollback)\s*;/im);
  assert.doesNotMatch(file, /\r/);
});
