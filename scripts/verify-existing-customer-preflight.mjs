// LA-1.24 live contract checks. Run with: npm run verify:existing-customer-preflight
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const tenantId = randomUUID(); const otherTenantId = randomUUID(); const stamp = Date.now(); let failures = 0;
const contactId = randomUUID(); const otherContactId = randomUUID(); const alternatePhoneId = randomUUID();
const leadIds = [randomUUID(), randomUUID()]; const partnerIds = [randomUUID(), randomUUID()];
const check = (label, condition, detail = "") => { if (condition) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } };
async function cleanup() {
  await db.from("agent_leads").delete().in("id", leadIds);
  await db.from("partners").delete().in("id", partnerIds);
  await db.from("contact_phones").delete().in("id", [alternatePhoneId]);
  await db.from("contacts").delete().in("id", [contactId, otherContactId]);
  await db.from("tenants").delete().in("id", [tenantId, otherTenantId]);
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

    const base = await db.from("agent_leads").select("tenant_id, template_id, template_version, tenant_template_id, definition_version, product_line, pipeline_id, stage_id, created_by").limit(1).maybeSingle();
    if (base.error || !base.data) throw new Error(base.error?.message ?? "No base lead available for lead evidence check");
    result = await db.from("partners").insert(partnerIds.map((id, index) => ({ id, tenant_id: base.data.tenant_id, name: `LA-1.24 partner ${stamp}-${index}`, partner_type: "publisher", status: "active", country: "US", timezone: "America/Phoenix" })));
    if (result.error) throw new Error(result.error.message);
    result = await db.from("agent_leads").insert(leadIds.map((id, index) => ({ id, tenant_id: base.data.tenant_id, template_id: base.data.template_id, template_version: base.data.template_version, tenant_template_id: base.data.tenant_template_id, definition_version: base.data.definition_version, product_line: base.data.product_line, pipeline_id: base.data.pipeline_id, stage_id: base.data.stage_id, created_by: base.data.created_by, partner_id: partnerIds[index], submission_id: randomUUID(), values: { full_name: "Repeat Customer", date_of_birth: "1959-03-14", phone: `60255500${70 + index}`, outcome: "sold" } })));
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
    const unauthenticated = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/app/leads/${randomUUID()}/preflight`, { method: "POST" });
    check("unauthenticated manual re-check is rejected", unauthenticated.status === 401, `status ${unauthenticated.status}`);
  } finally { await cleanup(); }
  if (failures) return 1; console.log("\nAll live existing-customer pre-flight checks passed."); return 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
