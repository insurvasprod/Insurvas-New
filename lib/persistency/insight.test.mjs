// LA-4.7 – 4.9 · the lapse date, the paged book, the Persistency page and one policy's money.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("4.7: the status date moves only when the status does, and the backfill keeps updated_at", () => {
  const sql = read("supabase/migrations/20261002120000_la_4_7_policy_status_changed_at.sql");
  assert.match(sql, /disable trigger tenant_policies_updated_at;[\s\S]*?update public\.tenant_policies[\s\S]*?enable trigger tenant_policies_updated_at;/);
  assert.match(sql, /elsif new\.status is distinct from old\.status then\s+new\.status_changed_at := now\(\);/);
  assert.match(sql, /new\.status_changed_at := old\.status_changed_at;/, "an edit cannot move the date by sending one");
  assert.match(sql, /before insert or update on public\.tenant_policies/);
  assert.doesNotMatch(sql, /set_config|\bset (local )?app\./i, "no session settings on the pooler");
});

test("4.7: the book is read in pages, and the lapse date falls back to the last edit before the column", () => {
  const service = read("lib/ledger/service.ts");
  assert.match(service, /\.range\(start, start \+ PAGE - 1\)/);
  assert.match(service, /if \(data\.length < PAGE\) return/);
  assert.match(service, /\.eq\("tenant_id", tenantId\)/, "a service-role read is filtered by tenant");
  assert.match(service, /if \(result\.error && isSchemaGap\(result\.error\)\) result = await read\(COLUMNS_V1\);/);
  assert.match(service, /return row\.status_changed_at \?\? row\.updated_at;/);
  assert.match(service, /if \(row\.status !== "lapsed" && row\.status !== "cancelled"\) return null;/);
});

test("4.8: persistency is gated, registered, built in the menu and scoped to the producer", () => {
  const route = read("app/api/app/persistency/route.ts");
  assert.match(route, /requireFeatureRole\("cohort_persistency", roles\)/);
  assert.match(route, /roleCanViewCommission\(auth\.context\.role, auth\.context\.userId, producerUserId\)/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /"app\/api\/app\/persistency\/route\.ts", featureKey: "cohort_persistency", allowedRoles: \["owner", "producer", "bookkeeper"\]/);
  assert.match(read("lib/menu/definition.ts"), /key: "insight\.persistency"[^\n]*built: true/);
  const page = read("app/app/(shell)/persistency/page.tsx");
  assert.match(page, /guardPage\("cohort_persistency"\)/);
  assert.match(page, /roleCanViewCommission\(guard\.role, guard\.context\.userId, producerUserId\)/);
  assert.match(page, /<TableCard/);
  assert.doesNotMatch(page, /text-\[\d+px\]/);
  const service = read("lib/persistency/service.ts");
  assert.match(service, /\.filter\(\(row\) => input\.canView\(row\.created_by \?\? undefined\)\)/);
  assert.equal((service.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length, 1, "the one paged reader filters by tenant");
});

test("4.9: one policy's page — same tenant, producer's own, assistants out, discrepancies for their roles", () => {
  const page = read("app/app/(shell)/policies/[id]/page.tsx");
  assert.match(page, /\.eq\("tenant_id", tenantId\)\.eq\("id", id\)\.maybeSingle\(\)/, "another workspace's id reads nothing");
  assert.match(page, /if \(!row\) notFound\(\);/);
  assert.match(page, /if \(!canView\(row\.created_by \?\? undefined\)\) notFound\(\);/, "a producer opens only their own");
  assert.match(page, /\["owner", "producer", "bookkeeper"\]\.includes\(guard\.role\)/, "an assistant sees no money");
  assert.match(page, /seesDiscrepancies = hasFeature\(guard\.entitlement, "discrepancy_report"\) && \["owner", "bookkeeper"\]\.includes\(guard\.role\)/);
  assert.match(page, /entry\.policyId === row\.id/);
  assert.match(page, /lead source \$\{leadSource\}/);
  assert.match(read("components/app/policies-workspace.tsx"), /href=\{`\/app\/policies\/\$\{policy\.id\}`\}/);
});

test("4.10: a read-only (suspended) account can read every Book of Business route, and every write refuses it", () => {
  const routes = [
    "app/api/app/statements/route.ts", "app/api/app/statements/[id]/route.ts", "app/api/app/statements/[id]/lines/route.ts",
    "app/api/app/statements/[id]/file/route.ts", "app/api/app/statements/unmatched/route.ts", "app/api/app/discrepancies/route.ts",
    "app/api/app/discrepancies/[id]/route.ts", "app/api/app/persistency/route.ts", "app/api/app/policies/route.ts", "app/api/app/ledger/route.ts",
  ];
  let handlers = 0;
  for (const file of routes) {
    const source = read(file);
    for (const [, method, body] of source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
      const gate = body.match(/requireFeatureRole\(([^;]*)\);/)?.[1] ?? "";
      assert.ok(gate, `${file} ${method} is gated`);
      if (method === "GET") assert.doesNotMatch(gate, /write: true/, `${file} GET stays readable`);
      else assert.match(gate, /\{ write: true \}/, `${file} ${method} refuses a read-only account`);
      handlers += 1;
    }
  }
  assert.equal(handlers, 15, "every handler in these files was checked");
  for (const page of ["app/app/(shell)/statements/page.tsx", "app/app/(shell)/statements/[id]/page.tsx", "app/app/(shell)/discrepancies/page.tsx"]) {
    assert.match(read(page), /const readOnly = guard\.entitlement\.access === "read_only";/, `${page} knows it is read-only`);
  }
});
