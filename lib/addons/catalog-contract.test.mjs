import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../supabase/migrations/20260914110000_sa_2_6_addon_catalog_admin_rpc.sql", import.meta.url), "utf8");

test("SA-2.6 catalog mutation is a service-only security-definer RPC", () => {
  assert.match(migration, /create or replace function public\.admin_upsert_addon/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /grant execute on function public\.admin_upsert_addon[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.admin_upsert_addon[\s\S]*from public, anon, authenticated, tenant_app/);
});

const lock = await readFile(new URL("../../supabase/migrations/20260924352000_addon_price_lock_and_version_availability.sql", import.meta.url), "utf8");

test("price and billing cycle are locked while the billing run still invoices the add-on", () => {
  assert.match(lock, /create or replace function public\.admin_upsert_addon/);
  assert.match(lock, /security definer/);
  assert.match(lock, /set search_path = ''/);
  assert.match(lock, /s\.status <> 'cancelled'/);
  assert.match(lock, /p_price_cents <> v_addon\.price_cents or p_billing_cycle <> v_addon\.billing_cycle/);
  assert.match(lock, /raise exception 'addon_price_has_live_attachments'/);
  // The grant lock it builds on is kept.
  assert.match(lock, /raise exception 'addon_grants_have_live_attachments'/);
  assert.match(lock, /revoke all on function public\.admin_upsert_addon[\s\S]*from public, anon, authenticated, tenant_app/);
  assert.match(lock, /grant execute on function public\.admin_upsert_addon[\s\S]*to service_role/);
});

test("a save only removes availability from LATEST plan versions", () => {
  assert.match(lock, /newer\.code = cur\.code and newer\.version > cur\.version/);
  assert.match(lock, /on conflict \(plan_id, addon_id\) do nothing/);
  assert.doesNotMatch(lock, /delete from public\.plan_available_addons where addon_id = v_id;/);
  assert.match(lock, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
});

test("SA-2.6 catalog mutation protects live entitlement grants", () => {
  assert.match(migration, /addon_grants_have_live_attachments/);
  assert.match(migration, /delete from public\.addon_features/);
  assert.match(migration, /delete from public\.addon_meters/);
  assert.match(migration, /delete from public\.plan_available_addons/);
});
