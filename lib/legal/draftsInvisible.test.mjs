// Run with: node --test lib/legal/draftsInvisible.test.mjs
//
// Legal drafts (legal_document_drafts, 20260924363000) are unpublished text. A customer must never
// be shown one, or asked to accept one. The database half of that promise is the migration's own
// assertions (no customer role can read the table; the customer read paths do not reference it).
// This is the code half: only the staff console may read drafts, and only through lib/legal/admin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    const stat = statSync(join(root, path));
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(path.split(sep).join("/"));
  }
  return out;
}

// The only files allowed to touch drafts: the admin data module, the admin route, the admin page.
const ALLOWED = new Set([
  "lib/legal/admin.ts",
  "app/api/admin/legal/route.ts",
  "app/admin/(protected)/legal/page.tsx",
]);

// A read is a query on the table, a call of the publish RPC, or an import of the module that does
// either. (Admin-only files may still NAME the table in a comment.)
const READS_DRAFTS = /from\(\s*["']legal_document_drafts["']|rpc\(\s*["']publish_legal_draft["']|@\/lib\/legal\/admin["']/;
// Inside lib/legal a sibling import of ./admin is the same thing.
const readsDrafts = (file, source) =>
  READS_DRAFTS.test(source) || (file.startsWith("lib/legal/") && /from ["']\.\/admin["']/.test(source));

test("only the staff console reads legal drafts", () => {
  const offenders = [...walk("app"), ...walk("components"), ...walk("lib")]
    .filter((file) => !file.endsWith(".test.mjs"))
    .filter((file) => !ALLOWED.has(file))
    .filter((file) => readsDrafts(file, read(file)));
  assert.deepEqual(offenders, [], `these files read legal drafts but are not the admin Legal page: ${offenders.join(", ")}`);
});

test("every customer-facing legal surface reads published documents only", () => {
  const customerFiles = [
    "app/legal/[type]/page.tsx",
    "app/api/public/legal/route.ts",
    "app/api/public/signup/route.ts",
    "app/api/app/signup/route.ts",
    "app/api/app/legal/accept/route.ts",
    "app/app/accept-terms/page.tsx",
    "components/app/accept-terms-panel.tsx",
    "components/public/signup-form.tsx",
    "lib/legal/acceptance.ts",
    "lib/legal/queries.ts",
    "lib/legal/constants.ts",
  ];
  for (const file of customerFiles) {
    const source = read(file);
    assert.equal(readsDrafts(file, source), false, `${file} must never read a legal draft`);
    // Stricter here: a customer surface has no reason even to name the drafts table.
    assert.doesNotMatch(source, /legal_document_drafts|publish_legal_draft/, `${file} must not refer to legal drafts`);
  }
});

test("the drafts module is server-only and the admin route is super_admin for every write", () => {
  assert.match(read("lib/legal/admin.ts"), /^import "server-only";/);
  const route = read("app/api/admin/legal/route.ts");
  assert.match(route, /const CAN_PUBLISH_LEGAL = \["super_admin"\] as const;/);
  const guards = route.match(/requireAdminRole\(CAN_PUBLISH_LEGAL\)/g) ?? [];
  assert.equal(guards.length, 2, "GET (the live count) and POST (every write) are both super_admin only");
  for (const action of ["publish", "clear_reacceptance", "save_draft", "discard_draft", "publish_draft"]) {
    assert.match(route, new RegExp(`action: z\\.literal\\("${action}"\\)`), `${action} is still accepted`);
  }
});

test("the migration keeps drafts away from customer roles and read paths", () => {
  const sql = read("supabase/migrations/20260924363000_legal_document_drafts.sql");
  assert.match(sql, /revoke all on public\.legal_document_drafts from public, anon, authenticated, tenant_app;/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /pg_get_viewdef\('public\.current_legal_documents'::regclass\) ~ 'legal_document_drafts'/);
  assert.match(sql, /'public\.outstanding_legal_documents\(uuid\)'/);
  // Publishing a draft goes through the one insert path, and refuses a stale version.
  assert.match(sql, /from public\.publish_legal_document\(/);
  assert.match(sql, /v_next <> p_expected_version/);
  assert.match(sql, /v_draft\.updated_at <> p_expected_updated_at/);
});
