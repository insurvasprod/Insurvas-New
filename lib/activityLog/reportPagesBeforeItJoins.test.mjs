/**
 * LA-2.21-4 "CSV export without a row cap, under 2 s over 100,000 rows, with pagination", as
 * built by 20260925709980. At 100,000 served cards the report built the whole joined set to
 * return 50 rows and timed out. These pin the shape that replaced it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20260925709980_activity_report_counts_before_it_joins.sql"), "utf8");
const body = sql.slice(sql.indexOf("create or replace function public.tenant_activity_report("), sql.indexOf("$function$;", sql.indexOf("create or replace function public.tenant_activity_report(")));

test("the total is counted from the served cards alone", () => {
  const count = body.slice(body.indexOf("if v_flag is null then"), body.indexOf("end if;", body.indexOf("if v_flag is null then")));
  assert.match(count, /select count\(\*\) into v_total\s+from tenant_lead_activity a/);
  assert.doesNotMatch(count, /agent_leads/);
});

test("the page is cut before anything is joined, and the export keeps no row cap", () => {
  const pageCards = body.slice(body.indexOf("page_cards as ("), body.indexOf("page_rows as ("));
  assert.match(pageCards, /order by f\.served_at desc, f\.id desc/);
  assert.match(pageCards, /limit case when p_export then null else v_size end/);
  assert.doesNotMatch(pageCards, /join/);
  const pageRows = body.slice(body.indexOf("page_rows as ("), body.indexOf("detailed as ("));
  assert.match(pageRows, /from page_cards f/);
  assert.match(pageRows, /join agent_leads l on l\.id = f\.lead_id and l\.tenant_id = f\.tenant_id/);
});

test("dropping the join from the count is safe: a card must share its lead's tenant", () => {
  assert.match(sql, /before insert or update of tenant_id, lead_id on public\.tenant_lead_activity/);
  assert.match(sql, /ACTIVITY_LEAD_OTHER_TENANT/);
  // and existing rows are checked before the guard is relied on
  assert.match(sql, /where l\.tenant_id <> a\.tenant_id/);
});

test("the lead's name follows the app's leadName precedence, so the app looks nothing up", () => {
  assert.match(body, /nullif\(l\.values->>'full_name', ''\)/);
  assert.match(body, /l\.values->'first_name'/);
  assert.match(body, /l\.values->'last_name'/);
  assert.match(body, /l\.values->'name'/);
});

test("the setter scope, the flag guards, the row detail and 202100's reschedule rule survive", () => {
  assert.match(body, /if p_actor_role = 'setter' then p_agent_user_id := p_actor_user_id; end if;/);
  assert.match(body, /ACTIVITY_FLAG_INVALID/);
  assert.match(body, /ACTIVITY_FLAG_FORBIDDEN/);
  for (const key of ["dial_attempt_number", "callback_at", "deal_face_amount_cents", "on_internal_dnc", "vendor_claim_status"]) assert.match(body, new RegExp(key));
  assert.match(body, /- 'lead_phone'/);
  assert.match(body, /ap\.booked_by = p\.agent_user_id and ap\.status <> 'rescheduled' \/\* \[202100\] \*\//);
  assert.match(sql, /create index if not exists tenant_callbacks_work_item_created_idx/);
});
