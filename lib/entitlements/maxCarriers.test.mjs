// Run with: node --experimental-strip-types --test lib/entitlements/maxCarriers.test.mjs
//
// SA-2 audit (2026-10-15): plans.max_carriers was on the plan and enforced nowhere. It is now in the
// entitlement and save_tenant_carrier refuses a new carrier past it with a clear 403.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CarrierLimitError, carrierLimitMessage, parseCarrierLimit } from "../carriers/limit.ts";

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function latestDefining(signature) {
  const file = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort().reverse()
    .find((n) => readFileSync(join(MIGRATIONS, n), "utf8").includes(signature));
  assert.ok(file, `no migration defines ${signature}`);
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(signature);
  return sql.slice(start, sql.indexOf("$$;", start));
}

test("the engine puts max_carriers into the entitlement's limits", () => {
  const engine = latestDefining("create or replace function public.refresh_tenant_entitlement");
  assert.match(engine, /'max_carriers', v_limits\.max_carriers,/);
  // Nothing the earlier engines carried is lost in the restatement.
  for (const marker of ["'plan_name', v_plan.name", "'max_setter_seats'", "'credit_grants_included', true", "'retention_until'", "tenant_feature_overrides"]) {
    assert.ok(engine.includes(marker), `the engine lost ${marker}`);
  }
  assert.match(read("lib/entitlements/types.ts"), /max_carriers\?: number \| null;/);
});

test("the one write path for carriers enforces it, under a per-tenant lock, and never refuses a re-save", () => {
  const save = latestDefining("create or replace function public.save_tenant_carrier");
  assert.match(save, /pg_advisory_xact_lock\(hashtextextended\('tenant-carriers:'/);
  assert.match(save, /entitlement #>> '\{limits,max_carriers\}'/);
  assert.match(save, /not exists \(select 1 from public\.tenant_carriers tc where tc\.tenant_id = p_tenant_id and tc\.carrier_id = p_carrier_id and tc\.is_active\)/);
  assert.match(save, /raise exception 'carrier_limit_reached:%:%', v_held, v_limit/);
  // Both routes that add a carrier answer 403 with the message.
  for (const path of ["app/api/app/carrier-library/tenant-carriers/route.ts", "app/api/app/rate-card/route.ts"]) {
    assert.match(read(path), /error instanceof CarrierLimitError\) return NextResponse\.json\(\{ error: error\.message, code: error\.code, limit: error\.limit \}, \{ status: 403 \}\)/, path);
  }
  assert.match(read("lib/carriers/service.ts"), /if \(overLimit\) throw new CarrierLimitError\(overLimit\.held, overLimit\.limit\)/);
});

test("the refusal reads as a plan limit with its numbers", () => {
  assert.deepEqual(parseCarrierLimit('carrier_limit_reached:3:3'), { held: 3, limit: 3 });
  assert.equal(parseCarrierLimit("Carrier is not available"), null);
  assert.equal(parseCarrierLimit(undefined), null);
  const error = new CarrierLimitError(1, 1);
  assert.equal(error.status, 403);
  assert.equal(error.message, carrierLimitMessage(1, 1));
  assert.match(error.message, /^Your plan allows 1 carrier and you already work with 1 carrier\. Upgrade/);
  assert.match(carrierLimitMessage(5, 5), /allows 5 carriers/);
});
