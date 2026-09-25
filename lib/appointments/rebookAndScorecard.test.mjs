// LA-2 §11 concept build (2026-09-25): rebook a no-show, the per-calendar setter scorecard, and a
// setter never told why time is blocked. Held structurally — the rules live in SQL and routes.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = join(root, "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}

test("a rebooking books through book_appointment, links the no-show, and never rewrites it", () => {
  const migration = latestDefining(/create or replace function public\.rebook_appointment/);
  assert.ok(migration, "rebook_appointment is not defined");
  const fn = migration.body.slice(migration.body.indexOf("create or replace function public.rebook_appointment"), migration.body.indexOf("revoke all on function public.rebook_appointment"));
  assert.match(fn, /for update/);
  assert.match(fn, /a\.status <> 'no_show'/);
  assert.match(fn, /APPOINTMENT_ALREADY_REBOOKED/);
  assert.match(fn, /from book_appointment\(/);
  assert.match(fn, /set rebooked_from = a\.id/);
  assert.doesNotMatch(fn, /set status/, "the no-show must stay a no-show");
  assert.match(migration.body, /grant execute on function public\.rebook_appointment\([^)]*\) to service_role;/);
});

test("the route credits whoever rebooks, never a body field", () => {
  const route = read("app", "api", "app", "appointments", "route.ts");
  assert.match(route, /action: z\.literal\("rebook"\)/);
  assert.match(route, /actorId: auth\.context\.userId,\s*\n\s*startsAtUtc: rebook\.data\.starts_at_utc/);
  assert.match(route, /"tenant\.appointment_rebooked"/);
  assert.doesNotMatch(route, /booked_by: z\./);
});

test("the setter scorecard on the agent's page is that agent's calendar only, ranked by shown", () => {
  const migration = latestDefining(/create or replace function public\.setter_scorecard_for_agent/);
  assert.ok(migration);
  assert.match(migration.body, /ap\.agent_user_id = p_agent_user_id/);
  assert.match(migration.body, /ap\.booked_by <> p_agent_user_id/);
  const overview = read("lib", "setters", "overview.ts");
  assert.match(overview, /getAgentSetterScorecard\(input\.tenantId, input\.userId, 30\)/);
  assert.match(overview, /sort\(\(a, b\) => b\.showed - a\.showed/);
});

test("a setter sees blocked time as Unavailable, and only a setter", () => {
  const route = read("app", "api", "app", "appointments", "route.ts");
  assert.match(route, /auth\.context\.role === "setter" \? redactBlocksForSetter\(context\) : context/);
  const booking = read("lib", "appointments", "booking.ts");
  assert.match(booking, /HIDDEN_BLOCK_REASON = "Unavailable"/);
});
