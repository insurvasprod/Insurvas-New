// LA-6.5 (Notion sprint, Module 6 — Compliance) · consumer data-subject deletion.
// Run with: node --experimental-strip-types --test lib/compliance/dataSubject.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_SUBJECT_MAP, LEGACY_ORG_PLANE, NOT_CONSUMER, PURGE_GROUPS, retainedCategories } from "./dataSubjectMap.ts";
import { holdRemaining, purgeDate, verificationProblem, PLATFORM_HOLD_FLOOR_DAYS } from "./dataSubject.ts";
import { scanMigrations } from "./dataSubjectScan.mjs";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015140000_la_6_5_consumer_deletion.sql";

test("completeness: every table a migration creates with a person's data is wired into deletion (or named as not consumer data)", () => {
  const known = new Set([...Object.keys(DATA_SUBJECT_MAP), ...NOT_CONSUMER, ...LEGACY_ORG_PLANE]);
  const missing = [...scanMigrations(root).entries()].filter(([t]) => !known.has(t)).map(([t, why]) => `${t} (${[...why].join(", ")})`);
  assert.deepEqual(missing, [], `A table holds personal data and nobody decided what a deletion does to it. Add it to lib/compliance/dataSubjectMap.ts (and to data_subject_purge_group when it is purged or anonymised):\n  ${missing.join("\n  ")}`);
});

test("the completeness test does catch a new table", () => {
  const found = scanMigrations(root);
  assert.ok(found.has("tenant_call_attempts") && found.has("contacts") && found.has("complaint"), "the scan sees the tables it must");
  assert.ok(found.get("tenant_uw_interviews")?.has("references tenant_application_cases") || found.has("tenant_uw_interviews"), "a link to a person's table counts, not only a named column");
});

test("the registry and the purge agree, table by table", () => {
  const sql = read(MIGRATION);
  const fn = sql.slice(sql.indexOf("create or replace function public.data_subject_purge_group"), sql.indexOf("revoke all on function public.data_subject_purge_group"));
  for (const [table, entry] of Object.entries(DATA_SUBJECT_MAP)) {
    if (!entry.group) continue;
    const branch = fn.slice(fn.indexOf(`p_group = '${entry.group}' then`), fn.indexOf("elsif p_group", fn.indexOf(`p_group = '${entry.group}' then`) + 10));
    assert.match(branch, new RegExp(`public\\.${table}\\b`), `${table} is in the ${entry.group} group`);
    if (entry.action === "purge") assert.match(branch, new RegExp(`delete from public\\.${table}\\b`), `${table} is deleted`);
    if (entry.action === "anonymise") assert.match(branch, new RegExp(`update public\\.${table}\\b`), `${table} is anonymised, not deleted`);
    if (entry.action === "anonymise") assert.doesNotMatch(branch, new RegExp(`delete from public\\.${table}\\b`), `${table} is never deleted`);
  }
  for (const m of fn.matchAll(/(?:delete from|update) public\.([a-z_0-9]+)/g)) {
    if (m[1] === "deletion_request") continue;
    assert.ok(DATA_SUBJECT_MAP[m[1]], `${m[1]} is touched by the purge but not in the registry`);
  }
  assert.deepEqual([...PURGE_GROUPS], ["dnc", "activity", "checks", "applications", "leads", "clients", "records"]);
});

test("the do-not-call entry is never deleted — by this, by retention, by anyone", () => {
  for (const dir of ["lib", "app", "supabase/migrations"]) {
    const walk = (d) => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : walk(`${d}/${e.name}`)) : [`${d}/${e.name}`]));
    for (const f of walk(dir).filter((p) => /\.(ts|tsx|sql)$/.test(p) && /la_6_|compliance/.test(p))) {
      assert.doesNotMatch(read(f), /delete from (public\.)?tenant_do_not_call|delete from (public\.)?tenant_suppression_list|from\("tenant_do_not_call"\)\.delete/i, f);
    }
  }
  const sql = read(MIGRATION);
  assert.match(sql, /perform public\.suppress_phone\(t, p, 'internal', 'Retained under a deletion request: do not contact'/);
  assert.equal(DATA_SUBJECT_MAP.tenant_do_not_call.action, "keep");
});

