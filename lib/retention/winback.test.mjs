// LA-5.7 (Notion sprint) · win-back, as plain rules, plus the migration's and the release path's promises.
// Run with: node --experimental-strip-types --test lib/retention/winback.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BAND_LABELS, CATEGORIES, CATEGORY_LABELS, isDue, leadNote } from "./winback.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const sql = read("supabase/migrations/20261014500000_la_5_7_winback.sql");
const store = read("lib/retention/winbackStore.ts");

test("due: the cooling-off has ended, it is not never, and it has not gone already", () => {
  const c = (over = {}) => ({ band: "fair", eligibleFrom: "2026-10-01", releasedAt: null, blockedReason: null, ...over });
  assert.equal(isDue(c(), "2026-10-14"), true);
  assert.equal(isDue(c({ eligibleFrom: "2026-11-01" }), "2026-10-14"), false);
  assert.equal(isDue(c({ band: "never", eligibleFrom: null }), "2026-10-14"), false);
  assert.equal(isDue(c({ releasedAt: "2026-10-05T00:00:00Z" }), "2026-10-14"), false);
});

test("a never-call candidate can never be released — by the table, on every path", () => {
  // The table: a never band carries no release and no eligible date, and the guard refuses a release.
  assert.match(sql, /constraint winback_candidate_never_dates check \(winback_band <> 'never' or \(eligible_from is null and released_to_nurture_at is null and released_lead_id is null\)\)/);
  assert.match(sql, /if new\.winback_band = 'never' then\s+raise exception 'A never-call candidate cannot be released\.'/);
  assert.match(sql, /if old\.winback_band = 'never' and new\.winback_band <> 'never' then/);
  // Nothing but the sync may create a candidate; nothing may remove one.
  assert.match(sql, /revoke insert, delete, truncate on public\.winback_candidate from service_role, tenant_app;/);
  // The app's one release path filters never too, and checks every do-not-call list before creating a lead.
  assert.match(store, /\.neq\("winback_band", "never"\)/);
  assert.match(store, /rpc\("is_phone_suppressed"/);
  // Not before the cooling-off ends.
  assert.match(sql, /if new\.eligible_from is null or new\.eligible_from > current_date then/);
});

test("never-call clients go on the internal do-not-call list; a death flags the household for a claim", () => {
  assert.match(sql, /insert into public\.tenant_do_not_call \(tenant_id, phone_digits, reason\)/);
  assert.match(sql, /insert into public\.household_claim_followup/);
  assert.match(sql, /constraint winback_candidate_never check \(\(winback_band = 'never'\) = \(lapse_reason_category in \('do_not_contact', 'deceased'\)\)\)/);
});

test("each reason maps to its band and cooling-off; affordability is 12 months with a 6-month floor", () => {
  assert.match(sql, /when v_category in \('do_not_contact', 'deceased'\) then 'never'/);
  assert.match(sql, /when v_category in \('affordability', 'no_longer_wanted'\) then 'poor'/);
  assert.match(sql, /winback_affordability_days smallint not null default 365/);
  assert.match(sql, /winback_affordability_days between 180 and 1095/);
  assert.match(sql, /winback_mechanical_days smallint not null default 30/);
  assert.match(sql, /winback_unknown_days smallint not null default 90/);
});

test("an inferred reason is marked and can never make a strong band", () => {
  assert.match(sql, /constraint winback_candidate_inferred check \(not reason_inferred or winback_band <> 'strong'\)/);
  assert.match(sql, /when v_category in \('mechanical', 'administrative'\) and not v_inferred and v_source in \('reinstatement_decline', 'save_call', 'client_said'\) then 'strong'/);
});

test("a release enters LA-2's machinery tagged winback, and the list goes back through the scrub gate", () => {
  assert.match(sql, /source_type in \('import', 'partner', 'affiliate', 'recycle', 'winback'\)/);
  assert.match(store, /source_type: "winback"/);
  assert.match(store, /lead_state: "nurture"/);
  assert.match(store, /rpc\("request_campaign_rescrub"/);
  // The client's old sold lead is never moved: a new lead goes in the Win-back list.
  assert.doesNotMatch(store, /from\("agent_leads"\)\.update/);
});

test("the lead's note carries what they had, paid, for how long, and why it ended — in neutral words", () => {
  const note = leadNote({ carrierName: "Americo", policyNumber: "AM-1", premiumCents: 7140, faceCents: 1200000, monthsPaid: 8, lapsedOn: "2026-09-01", category: "affordability", detail: "Could not afford the back premium", inferred: false, band: "poor" });
  assert.match(note, /\$12,000 of cover with Americo \(policy AM-1\)/);
  assert.match(note, /paid \$71\.40 a month for 8 months/);
  assert.match(note, /lapsed on 2026-09-01/);
  assert.match(note, /Said they could not afford it: Could not afford the back premium/);
  assert.doesNotMatch(note, /\b(she|her|he|his)\b/i);
  for (const c of CATEGORIES) assert.doesNotMatch(CATEGORY_LABELS[c], /\b(she|her|he|his)\b/i);
  assert.equal(BAND_LABELS.never, "Never call");
});
