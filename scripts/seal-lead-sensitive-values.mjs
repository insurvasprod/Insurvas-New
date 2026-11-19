// Seals every plain-text SSN and bank number still stored on a lead (security review 2026-11, H-1 step 3).
//
//   npm run seal:lead-values             dry run: counts what would change, writes nothing
//   npm run seal:lead-values -- --apply  seals each plain value in place
//
// New and edited leads are sealed by the app already (lib/leadValues/seal.ts); this converts the rows
// written before. Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// APPLICATION_DATA_ENCRYPTION_KEY — the SAME key the deployed app has, or the deployed app cannot open
// what this seals. The script checks that first: it opens a ciphertext the app already wrote
// (an application's SSN, or a lead value the app sealed) and refuses --apply if that fails.
//
// Each lead is written only if every value it seals still holds the plain text read, so an agent
// editing the lead at the same moment is not overwritten. Safe to run again: sealed values are skipped.
//
// Also seals the rows held for duplicate review (lead_duplicate_reviews.incoming), and counts —
// without changing — plain values in the verification history, which is append-only by design.
import { createClient } from "@supabase/supabase-js";

import { decryptSensitive } from "../lib/applications/cryptoCore.ts";
import { hasUnsealedSensitive, isSealed, openLeadValue, sealLeadValues, sealedFieldKeys, shouldSealKey } from "../lib/leadValues/seal.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes("--apply");
const PAGE = 1000;

if (!url || !serviceKey || !process.env.APPLICATION_DATA_ENCRYPTION_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or APPLICATION_DATA_ENCRYPTION_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// ── 1. Is this the deployed app's key? ─────────────────────────────────────────────────────────────
async function keyCheck() {
  const app = await db.from("tenant_application_values").select("tenant_id, application_id, field_key, value_ciphertext, key_version").not("value_ciphertext", "is", null).limit(5);
  if (app.error) return { ok: false, detail: `could not read an application ciphertext: ${app.error.message}` };
  for (const row of app.data ?? []) {
    const opened = decryptSensitive(row.value_ciphertext, row.key_version, { tenantId: row.tenant_id, applicationId: row.application_id, fieldKey: row.field_key });
    if (opened !== null) return { ok: true, detail: "opened an application value the app encrypted" };
  }
  return { ok: false, detail: app.data?.length ? "none of 5 application ciphertexts opens with this key" : "no application ciphertext to test the key against" };
}
const key = await keyCheck();
console.log(`Key check: ${key.ok ? "OK" : "FAILED"} (${key.detail})`);
if (apply && !key.ok) {
  console.error("Refusing --apply: this key may not be the deployed app's key. Run with the production APPLICATION_DATA_ENCRYPTION_KEY.");
  process.exit(1);
}

// ── 2. Which template fields are typed SSN or bank (whatever they are called) ───────────────────────
const typedByTemplate = new Map();
{
  const fields = await db.from("tenant_template_fields").select("tenant_template_id, field_key, type").in("type", ["ssn", "bank_routing", "bank_account"]);
  if (fields.error) { console.error("Could not read template fields:", fields.error.message); process.exit(1); }
  for (const field of fields.data ?? []) {
    const list = typedByTemplate.get(field.tenant_template_id) ?? [];
    list.push(field);
    typedByTemplate.set(field.tenant_template_id, list);
  }
}

// ── 3. Leads, tenant by tenant (ordering by id alone walks every tenant: see the memory note) ───────
const tenants = await db.from("tenants").select("id").order("id");
if (tenants.error) { console.error("Could not read tenants:", tenants.error.message); process.exit(1); }

const totals = { leads: 0, plain: 0, sealedNow: 0, changed: 0, failed: 0, unreadable: 0 };
for (const { id: tenantId } of tenants.data ?? []) {
  for (let from = 0; ; from += PAGE) {
    const page = await db.from("agent_leads").select("id, tenant_template_id, values").eq("tenant_id", tenantId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (page.error) { console.error(`  tenant ${tenantId}: could not read leads: ${page.error.message}`); process.exitCode = 1; break; }
    for (const lead of page.data ?? []) {
      totals.leads += 1;
      const fields = typedByTemplate.get(lead.tenant_template_id) ?? [];
      const values = lead.values ?? {};
      for (const [k, v] of Object.entries(values)) if (isSealed(v) && openLeadValue(tenantId, k, v) === null) totals.unreadable += 1;
      if (!hasUnsealedSensitive(values, fields)) continue;
      totals.plain += 1;
      if (!apply) continue;
      const sealed = sealLeadValues(tenantId, values, fields);
      const typed = sealedFieldKeys(fields);
      // Written only while every value being sealed still holds what was read.
      let query = db.from("agent_leads").update({ values: sealed }).eq("tenant_id", tenantId).eq("id", lead.id);
      for (const [k, v] of Object.entries(values)) {
        if (shouldSealKey(k, typed) && sealed[k] !== v) query = query.eq(`values->>${k}`, String(v));
      }
      const { data: updated, error } = await query.select("id");
      if (error) { totals.failed += 1; console.error(`  lead ${lead.id}: ${error.message}`); process.exitCode = 1; continue; }
      if (!updated?.length) { totals.changed += 1; continue; }
      totals.sealedNow += 1;
    }
    if (!page.data || page.data.length < PAGE) break;
  }
}
console.log(`${totals.leads} lead(s) read: ${totals.plain} hold a plain SSN or bank value${apply ? `, ${totals.sealedNow} sealed now, ${totals.changed} changed while this ran (run again), ${totals.failed} failed` : " (dry run, nothing written; pass --apply)"}.`);
if (totals.unreadable) console.warn(`${totals.unreadable} sealed value(s) do not open with this key.`);

// ── 4. Rows held for duplicate review ───────────────────────────────────────────────────────────────
{
  const held = await db.from("lead_duplicate_reviews").select("id, tenant_id, incoming").not("incoming", "is", null);
  if (held.error) console.warn(`Duplicate review rows not checked: ${held.error.message}`);
  else {
    let plain = 0, sealedNow = 0;
    for (const row of held.data ?? []) {
      const values = row.incoming?.values;
      if (!hasUnsealedSensitive(values)) continue;
      plain += 1;
      if (!apply) continue;
      const { error } = await db.from("lead_duplicate_reviews").update({ incoming: { ...row.incoming, values: sealLeadValues(row.tenant_id, values) } }).eq("id", row.id).eq("tenant_id", row.tenant_id);
      if (error) { console.error(`  duplicate review ${row.id}: ${error.message}`); process.exitCode = 1; } else sealedNow += 1;
    }
    console.log(`Duplicate review rows: ${plain} hold a plain SSN or bank value${apply ? `, ${sealedNow} sealed now` : ""}.`);
  }
}

// ── 5. Verification history: counted, not changed ───────────────────────────────────────────────────
for (const table of ["verification_fields", "verification_field_changes"]) {
  const rows = await db.from(table).select("field_key, old_value, new_value").limit(50000);
  if (rows.error) { console.warn(`${table} not checked: ${rows.error.message}`); continue; }
  const plain = (rows.data ?? []).filter((row) => shouldSealKey(row.field_key) && [row.old_value, row.new_value].some((v) => (typeof v === "string" || typeof v === "number") && String(v).trim() && !isSealed(v) && !/^[•*]/.test(String(v).trim()))).length;
  console.log(`${table}: ${plain} row(s) hold a plain SSN or bank value (not changed by this script).`);
}
