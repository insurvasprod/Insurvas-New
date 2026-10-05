import "./lib/refuseProduction.mjs";
// LA-1.24 live contract checks. Run with: npm run verify:existing-customer-preflight
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const tenantId = randomUUID(); const otherTenantId = randomUUID(); const stamp = Date.now(); let failures = 0;
const contactId = randomUUID(); const otherContactId = randomUUID(); const alternatePhoneId = randomUUID();
const leadIds = [randomUUID(), randomUUID()]; const partnerIds = [randomUUID(), randomUUID()]; let leadAuthorId = null;
const check = (label, condition, detail = "") => { if (condition) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } };
async function cleanup() {
  await db.from("agent_leads").delete().in("id", leadIds);
  await db.from("partners").delete().in("id", partnerIds);
  await db.from("contact_phones").delete().in("id", [alternatePhoneId]);
  // By tenant, not by id: the scale check below inserts 20,000 rows and listing their ids here would
  // not survive a crash between insert and cleanup.
  await db.from("contacts").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("tenants").delete().in("id", [tenantId, otherTenantId]);
  if (leadAuthorId) await deleteFixtureUser(db, leadAuthorId);
}
async function main() {
  await cleanup();
  try {
    let result = await db.from("tenants").insert([{ id: tenantId, name: `LA-1.24 preflight ${stamp}`, status: "active" }, { id: otherTenantId, name: `LA-1.24 isolated ${stamp}`, status: "active" }]);
    if (result.error) throw new Error(result.error.message);
    result = await db.from("contacts").insert([
      { id: contactId, tenant_id: tenantId, first_name: "John", last_name: "Smith", dob: "1959-03-14", primary_phone: "6025550101", state: "AZ", name_search: "johnsmith", custom_fields: {} },
      { id: otherContactId, tenant_id: otherTenantId, first_name: "John", last_name: "Smith", dob: "1959-03-14", primary_phone: "4805550102", state: "AZ", name_search: "johnsmith", custom_fields: {} },
    ]);
    if (result.error) throw new Error(result.error.message);
    result = await db.from("contact_phones").insert({ id: alternatePhoneId, tenant_id: tenantId, contact_id: contactId, phone: "4805550102", type: "landline", is_primary: false });
    if (result.error) throw new Error(result.error.message);
    const contactMatch = await db.rpc("find_existing_customer_preflight", { p_tenant_id: tenantId, p_full_name: "johnsmyth", p_dob: "1959-03-14", p_phone_digits: "4805550102", p_address_search: null, p_exclude_lead_id: null, p_limit: 20 });
    check("alternate phone and misspelled surname match the household contact", !contactMatch.error && contactMatch.data?.some((row) => row.contact_id === contactId && row.matched_on.includes("phone")), contactMatch.error?.message);
    check("cross-tenant contact is never returned", !(contactMatch.data ?? []).some((row) => row.contact_id === otherContactId));
    const missing = await db.rpc("find_existing_customer_preflight", { p_tenant_id: tenantId, p_full_name: null, p_dob: null, p_phone_digits: null, p_address_search: null, p_exclude_lead_id: null, p_limit: 20 });
    check("missing identity fields fail closed without scanning a tenant", !missing.error && (missing.data ?? []).length === 0, missing.error?.message);
    const hostile = await db.rpc("find_existing_customer_preflight", { p_tenant_id: tenantId, p_full_name: "<script>alert(1)</script>", p_dob: null, p_phone_digits: null, p_address_search: "' or 1=1 --", p_exclude_lead_id: null, p_limit: 20 });
    check("hostile identity input is treated as data", !hostile.error && !(hostile.data ?? []).some((row) => row.contact_id === otherContactId), hostile.error?.message);
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => db.rpc("find_existing_customer_preflight", { p_tenant_id: tenantId, p_full_name: "johnsmyth", p_dob: "1959-03-14", p_phone_digits: "4805550102", p_address_search: null, p_exclude_lead_id: null, p_limit: 20 })));
    check("concurrent pre-flight checks return the same tenant-scoped result", concurrent.every((item) => !item.error && item.data?.some((row) => row.contact_id === contactId) && !(item.data ?? []).some((row) => row.contact_id === otherContactId)));

    // The lead evidence lives in this suite's own fixture tenant. It used to borrow whichever tenant
    // owned the first agent_leads row in the database -- writing partners and leads into a real
    // tenant, and (when that was the 200k-row load-test tenant) timing the lookup out.
    ({ userId: leadAuthorId } = await createFixtureUser(db, { email: `la124-author-${stamp}@invalid.test`, name: "LA-1.24 author" }));
    const pipeline = await db.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single();
    const stage = pipeline.data ? await db.from("tenant_pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("is_archived", false).order("position").limit(1).single() : { data: null, error: new Error("no default pipeline") };
    const template = await db.from("templates").select("id").eq("product_code", "term_life").eq("is_active", true).limit(1).single();
    if (pipeline.error || stage.error || template.error) throw new Error(pipeline.error?.message ?? stage.error?.message ?? template.error?.message ?? "Fixture dependency missing");
    const base = { data: { tenant_id: tenantId, template_id: template.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data.id, stage_id: stage.data.id, created_by: leadAuthorId } };
    result = await db.from("partners").insert(partnerIds.map((id, index) => ({ slug: `fx-${Math.random().toString(36).slice(2, 10)}`, id, tenant_id: base.data.tenant_id, name: `LA-1.24 partner ${stamp}-${index}`, partner_type: "publisher", status: "active", country: "US", timezone: "America/Phoenix" })));
    if (result.error) throw new Error(result.error.message);
    result = await db.from("agent_leads").insert(leadIds.map((id, index) => ({ id, tenant_id: base.data.tenant_id, template_id: base.data.template_id, template_version: base.data.template_version, product_line: base.data.product_line, pipeline_id: base.data.pipeline_id, stage_id: base.data.stage_id, created_by: base.data.created_by, partner_id: partnerIds[index], submission_id: randomUUID(), values: { full_name: "Repeat Customer", date_of_birth: "1959-03-14", phone: `60255500${70 + index}`, outcome: "sold" } })));
    if (result.error) throw new Error(result.error.message);
    const inserted = await db.from("agent_leads").select("id, values, tenant_id").in("id", leadIds);
    if (inserted.error) throw new Error(inserted.error.message);
    const leadMatch = await db.rpc("find_existing_customer_preflight", { p_tenant_id: base.data.tenant_id, p_full_name: "repeat customer", p_dob: "1959-03-14", p_phone_digits: "6025550070", p_address_search: null, p_exclude_lead_id: randomUUID(), p_limit: 20 });
    const matchedLeads = (leadMatch.data ?? []).filter((row) => leadIds.includes(row.lead_id));
    check("two sold leads from two partners are returned distinctly", !leadMatch.error && inserted.data?.length === 2 && matchedLeads.length === 2 && new Set(matchedLeads.map((row) => row.partner_id)).size === 2 && matchedLeads.every((row) => row.outcome === "sold"), leadMatch.error?.message ?? JSON.stringify({ inserted: inserted.data, matches: leadMatch.data }));
    const stored = { status: "already_customer", policy_matching_included: false, policy_matching_note: "Policy matching is not included yet; this check covers prior leads and contacts only.", matches: matchedLeads };
    result = await db.from("agent_leads").update({ preflight_status: "already_customer", preflight_checked_at: new Date().toISOString(), preflight_result: stored }).eq("id", leadIds[0]).select("preflight_status, preflight_checked_at, preflight_result").single();
    check("the result is stored on the lead with the policy disclaimer", !result.error && result.data?.preflight_status === "already_customer" && result.data.preflight_result?.policy_matching_included === false, result.error?.message);
    const started = performance.now();
    const timed = await db.rpc("find_existing_customer_preflight", { p_tenant_id: tenantId, p_full_name: "johnsmyth", p_dob: "1959-03-14", p_phone_digits: "4805550102", p_address_search: null, p_exclude_lead_id: null, p_limit: 20 });
    check("pre-flight RPC responds under 500ms", !timed.error && performance.now() - started < 500, `${(performance.now() - started).toFixed(1)}ms ${timed.error?.message ?? ""}`);

    // Criterion 3 is "the check completes in under 500ms AGAINST 20,000 CONTACTS". The timing above
    // runs against the two fixture rows, which measures a round trip and nothing about the query. The
    // scale is the criterion -- the task's reason for it is that this runs while a customer is
    // waiting, and an index that is fine at two rows is exactly the kind of thing that is not fine at
    // twenty thousand.
    const bulk = Array.from({ length: 20000 }, (_, index) => ({
      id: randomUUID(), tenant_id: tenantId,
      first_name: `Load${index}`, last_name: `Prospect${index}`,
      dob: "1970-06-15", primary_phone: `9${String(100000000 + index).slice(0, 9)}`,
      state: "AZ", name_search: `load${index}prospect${index}`, custom_fields: {},
    }));
    for (let offset = 0; offset < bulk.length; offset += 1000) {
      const inserted = await db.from("contacts").insert(bulk.slice(offset, offset + 1000));
      if (inserted.error) throw new Error(`bulk contact insert failed at ${offset}: ${inserted.error.message}`);
    }
    const contactCount = await db.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const scaleStarted = performance.now();
    const atScale = await db.rpc("find_existing_customer_preflight", { p_tenant_id: tenantId, p_full_name: "johnsmyth", p_dob: "1959-03-14", p_phone_digits: "4805550102", p_address_search: null, p_exclude_lead_id: null, p_limit: 20 });
    const scaleMs = performance.now() - scaleStarted;
    // Still the right answer, not merely a fast one: a query that got quick by stopping early would
    // pass a timing check alone.
    check("the pre-flight check answers in under 500ms against 20,000 contacts", !atScale.error && scaleMs < 500 && (contactCount.count ?? 0) >= 20000 && atScale.data?.some((row) => row.contact_id === contactId), `${scaleMs.toFixed(1)}ms across ${contactCount.count ?? 0} contacts, matched ${atScale.data?.length ?? 0}${atScale.error ? ` — ${atScale.error.message}` : ""}`);

    // Criterion 5 is "the UI states plainly that policy matching is not yet included". The stored
    // disclaimer asserted above is the record, not the statement -- it proves the payload carries the
    // caveat, not that anyone reading the screen is told. The workspace renders preflight.policyMatchingNote
    // unconditionally alongside the result; guard it so it fails the day it is dropped.
    const workspaceSource = await readFile("components/app/lead-detail-workspace.tsx", "utf8");
    check("the workspace states plainly that policy matching is not included", /policyMatchingNote/.test(workspaceSource), "the workspace no longer renders the policy-matching caveat");
    const unauthenticated = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/app/leads/${randomUUID()}/preflight`, { method: "POST" });
    check("unauthenticated manual re-check is rejected", unauthenticated.status === 401, `status ${unauthenticated.status}`);
  } finally { await cleanup(); }
  if (failures) return 1; console.log("\nAll live existing-customer pre-flight checks passed."); return 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
