// Run with: npm test
//
// LA-2.24-2 and LA-2.7-8 (20260929201200). "A licensed agent never gets a lead in a state he cannot
// write (canWrite), setters get anything": term life is no longer licence-only by itself. And the
// rotation (attempts before rotate, rest days between owners) runs on pg_cron, not on a host.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const patch = read("supabase/migrations/20260929201200_setters_take_any_product_and_rotation_runs_on_pg_cron.sql");
const eligibility = read("supabase/migrations/20260925702000_agent_licence_expiry.sql");

test("term life stops being licence-only in both of the router's paths and the auto-route gate", () => {
  // Single-line anchors on the live bodies, each refusing to run when it is missing.
  assert.match(patch, /E'      v_requires_licensed := v_product in \(''term_life'', ''term-life'', ''term life''\)\\n'/);
  assert.match(patch, /E'        v_requires_licensed := v_requires_licensed or v_product in \(''term_life'', ''term-life'', ''term life''\)\\n'/);
  assert.match(patch, /E'v_state, v_product in \(''term_life'', ''term-life'', ''term life''\)\) then\\n'/);
  // The bulk "why nobody" sentence asks the same question the router does.
  assert.match(patch, /E'                        v_item\.product in \(''term_life'', ''term-life'', ''term life''\)\);\\n'/);
  assert.match(patch, /lead_list_assignment_run still explains term life as licence-only/);
  assert.equal((patch.match(/if v_new = v_src then raise exception/g) ?? []).length, 4, "every anchor must fail closed");
  // CRLF bodies from the SQL editor are normalised before matching.
  assert.equal((patch.match(/v_src := replace\(v_src, E'\\r\\n', E'\\n'\);/g) ?? []).length, 3);
  // Idempotent, and the result is checked against the live body.
  assert.match(patch, /if v_src like '%\[201200\]%' then/);
  assert.match(patch, /assign_lead_core still treats term life as licence-only/);
  // What stays: a tenant's own licensed-only rule, and 711200's suppression skip.
  assert.match(patch, /assignment_rule_requires_licence\(v_selected_rule\)/);
  assert.match(patch, /assignment_rule_requires_licence\(v_rule\)/);
  assert.match(patch, /\[711200\]/);
});

test("licensed agents keep canWrite; a setter passes unless a licence is asked for", () => {
  // The eligibility function is untouched by the patch, and it is where canWrite lives.
  assert.doesNotMatch(patch, /create or replace function public\.assignment_candidate_is_eligible/);
  assert.match(eligibility, /if p_requires_licensed and p_role = 'setter' then return false; end if;/);
  assert.match(eligibility, /if p_role = 'setter' then return true; end if;/);
  assert.match(eligibility, /from public\.licenses l/);
  assert.match(patch, /a producer with no licence was let through \(canWrite\)/);
  assert.match(patch, /a setter could not claim a term life lead/);
});

test("the rotation runs every five minutes on pg_cron, and the migration runs it once and rolls back", () => {
  assert.match(patch, /cron\.schedule\('assignment-rotation', '\*\/5 \* \* \* \*',\s*\$cron\$select public\.rotate_unanswered_assignments\(200\)\$cron\$\)/);
  const dryRun = patch.slice(patch.indexOf("-- Run the rotation once"));
  assert.match(dryRun, /v_report := public\.rotate_unanswered_assignments\(200\);/);
  assert.match(dryRun, /raise exception using errcode = 'P0099'/);
  assert.match(patch, /the assignment-rotation job is not scheduled/);
  // The job still decides nothing itself: the router applies rest days and never hands the lead back.
  const board = read("supabase/migrations/20260924300000_lead_assignment_board.sql");
  assert.match(board, /create or replace function public\.rotate_unanswered_assignments/);
  assert.match(read("supabase/migrations/20260925702100_assignment_router_strategy_conditions_auto_route.sql"), /p_rotate_from_user_id is null or tu\.user_id <> p_rotate_from_user_id/);
});
