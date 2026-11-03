// Deleting a cancelled agency's workspace on request (2026-10-16): the safety properties.
// Run with: node --test lib/tenants/purge.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/20261016430000_cancelled_workspace_purge.sql");
const fn = sql.slice(sql.indexOf("create or replace function public.purge_tenant_workspace"), sql.indexOf("create or replace function public.cancelled_workspaces_due"));

test("a guard only opens inside this connection's purge of that agency", () => {
  assert.match(sql, /where r\.status = 'running' and r\.backend_pid = pg_backend_pid\(\)\n\s+and \(p_row->>'tenant_id' is null or r\.tenant_id::text = p_row->>'tenant_id'\)\)/);
  assert.match(sql, /revoke all on public\.tenant_purge_run from public, anon, authenticated, tenant_app;/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.tenant_purge_run from service_role;/);
  const lines = sql.match(/if public\.tenant_purge_active\(to_jsonb\(old\)\) then return old; end if;/g) ?? [];
  assert.equal(lines.length, 46 + 1, "one line in each of the 46 patched trigger functions, and the catch-all's copy");
  // A guard a migration added before this one is given the same line from its live definition.
  assert.match(sql, /v_pos := regexp_instr\(v_def, E'\\n\[ \\t\]\*begin\[ \\t\]\*\\n', 1, 1, 1, 'i'\);/);
  assert.match(sql, /v_def := replace\(pg_get_functiondef\(r\.oid\), E'\\r\\n', E'\\n'\);/);
});

test("the platform's own billing, audit and admin guards are left alone", () => {
  for (const name of ["prevent_platform_audit_mutation", "prevent_issued_invoice_mutation", "prevent_credit_note_mutation", "admin_users_keep_an_active_super_admin"]) {
    assert.doesNotMatch(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`), name);
  }
});

test("it refuses unless cancelled, unheld, named and explained — and runs only as the service", () => {
  assert.match(fn, /if p_confirm_name is distinct from v_name then raise exception using errcode = '22023', message = 'CONFIRMATION_MISMATCH'/);
  assert.match(fn, /s\.status is distinct from 'cancelled'\) then\n\s+raise exception using errcode = 'P0001', message = 'SUBSCRIPTION_NOT_CANCELLED'/);
  assert.match(fn, /h\.released_at is null\) then\n\s+raise exception using errcode = 'P0001', message = 'LEGAL_HOLD_ACTIVE'/);
  assert.match(sql, /grant execute on function public\.purge_tenant_workspace\(uuid, uuid, text, text\) to service_role;/);
  assert.match(sql, /has_function_privilege\('tenant_app', 'public\.purge_tenant_workspace\(uuid,uuid,text,text\)', 'execute'\)/);
});

test("billing records are kept; everything else of the agency goes, or nothing does", () => {
  for (const kept of ["subscriptions", "invoices", "platform_invoices", "credit_notes", "payments", "usage_events", "tenant_entitlements"]) assert.match(fn, new RegExp(`'${kept}'`));
  assert.match(fn, /message = format\('PURGE_INCOMPLETE: %s row\(s\) left in %s', n, t\)/);
  assert.doesNotMatch(fn, /delete from public\.tenants\b/, "the agency row itself stays (billing points at it)");
});

test("the people who only worked there are emptied, not left with their details", () => {
  assert.match(fn, /email = 'deleted-' \|\| u\.id::text \|\| '@deleted\.invalid', phone = null/);
  assert.match(fn, /password_hash = null/);
  assert.match(fn, /and not exists \(select 1 from public\.tenant_users tu where tu\.user_id = u\.id\)/);
});

test("the admin action is super-admin only, and the files go too", () => {
  const route = read("app/api/admin/tenants/[id]/purge/route.ts");
  assert.match(route, /requireAdminRole\(CAN_CHANGE_MAINTENANCE\)/);
  assert.match(route, /action: "tenant\.workspace_purged"/);
  const svc = read("lib/tenants/purge.ts");
  assert.match(svc, /\.\.\.\(buckets \?\? \[\]\)\.map\(\(b\) => \(\{ bucket: b\.id, prefix: tenantId \}\)\)/);
  assert.match(svc, /userIds\.map\(\(u\) => \(\{ bucket: AVATAR_BUCKET, prefix: u \}\)\)/);
});
