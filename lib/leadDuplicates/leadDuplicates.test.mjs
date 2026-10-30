/**
 * Same-phone leads reach Clean (owner 2026-10-29): "if you import the same file twice and accept the
 * leads anyway, the duplicates do not show up on Review or Clean. Any lead whose phone matches
 * another must land in the Review / Clean queue as a duplicate."
 *
 * The cause: Review's default for "already one of your leads" is attach, and the commit only added
 * the campaign as another source of the old lead. Clean reads contact pairs, and a lead is not a
 * contact, so nothing ever reached it. These pin the fix end to end.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { leadDisplayName, leadDuplicateDecisionError, leadFieldValue, LEAD_DUPLICATE_FIELDS } from "./types.ts";

// Some of these files are stored with CRLF (SQL-editor and Windows edits); the patterns read LF.
const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

test("the reviewed commit puts every attached row on Clean, with the row kept as a new lead", () => {
  const source = read("lib", "agentTemplates", "importPreflight.ts");
  const attachBranch = source.slice(source.indexOf("const existingId = existingByPhone.get(phone);"), source.indexOf("if (seenInFile.has(phone)) {", source.indexOf("const existingId = existingByPhone.get(phone);")));
  // Still attached (LA-2.20: one lead, many sources) …
  assert.match(attachBranch, /items\.push\(\{ lead_id: existingId/);
  // … and asked about, with the full new-lead item so "different person" can add it.
  assert.match(attachBranch, /const incoming = asNewLead\(\);/);
  assert.match(attachBranch, /sameNumber\.push\(\{ leadId: existingId, phone, incoming, campaignId, batchId: input\.batchId/);
  // Queued after the leads are committed, never before.
  assert.ok(source.indexOf("summary.sentToClean = await queueLeadDuplicates(") > source.indexOf("committed = await commitLeadImport("));
  // A skip is the person's own answer, so a skipped row is not asked about again.
  assert.match(attachBranch, /if \(input\.decisions\.existingLeads === "skip"\) \{ summary\.skippedDuplicates \+= 1; continue; \}\n[\s\S]*sameNumber\.push/);
});

test("the direct import queues its matched rows too", () => {
  const source = read("lib", "agentTemplates", "service.ts");
  assert.match(source, /if \(matchedId\) \{\n[^\n]*\n\s*sameNumber\.push\(\{ leadId: matchedId, phone: getUsPhone10Digits\(rawPhone\), incoming: inserts\[index\]/);
  assert.ok(source.indexOf("await queueLeadDuplicates(tenantId, sameNumber);") > source.indexOf("const committed = await commit("));
});

test("queueing never fails an import and is a no-op before the migration", () => {
  const source = read("lib", "leadDuplicates", "service.ts");
  const queue = source.slice(source.indexOf("export async function queueLeadDuplicates"), source.indexOf("function stripForStorage"));
  assert.match(queue, /if \(isMissingSchema\(inserted\.error\)\) return queued;/);
  assert.match(queue, /\} catch \(error\) \{\n\s*console\.error/);
  assert.doesNotMatch(queue, /throw /);
  // An answer is only taken once: the flip is conditional on pending.
  assert.match(source, /\.eq\("status", "pending"\)\.select\("id"\)/);
});

test("the migration adds the queue, read-only to tenant_app, with no delete", () => {
  const sql = read("supabase", "migrations", "20261029600000_lead_duplicate_reviews.sql");
  assert.match(sql, /create table if not exists public\.lead_duplicate_reviews/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke delete, truncate on public\.lead_duplicate_reviews from service_role;/);
  assert.match(sql, /grant select on public\.lead_duplicate_reviews to tenant_app;/);
  // A consumer deletion takes the questions with the lead (the number and the row's values are in them).
  assert.match(sql, /when \(new\.values \? '_erased' and not \(old\.values \? '_erased'\)\)/);
  // Leads that already share a number are backfilled, along the phone index's own expression.
  assert.match(sql, /insert into public\.lead_duplicate_reviews \(tenant_id, lead_id, other_lead_id, phone, created_at\)/);
  assert.match(sql, /right\(regexp_replace\(coalesce\(l\.values->>'phone', l\.values->>'phone_number', ''\), '\[\^0-9\]', '', 'g'\), 10\)/);
});

test("Clean shows them first and counts them on the tab and the rail", () => {
  const workspace = read("components", "app", "contact-workspace.tsx");
  assert.match(workspace, /<LeadDuplicateReview readOnly=\{writeBlocked\} onTotal=\{setSamePhone\} \/>/);
  assert.match(workspace, /count: current\.total \+ samePhone/);
  const counts = read("lib", "leadSources", "stepCounts.ts");
  assert.match(counts, /head\("lead_duplicate_reviews"\)\.eq\("tenant_id", t\)\.eq\("status", "pending"\)/);
  const policy = read("lib", "entitlements", "agentApiPolicy.ts");
  assert.match(policy, /app\/api\/app\/contacts\/lead-reviews\/route\.ts", featureKey: "duplicate_detection"/);
});

test("the comparison reads the import's field names", () => {
  assert.equal(leadDuplicateDecisionError("same_person"), null);
  assert.equal(leadDuplicateDecisionError("separate"), null);
  assert.ok(leadDuplicateDecisionError("merge"));
  assert.equal(leadDisplayName({ first_name: "Ana", last_name: "Ruiz" }), "Ana Ruiz");
  assert.equal(leadDisplayName({ full_name: "Ana M Ruiz", first_name: "Ana" }), "Ana M Ruiz");
  const dob = LEAD_DUPLICATE_FIELDS.find((field) => field.key === "dob");
  assert.equal(leadFieldValue({ date_of_birth: "1960-02-01" }, dob.keys), "1960-02-01");
});

test("Duplication is one tab: same-phone questions first, then the contact pairs; ?tab= opens a tab", () => {
  const workspace = read("components", "app", "contact-workspace.tsx");
  assert.match(workspace, /\{ key: "duplication", label: "Duplication", count: current\.total \+ samePhone \}/);
  assert.match(workspace, /\{ key: "missing", label: "Missing data", count: missingTotal \}/);
  assert.match(workspace, /\{ key: "contacts", label: "Contacts"/);
  assert.match(workspace, /tab === "duplication" && !samePhone && \(/);
  assert.match(workspace, /const TAB_KEYS: readonly TabKey\[\] = \["duplication", "missing", "contacts", "merges", "problems"\];/);
  const page = read("app", "app", "(shell)", "duplicates", "page.tsx");
  assert.match(page, /const initial = \{ tab: one\(query\.tab\), missing: one\(query\.missing\), campaign: one\(query\.campaign\) \};/);
});

test("Missing data saves through the lead edit, so a new phone is screened", () => {
  const service = read("lib", "leadDuplicates", "missingDataService.ts");
  assert.match(service, /await updateAgentLead\(tenantId, leadId, template, values, lead\.stage_id, userId\);/);
  // Never a direct write of values: the only agent_leads calls are reads.
  assert.doesNotMatch(service, /from\("agent_leads"\)[^;]*\.(update|upsert|insert)\(/);
  // Paged along (tenant_id, created_at desc, id desc), never by id alone.
  assert.match(service, /\.eq\("tenant_id", tenantId\)/);
  assert.match(service, /return query\.order\("created_at", \{ ascending: false \}\)\.order\("id", \{ ascending: false \}\);/);
  // A value the lead already has is never overwritten here.
  assert.match(service, /const existing = valueUnder\(lead\.values, meta\.keys\);\n\s*if \(existing\) \{\n[^\n]*\n\s*if \("value" in before && before\.value === checked\.value\) continue;\n\s*problem = `It already has a/);
  const policy = read("lib", "entitlements", "agentApiPolicy.ts");
  assert.match(policy, /app\/api\/app\/contacts\/missing-data\/route\.ts", featureKey: "duplicate_detection"/);
});

test("Missing data's values, filter and file round trip", async () => {
  const { normalizeMissingValue, missingOrFilter, missingDataCsv, parseMissingDataCsv } = await import("./missingData.ts");
  assert.deepEqual(normalizeMissingValue("phone", "+1 (305) 555-0119"), { value: "3055550119" });
  assert.ok("error" in normalizeMissingValue("phone", "555-0119"));
  assert.deepEqual(normalizeMissingValue("state", "oh"), { value: "OH" });
  assert.ok("error" in normalizeMissingValue("state", "XX"));
  assert.deepEqual(normalizeMissingValue("dob", "02/11/1958"), { value: "1958-02-11" });
  assert.ok("error" in normalizeMissingValue("dob", "02/30/1958"));
  assert.equal(missingOrFilter("state"), 'and(or(values->>state.is.null,values->>state.eq.""),or(values->>state_code.is.null,values->>state_code.eq.""))');
  assert.equal(missingOrFilter("any").split("and(").length - 1, 4);
  const id = "11111111-2222-3333-4444-555555555555";
  const csv = missingDataCsv([{ id, name: "=Ana Ortiz", campaignId: null, campaign: "Apex", phone: "3055550119", state: null, dob: null, address: "18 Bay St", editable: true }]);
  assert.match(csv, /^lead_id,name,phone,state,date_of_birth,address,campaign\r\n/);
  assert.match(csv, /"'=Ana Ortiz"/);
  const filled = csv.replace('"",""', '"FL","02/11/1958"');
  const parsed = parseMissingDataCsv(filled);
  assert.deepEqual(parsed.edits[id], { phone: "3055550119", state: "FL", dob: "1958-02-11", address: "18 Bay St" });
  assert.equal(parsed.names[id], "=Ana Ortiz");
  assert.throws(() => parseMissingDataCsv("name,phone\nAna,3055550119\n"), /lead_id/);
});

test("Clean says what to do next, and Missing data opens on the field that blocks calling (owner 2026-10-30)", async () => {
  const { firstMissing, MISSING_FIX_ORDER } = await import("./missingData.ts");
  assert.deepEqual(MISSING_FIX_ORDER, ["state", "phone", "dob", "address"]);
  assert.deepEqual(firstMissing({ phone: 9, state: 41, dob: 3, address: 0 }), { column: "state", count: 41 });
  assert.deepEqual(firstMissing({ phone: 9, state: 0, dob: 3, address: 0 }), { column: "phone", count: 9 });
  assert.deepEqual(firstMissing({ phone: null, state: null, dob: 3, address: null }), { column: "dob", count: 3 });
  assert.equal(firstMissing({ phone: 0, state: 0, dob: 0, address: 0 }), null);
  assert.equal(firstMissing(null), null);
  // The counts are head counts, tenant-scoped, and give up in time instead of timing the page out.
  const service = read("lib", "leadDuplicates", "missingDataService.ts");
  assert.match(service, /\.select\("id", \{ count: "exact", head: true \}\)\n\s*\.eq\("tenant_id", tenantId\)/);
  assert.match(service, /\.abortSignal\(AbortSignal\.timeout\(COUNT_BUDGET_MS\)\)/);
  const route = read("app", "api", "app", "contacts", "missing-data", "route.ts");
  assert.match(route, /params\.get\("counts"\) === "1"/);
  const workspace = read("components", "app", "contact-workspace.tsx");
  assert.match(workspace, /\{nextUp\}/);
  assert.match(workspace, /possible \{plural\(duplicatesWaiting, "duplicate", "duplicates"\)\} to confirm/);
  // No "Another lead form" chip: a link to the lead, with why in its tooltip; Save in the frame's corner.
  const missing = read("components", "app", "lead-missing-data.tsx");
  assert.doesNotMatch(missing, /Another lead form/);
  assert.match(missing, /<Link href=\{`\/app\/leads\/\$\{row\.id\}`\} title=\{NOT_HERE\}/);
  assert.match(missing, /<LeadsInSlot slot="continue">\{corner\}<\/LeadsInSlot>/);
  const page = read("app", "app", "(shell)", "duplicates", "page.tsx");
  assert.match(page, /<LeadsInPage step="clean" ownContinue>/);
});
