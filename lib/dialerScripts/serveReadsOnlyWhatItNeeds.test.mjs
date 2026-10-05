/**
 * LA-2.8-7 "Serving is under 200ms with 100,000 eligible leads" and LA-2.2-4 (a lead's own
 * dial_timezone), as built by 20260929203000.
 *
 * The load test found every Serve next timing out at 100,000 eligible leads, because the serve
 * listed every eligible lead to keep one. These pin what replaced it, so a later edit cannot
 * quietly go back to listing everything, fork the eligibility rules, or drop a 711400 rule.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const serve = readFileSync(join(MIGRATIONS, "20260929203000_m2_serve_reads_only_what_it_needs.sql"), "utf8");
const index = readFileSync(join(MIGRATIONS, "20260929203100_m2_fresh_lead_serving_index.sql"), "utf8");
const zonedIndex = readFileSync(join(MIGRATIONS, "20260929203200_m2_fresh_zoned_lead_index.sql"), "utf8");

function fn(name) {
  const start = serve.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  assert.ok(start >= 0, `${name} is not defined`);
  return serve.slice(start, serve.indexOf("$function$;", serve.indexOf("$function$", start) + 10));
}

test("it refuses to run before the four files it copies from are live", () => {
  assert.match(serve, /apply 20260925709600 \(agent_leads\.dial_timezone\) first/);
  assert.match(serve, /apply 20260925709700 and 20260929200200 \(DNC exemptions in serve_eligible\) first/);
  assert.match(serve, /apply 20260929201000 \(state calling rules\) first/);
});

test("one rulebook: serve_eligible_ids is generated from serve_eligible and checked against it", () => {
  const regenerate = fn("serve_eligible_ids_regenerate");
  assert.match(regenerate, /pg_get_functiondef\('public\.serve_eligible\(uuid,uuid,timestamptz,boolean\)'::regprocedure\)/);
  assert.match(regenerate, /where q\.tenant_id = p_tenant_id and q\.id = any\(p_qids\)/);
  assert.match(serve, /if v_ids <> v_expected then raise exception '203000 check: serve_eligible_ids is not serve_eligible''s body \(one rulebook\)'/);
  // Nothing else defines a second copy of the rules by hand.
  assert.doesNotMatch(serve, /create or replace function public\.serve_eligible_ids\(/i);
});

test("serve_next_lead no longer lists every eligible lead, and keeps the 711400 choice", () => {
  const body = fn("serve_next_lead");
  assert.doesNotMatch(body, /el_all/);
  assert.doesNotMatch(body, /from public\.serve_eligible\(/);
  assert.match(body, /public\.serve_top\(/);
  assert.match(body, /public\.serve_tier_candidates\(/);
  // the weighted campaign draw, the cohort sides and the fallback to every lead when a side is empty
  assert.match(body, /order by -ln\(greatest\(random\(\), 1e-9\)\) \/ greatest\(t\.weight, 1\)/);
  assert.match(body, /v_side := case when not v_enabled then 'all' when v_serve_control then 'holdout' else 'rest' end/);
  assert.match(body, /if not v_pref and v_side <> 'all' then/);
  assert.match(body, /v_scored := v_enabled and not v_serve_control and v_pref/);
  // the reclaim, capacity gate, claim race guard, reason and decision row stay
  assert.match(body, /agent_can_take_pool_lead\(p_tenant_id, p_agent_user_id\)/);
  assert.ok((body.match(/callback_work_item_holder/g) ?? []).length >= 2, "holder-first reclaim lost");
  assert.match(body, /where q\.id = v_qid and q\.status = 'unclaimed'/);
  assert.match(body, /insert into tenant_scoring_decisions/);
  // 711500: first_dial_at is the Dial click, not the serve
  assert.doesNotMatch(body, /first_dial_at = coalesce/);
});

test("the tiers come from the only sets that can hold them", () => {
  const small = fn("serve_small_qids");
  assert.match(small, /l\.posted_at >= p_now - interval '5 minutes'/);
  assert.match(small, /coalesce\(l\.attempts_made, 0\) = 0/);
  assert.match(small, /tenant_callbacks t/);
  assert.match(small, /tenant_appointments a/);
  assert.match(small, /q\.owner_user_id = p_agent_user_id and q\.status = 'claimed'/);
  const due = fn("serve_due_qids");
  assert.match(due, /l\.lead_state in \('retry', 'nurture'\)/);
  assert.match(due, /l\.next_dial_after <= p_now/);
  const top = fn("serve_top");
  assert.match(top, /campaigns_servable/);
  assert.match(top, /v_top <= 3/);
  assert.match(top, /if v_top = 4 then/);
  assert.match(top, /if v_top = 6 then/);
});

test("a campaign is read only as far as the answer needs, and exactly", () => {
  const scan = fn("serve_fresh_scan");
  // the oldest: a campaign lead's age is never earlier than its creation
  assert.match(scan, /exit when p_mode = 'oldest' and v_best is not null and v_after_created >= v_best/);
  // the newest: plus every lead queued or posted after the cut-off
  assert.match(scan, /q\.queued_at > v_cut/);
  assert.match(scan, /l\.posted_at > v_cut/);
  // leads with no campaign are read in full
  assert.match(scan, /v_full boolean := p_campaign_id is null/);
  const states = fn("serve_open_states");
  assert.match(states, /agent_may_work_state\(p_tenant_id, p_agent_user_id, tz\.state\)/);
  assert.match(states, /tenant_can_dial_now\(p_tenant_id, tz\.state, null, p_now\)/);
  // zoned leads are asked about directly, never filtered out by their state's clock
  assert.match(fn("serve_zoned_qids"), /l\.dial_timezone is not null/);
});

test("LA-2.2-4: a lead's own dial_timezone moves the clock on the serve and on the pick", () => {
  assert.match(serve, /else coalesce\(public\.tenant_can_dial_now\(p_tenant_id, st\.state, l\.campaign_id, \(\(p_now at time zone l\.dial_timezone\) at time zone st\.zone\)\), false\)/);
  assert.match(serve, /when l\.dial_timezone not in \(select tz2\.timezone from public\.state_timezones tz2\) then false/);
  assert.match(serve, /then \(\(v_now at time zone l\.dial_timezone\) at time zone \(select tz\.timezone from state_timezones tz where tz\.state = upper\(l\.values->>''state''\)\)\)/);
  // the rolled-back check: a 32501 lead is refused at 7:30 Central and served at 8:30 Central
  assert.match(serve, /'zip', '32501'/);
  assert.match(serve, /a 32501 lead was servable at 7:30 Central/);
  assert.match(serve, /M2_203000_ZONE_ROLLBACK/);
});

test("the checks cover every 711400 rule, the 2:1 draw and old-versus-new equivalence", () => {
  for (const rule of [
    /capacity gate lost/, /holder-first reclaim lost/, /tier 2 is no longer callback_tier_due/,
    /tier 1 no longer requires attempts_made = 0/, /a recycled retry no longer goes to tier 6/,
    /the scrub gate \(campaigns_servable\) is gone/, /holdout cohort lost/, /licence expiry is gone/,
    /the DNC exemption \(200200\) did not reach serve_eligible_ids/,
  ]) assert.match(serve, rule);
  assert.match(serve, /if v_share < 0\.62 or v_share > 0\.72 then/);
  assert.match(serve, /create temp table serve_203000_ref on commit drop as\s+select \* from public\.serve_eligible\(/);
  assert.match(serve, /the scored cohort''s newest 50 differ/);
  assert.match(serve, /naive pick aged % before, % now/);
});

test("the indexes are built concurrently, each in its own paste", () => {
  for (const file of [index, zonedIndex]) {
    assert.match(file, /PASTE THIS FILE ON ITS OWN/);
    assert.equal((file.match(/;\s*$/gm) ?? []).length, 1, "a concurrent index file holds one statement");
    assert.match(file, /create index concurrently if not exists/);
  }
  assert.match(index, /\(tenant_id, campaign_id, \(upper\(values->>'state'\)\), created_at, id\)\s+where lead_state = 'fresh'/);
  assert.match(zonedIndex, /where lead_state = 'fresh' and dial_timezone is not null/);
});

test("the scoring preview keys its window on the lead's own zone too (203300), after 203000", () => {
  const preview = readFileSync(join(MIGRATIONS, "20260929203300_m2_scoring_preview_reads_the_lead_zone.sql"), "utf8");
  assert.match(preview, /apply 20260929203000 first/);
  assert.match(preview, /to_regprocedure\('public\.serve_eligible_ids_regenerate\(\)'\) is null/);
  // an in-place edit: single-line anchors, CRLF normalised, each counted once
  assert.ok(preview.includes("replace(pg_get_functiondef(v_sig), E'\\r\\n', E'\\n')"), "the live body is not CRLF-normalised");
  assert.match(preview, /expected this scoring_queue_preview line once, found %/);
  // the same rule as serve_eligible: the lead's clock, a non-state zone refused, servable and held keyed on the zone
  assert.match(preview, /coalesce\(tenant_can_dial_now\(p_tenant_id, d\.raw_state, d\.campaign_id, d\.at_lead_clock\), false\) as can_dial/);
  assert.match(preview, /then \(\(v_now at time zone u\.dial_tz\) at time zone \(select tz\.timezone from state_timezones tz where tz\.state = upper\(u\.raw_state\)\)\)/);
  assert.match(preview, /where k\.can_dial and k\.dial_tz is not distinct from u\.dial_tz/);
  assert.match(preview, /where not k\.can_dial and k\.dial_tz is not distinct from u\.dial_tz/);
  // the rules it carried, and the rolled-back FL 32501 check
  for (const rule of [/the scrub gate is gone/, /suppression is gone/, /the licence gate is gone/, /tier 2 is no longer callback_tier_due/, /the capacity gate is gone/, /the holdout cohort is gone/]) assert.match(preview, rule);
  assert.match(preview, /FL at 8:30 Eastern must be open and on a Central clock \(7:30\) closed/);
  assert.match(preview, /'32501'/);
  assert.match(preview, /M2_203300_ZONE_ROLLBACK/);
});
