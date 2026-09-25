import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const previous = await read("supabase/migrations/20260924150000_unclaimed_sla_is_for_inbound_transfers_only.sql");
const migration = await read("supabase/migrations/20260924250100_unclaimed_sla_ladder_runs_every_minute.sql");
const service = await read("lib/queueSla/service.ts");
const runner = await read("scripts/run-unclaimed-sla.mjs");

function ladder(sql) {
  const start = sql.indexOf("create or replace function public.run_unclaimed_sla(");
  const grant = "grant execute on function public.run_unclaimed_sla(timestamptz, integer) to service_role;\n";
  const end = sql.indexOf(grant, start);
  assert.ok(start >= 0 && end > start, "run_unclaimed_sla definition not found");
  return sql.slice(start, end + grant.length);
}

test("the ladder is 20260924150000's with the three earlier rungs skipped for a quiet expiry, nothing else", () => {
  const after = ladder(migration);
  const quietAt = after.indexOf("    -- Already past expiry and no rung has fired");
  const openAt = after.indexOf("    if not v_quiet then\n");
  const closeAt = after.indexOf("    end if;\n    if v_age >= v_expire and item.sla_expired_at is null then\n");
  assert.ok(quietAt > 0 && openAt > quietAt && closeAt > openAt, "quiet block not found in the expected place");

  // Undo the change: drop the quiet computation and the wrapper, dedent the wrapped rungs.
  const wrapped = after.slice(openAt + "    if not v_quiet then\n".length, closeAt);
  const undone = after.slice(0, quietAt) + wrapped.split("\n").map((line) => line.replace(/^ {2}/, "")).join("\n")
    + after.slice(closeAt + "    end if;\n".length);
  const expected = ladder(previous);
  const withoutQuiet = undone
    .replace("  v_quiet boolean;\n", "")
    .replace("'thresholdSeconds', v_expire, 'quiet', v_quiet)", "'thresholdSeconds', v_expire)");
  assert.equal(withoutQuiet, expected);
});

test("a quiet expiry needs the transfer past expiry AND no rung fired yet", () => {
  const after = ladder(migration);
  assert.match(after, /v_quiet := v_age >= v_expire and item\.sla_warned_at is null and item\.sla_escalated_at is null\n\s+and item\.sla_partner_notified_at is null;/);
  // Expiry itself is outside the wrapper: a quiet transfer still expires, and says it was quiet.
  const expireAt = after.indexOf("if v_age >= v_expire and item.sla_expired_at is null then");
  assert.ok(expireAt > after.indexOf("if not v_quiet then"));
  assert.match(after.slice(expireAt), /'quiet', v_quiet/);
});

test("pg_cron runs the ladder every minute and trims its own run log", () => {
  assert.match(migration, /create extension if not exists pg_cron with schema pg_catalog;/);
  assert.match(migration, /cron\.schedule\(\s*'unclaimed-sla-ladder',\s*'\* \* \* \* \*',\s*\$cron\$select count\(\*\) from public\.run_unclaimed_sla\(now\(\), 500\)\$cron\$/);
  assert.match(migration, /cron\.schedule\(\s*'unclaimed-sla-ladder-log-cleanup',[\s\S]*?jobname = 'unclaimed-sla-ladder'[\s\S]*?interval '7 days'/);
  assert.match(migration, /raise exception 'the unclaimed-SLA ladder is not scheduled'/);
  assert.match(migration, /raise exception 'run_unclaimed_sla still fires every rung/);
});

test("a late escalation or partner card is re-checked against the transfer before anything is sent", () => {
  const body = service.slice(service.indexOf("async function processEvent"), service.indexOf("export async function processUnclaimedSla"));
  const guard = body.indexOf('if (tellsSomeone && queueResult.data?.status !== "unclaimed") return;');
  assert.ok(guard > 0, "no still-unclaimed check");
  assert.match(body, /const tellsSomeone = event\.rung === "escalate" \|\| event\.rung === "partner";/);
  for (const effect of ["sendEmail(", "notifyTenantAgents(", "postPartnerSystemCard("]) {
    const at = body.indexOf(effect);
    assert.ok(at > guard, `${effect} runs before the still-unclaimed check`);
  }
  // Expiry's nurture is not behind the check: an expired transfer is exactly what it is for.
  assert.ok(body.indexOf('rpc("nurture_expired_transfer"') > guard);
  assert.doesNotMatch(body.slice(0, guard), /rung === "expire"/);
});

test("the runner works with either secret", () => {
  assert.match(runner, /UNCLAIMED_SLA_SECRET or CRON_SECRET is required/);
  assert.match(runner, /\/api\/internal\/unclaimed-sla`, \{ method: "POST"/);
  assert.match(runner, /\/api\/cron\/unclaimed-sla`, \{ method: "GET"/);
});
