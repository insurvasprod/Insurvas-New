// Run with: node --experimental-strip-types --test lib/metering/nearCapAlert.test.mjs
//
// SA-2 audit (2026-10-15): near_cap was computed and nobody was told. A trigger on usage_totals now
// writes one in-app notification per owner, once per meter per billing period, at the platform's
// warning threshold; the outbox emails it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NOTIFICATION_EVENTS } from "../notifications/events.ts";
import { eventTypeForKind } from "../agentAlerts/presentation.ts";

const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20261015601000_sa_2_carrier_limit_and_near_cap_alert.sql"), "utf8");
const fn = sql.slice(sql.indexOf("create or replace function public.notify_meter_near_cap"), sql.indexOf("$$;", sql.indexOf("create or replace function public.notify_meter_near_cap")));

test("every writer of usage is covered: the alert is a trigger on usage_totals", () => {
  assert.match(sql, /create trigger usage_totals_near_cap_alert\s+after insert or update of used_qty on public\.usage_totals\s+for each row execute function public\.notify_meter_near_cap\(\)/);
});

test("once per meter per period, to active owners, at the configured threshold", () => {
  assert.match(fn, /'allowance-near-cap:' \|\| new\.meter_key \|\| ':' \|\| to_char\(new\.period_start/);
  assert.match(fn, /on conflict \(tenant_id, recipient_user_id, source_key\) do nothing/);
  assert.match(fn, /tu\.role::text = 'owner'/);
  assert.match(fn, /u\.status = 'active'/);
  assert.match(fn, /s\.key = 'usage\.warn_percent'/, "the same setting the usage monitor reads");
  assert.match(fn, /if new\.used_qty < v_cap\.included \* v_warn then/);
  assert.match(fn, /v_cap\.included is null or v_cap\.included <= 0/, "unlimited meters have no 80%");
  assert.match(fn, /new\.period_start is distinct from public\.tenant_current_period_start\(new\.tenant_id\)/);
});

test("a failed alert never fails the usage write that crossed the line", () => {
  assert.match(fn, /exception when others then\s+raise warning/);
});

test("the kind is registered, so the bell shows it and the outbox emails it", () => {
  const event = NOTIFICATION_EVENTS.find((e) => e.key === "allowance_near_cap");
  assert.ok(event, "allowance_near_cap is not in the registry");
  assert.deepEqual(event.kinds, ["allowance_near_cap"]);
  assert.equal(event.email, "outbox");
  assert.equal(event.is_protected, false);
  assert.equal(eventTypeForKind("allowance_near_cap"), "allowance_near_cap");
  assert.match(fn, /'allowance_near_cap',/, "the SQL writes the registered kind");
});
