// LA-1.17-12 (M1 perf, 2026-09-30): the partner pipeline at 5,000 leads.
//
// partner_lead_pipeline_page's `filtered` CTE carried q.* and l.values, spilled to disk and was
// re-read nine times, and the route made three more reads beside it, one of which walked every queue
// item the partner ever had. These pin the lean shape of 20260929140000 and the route's use of it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { SUBMITTED_BUCKET_SECONDS, startOfTodayIn, submittedSinceFromBuckets } from "./counters.ts";

const migration = await readFile("supabase/migrations/20260929140000_m1_partner_pipeline_lean_read_model.sql", "utf8");
const service = await readFile("lib/partnerLeads/service.ts", "utf8");
const fn = migration.slice(migration.indexOf("create or replace function public.partner_lead_pipeline_page"), migration.indexOf("$function$;"));
const filtered = fn.slice(fn.indexOf("with filtered as"), fn.indexOf("), page_keys as"));

test("the filtered CTE selects named columns only, never q.* or l.values", () => {
  assert.ok(filtered.length > 0, "filtered CTE found");
  assert.doesNotMatch(filtered, /q\.\*/);
  assert.doesNotMatch(filtered, /l\.values/);
  assert.doesNotMatch(filtered, /users/, "the closer's name is looked up for the page and the facet, not per filtered row");
  for (const column of ["q.id", "q.lead_id", "q.queued_at", "q.status", "q.disposition", "q.sla_partner_notified_at", "l.created_at as submitted_at", "l.created_by as submitted_by_id"]) {
    assert.ok(filtered.includes(column), `filtered carries ${column}`);
  }
  assert.match(fn, /with filtered as materialized/);
});

test("the customer name reads l.values for the page's rows only", () => {
  const page = fn.slice(fn.indexOf("), page as ("), fn.indexOf("), stage_rows as"));
  assert.match(page, /from page_keys k join public\.agent_leads l on l\.id=k\.lead_id/);
  assert.match(page, /l\.values->>'full_name'/);
  assert.match(fn, /limit least\(greatest\(coalesce\(p_limit,250\),1\),5000\) offset greatest\(coalesce\(p_offset,0\),0\)/);
});

test("the counters read filtered once and the settings dropped by 20260912370000 are restated", () => {
  const totals = fn.slice(fn.indexOf("), totals as ("), fn.indexOf("), page_size as"));
  for (const counter of ["submitted_today", "claimed", "still_open", "oldest_open_at"]) assert.ok(totals.includes(counter), counter);
  assert.equal((fn.match(/from filtered where status/g) ?? []).length, 0, "no counter scans filtered on its own");
  assert.match(fn, /set work_mem to '16MB'/);
  assert.match(fn, /set jit to 'off'/);
  assert.match(fn, /set max_parallel_workers_per_gather to '0'/);
});

test("payload positions 0-14 are unchanged and position 15 is the told flag", () => {
  assert.match(fn, /jsonb_build_array\(lead_id, id, customer, submitted_at, updated_at, product_line,\s+coalesce\(stage_id::text, stage_key\), coalesce\(stage_key,'New'\), 'open', disposition, disposition, null,\s+submitted_by_id, submitted_by_name, status,\s+\(sla_partner_notified_at is not null and status in \('unclaimed','expired'\)\)\)/);
  assert.match(fn, /'submitted_recent'/);
  assert.match(fn, /floor\(extract\(epoch from submitted_at\) \/ 900\)::bigint/);
  assert.match(fn, /interval '26 hours'/);
});

test("the migration is idempotent, service-role only, and checks itself", () => {
  assert.match(migration, /create or replace function public\.partner_lead_pipeline_page/);
  assert.match(migration, /revoke all on function public\.partner_lead_pipeline_page\([^)]*\) from public, anon, authenticated, tenant_app/);
  assert.match(migration, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
  for (const line of migration.split("\n").filter((l) => l.trimStart().startsWith("--"))) assert.ok(!line.includes(";"), `no semicolon in a comment: ${line}`);
});

test("the route uses the read model's told flag, oldest open and buckets, with the old reads as fallback", () => {
  assert.match(service, /value\.length >= 16 && typeof value\[15\] === "boolean"/);
  assert.match(service, /submittedSinceFromBuckets\(payload\.submitted_recent, since\)/);
  assert.match(service, /toldByModel \? Promise\.resolve\(toldByModel\) : partnerToldIds\(/);
  assert.match(service, /modelSubmitted !== null \? Promise\.resolve\(modelSubmitted\) : submittedSince\(/);
  assert.match(service, /modelOldest !== undefined \? Promise\.resolve\(modelOldest\) : oldestOpenQueuedAt\(/);
  assert.doesNotMatch(service, /partnerToldIds\(db, tenantId, partnerId, hydratedRows/, "the list's told read no longer runs after the others");
});

test("submitted since midnight sums the buckets from the zone's midnight", () => {
  const now = Date.parse("2026-09-30T15:07:00Z");
  const since = startOfTodayIn("America/New_York", now); // 04:00Z
  const bucket = (iso) => Math.floor(Date.parse(iso) / 1000 / SUBMITTED_BUCKET_SECONDS);
  const buckets = [[bucket("2026-09-30T03:59:59Z"), 5], [bucket("2026-09-30T04:00:00Z"), 2], [bucket("2026-09-30T14:59:00Z"), 3]];
  assert.equal(submittedSinceFromBuckets(buckets, since, now), 5);
  assert.equal(submittedSinceFromBuckets([], since, now), 0);
  // A half-hour zone still lands on a bucket boundary.
  const kolkata = startOfTodayIn("Asia/Kolkata", now);
  assert.equal(submittedSinceFromBuckets([[bucket("2026-09-29T18:30:00Z"), 4], [bucket("2026-09-29T18:29:00Z"), 9]], kolkata, now), 4);
});

test("an older read model or an unanswerable midnight falls back to the route's own count", () => {
  const now = Date.parse("2026-09-30T15:07:00Z");
  const since = startOfTodayIn("UTC", now);
  assert.equal(submittedSinceFromBuckets(undefined, since, now), null);
  assert.equal(submittedSinceFromBuckets([["x", 1]], since, now), null);
  assert.equal(submittedSinceFromBuckets([], new Date(since.getTime() + 60_000), now), null, "not on a 15-minute boundary");
  assert.equal(submittedSinceFromBuckets([], new Date(now - 26 * 3_600_000), now), null, "older than the buckets reach");
});