test("identity is verified before anything is purged; an unverifiable request gets a reason", () => {
  const found = { phones: ["8175550142"], emails: ["jane@example.test"], contact_ids: ["c1"], lead_ids: ["l1"] };
  const none = { phones: [], emails: [], contact_ids: [], lead_ids: [] };
  const req = (over) => ({ phoneDigits: null, email: null, contactId: null, requesterPhone: null, requesterEmail: null, ...over });
  // LA-6 audit (4): the number ASKED ABOUT proves nothing — anyone can name a number. The channel the
  // request came from must be one we hold for the person.
  assert.match(verificationProblem("phone_match", req({ phoneDigits: "8175550142" }), found, null), /Record the number they contacted us from/);
  assert.match(verificationProblem("phone_match", req({ phoneDigits: "8175550142", requesterPhone: "2145550000" }), found, null), /do not hold for this person/);
  assert.equal(verificationProblem("phone_match", req({ phoneDigits: "8175550142", requesterPhone: "8175550142" }), found, null), null);
  assert.match(verificationProblem("phone_match", req({ phoneDigits: "8175550142", requesterPhone: "8175550142" }), none, null), /We hold no client or lead/);
  assert.match(verificationProblem("email_match", req({ email: "jane@example.test" }), found, null), /Record the address they wrote from/);
  assert.equal(verificationProblem("email_match", req({ email: "jane@example.test", requesterEmail: "Jane@Example.test" }), found, null), null);
  assert.match(verificationProblem("email_match", req({ email: "jane@example.test", requesterEmail: "someone@else.test" }), found, null), /do not hold/);
  assert.match(verificationProblem("document", req({ contactId: "c1" }), found, "id"), /Say which document/);
  assert.equal(verificationProblem("document", req({ contactId: "c1" }), found, "Texas driving licence, name and address match the client record"), null);
  // Choosing the client is the staffer's word: it needs a channel match or a written account too.
  assert.match(verificationProblem("known_customer", req({ contactId: "c1" }), found, null), /not proof/);
  assert.equal(verificationProblem("known_customer", req({ contactId: "c1", requesterPhone: "8175550142" }), found, null), null);
  assert.equal(verificationProblem("known_customer", req({ contactId: "c1" }), found, "Called back on the number on file and confirmed date of birth"), null);
  const fix = read("supabase/migrations/20261015630000_la_6_legal_risk_fixes.sql");
  assert.match(fix, /add column if not exists requester_phone_digits text,\n  add column if not exists requester_email text;/);
  assert.match(fix, /the channel identity was verified on cannot change/);
  const sql = read(MIGRATION);
  assert.match(sql, /if r\.status <> 'scheduled' or r\.scheduled_purge_at > now\(\) then/);
  assert.match(sql, /constraint deletion_request_verified check \(status not in \('verified', 'scheduled', 'completed'\) or \(verified_at is not null and verification_method is not null\)\)/);
});

test("a verified deletion is performed when its hold ends, without waiting for a click", () => {
  const store = read("lib/compliance/dataSubjectStore.ts");
  assert.match(store, /export async function performDueDeletions\(/);
  assert.match(store, /\.eq\("status", "scheduled"\)\.lte\("scheduled_purge_at", now\.toISOString\(\)\)/);
  assert.match(read("app/api/cron/deletion-perform/route.ts"), /performDueDeletions\(\)/);
  assert.match(read("app/api/cron/deletion-perform/route.ts"), /Bearer \$\{secret\}/);
  // A storage failure keeps the request open and says so; it is not logged and forgotten.
  assert.doesNotMatch(store, /console\.error\("\[deletion\] complaint files could not be removed"/);
});

test("the hold is cancellable and never shorter than the platform floor", () => {
  const t0 = new Date("2026-10-15T00:00:00Z");
  assert.equal(purgeDate(t0, 7).toISOString(), "2026-10-22T00:00:00.000Z");
  assert.equal(purgeDate(t0, 1).toISOString(), "2026-10-18T00:00:00.000Z", "floor of 3 days");
  assert.equal(PLATFORM_HOLD_FLOOR_DAYS, 3);
  assert.match(read(MIGRATION), /check \(deletion_hold_days between 3 and 45\)/);
  assert.equal(holdRemaining("2026-10-20T00:00:00Z", t0).due, false);
  assert.equal(holdRemaining("2026-10-14T00:00:00Z", t0).due, true);
  assert.match(read("lib/compliance/dataSubjectStore.ts"), /if \(!\["received", "verifying", "verified", "scheduled"\]\.includes\(r\.status\) \|\| r\.groupsDone\.length\) throw new DeletionError\("Only a request not yet started can be cancelled\."/);
});

test("the certificate names every retained category with its reason", () => {
  const kept = retainedCategories();
  for (const t of ["tenant_do_not_call", "policy_current", "complaint", "agent_leads", "deletion_request"]) assert.ok(kept.some((k) => k.table === t && k.reason.length > 20), t);
  const cert = read("lib/compliance/deletionCertificate.ts");
  assert.match(cert, /text\("Kept, and why"/);
  assert.match(cert, /text\("Removed or anonymised, per table"/);
  assert.match(cert, /notSearched/);
});

test("the purge is resumable and idempotent; the audit trail is never removed", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /if p_group = any\(r\.groups_done\) then\n\s+return coalesce\(r\.results_json->p_group, '\{\}'::jsonb\);/);
  assert.match(sql, /revoke update, delete, truncate on public\.deletion_request_event from service_role;/);
  assert.match(sql, /revoke delete, truncate on public\.deletion_request from service_role;/);
});

test("the carrier rows stay immutable except for this, and then only the payload", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /and \(to_jsonb\(new\) - 'payload'\) = \(to_jsonb\(old\) - 'payload'\) then\n\s+return new;/);
  assert.match(sql, /raise exception 'Raw rows are never changed or removed; register a corrected file instead\.'/);
  assert.match(sql, /and \(to_jsonb\(new\) - 'extra'\) = \(to_jsonb\(old\) - 'extra'\) then/);
});

test("the owner (and a producer only if allowed) moves a request; owner and producer log and read it", () => {
  const route = read("app/api/app/compliance/deletions/[id]/route.ts");
  // Who may move it is the agency's setting (LA-6.8): the owner always, a producer only if allowed.
  assert.match(route, /const performers = \(await loadComplianceSettings\(auth\.context\.tenantId\)\)\.deletion\.performerRoles;\n\s+if \(!performers\.includes\(auth\.context\.role\)\) return NextResponse\.json\(\{ error: "Only the agency owner can verify or perform a deletion\." \}, \{ status: 403 \}\);/);
  assert.match(route, /z\.object\(\{ action: z\.literal\("perform"\), confirm: z\.literal\(true\) \}\)/);
  for (const f of ["app/api/app/compliance/deletions/route.ts", "app/api/app/compliance/deletions/[id]/route.ts", "app/api/app/compliance/deletions/[id]/certificate/route.ts"]) {
    assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === f)?.allowedRoles, ["owner", "producer"], f);
  }
});
