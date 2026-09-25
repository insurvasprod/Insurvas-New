// LA-1.4 lead CSV import live contract checks. Fixtures are disposable and removed in finally.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
const otherTenantId = randomUUID();
let ownerId = null;
let otherOwnerId = null;
let bookkeeperId = null;
let copyId = null;
const vendorIds = [];
let failures = 0;

const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function token(userId, tenant = tenantId, secret = process.env.TENANT_SESSION_SECRET) { return new SignJWT({ tenantId: tenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret)); }
const cookie = (value) => `insurvas_tenant_session=${value}`;
async function api(path, session, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: session, ...(options.headers ?? {}) }, redirect: "manual" }); }

function startVendorSimulator() {
  const server = createServer((request, response) => {
    request.on("data", () => {});
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if ((request.url ?? "").includes("litigator")) response.end(JSON.stringify({ hit: false }));
      else if ((request.url ?? "").includes("dnc")) response.end(JSON.stringify({ listed: false }));
      else { response.statusCode = 404; response.end(JSON.stringify({ error: "unknown simulator route" })); }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

function valueFor(field, index) {
  if (["number", "currency"].includes(field.type)) return field.type === "currency" ? 10000 + index : 10 + index;
  if (field.type === "date") return "1980-01-02";
  if (field.type === "phone") return `602555${String(1000 + index).padStart(4, "0")}`;
  if (field.type === "email") return `import-${index}@example.com`;
  if (field.type === "ssn") return `123456${String(700 + index).padStart(3, "0")}`;
  if (field.type === "boolean") return true;
  if (field.type === "single_select") return field.options[0] ?? "Option";
  if (field.type === "multi_select") return field.options.slice(0, 2);
  return `CSV import ${index}`;
}

function valuesFor(template, index) {
  const required = new Set(template.form_definition.sections.flatMap((section) => section.fields.filter((field) => field.is_required).map((field) => field.field_key)));
  return Object.fromEntries(template.fields.filter((field) => field.is_required || required.has(field.field_key)).map((field, fieldIndex) => [field.field_key, valueFor(field, index + fieldIndex)]));
}

async function cleanup() {
  for (const id of [tenantId, otherTenantId]) {
    const leads = await db.from("agent_leads").select("id").eq("tenant_id", id);
    const leadIds = (leads.data ?? []).map((row) => row.id);
    for (const table of ["lead_notifications", "lead_queue", "deal_flow", "agent_leads"]) {
      if (leadIds.length) await db.from(table).delete().in("lead_id", leadIds);
      else await db.from(table).delete().eq("tenant_id", id);
    }
    await db.from("audit_log").delete().in("actor_id", [ownerId, otherOwnerId, bookkeeperId]);
    await db.from("tenant_templates").delete().eq("tenant_id", id);
    await db.from("tenant_entitlements").delete().eq("tenant_id", id);
    await db.from("subscriptions").delete().eq("tenant_id", id);
    await db.from("tenant_users").delete().eq("tenant_id", id);
    for (const id of [ownerId, otherOwnerId, bookkeeperId]) await deleteFixtureUser(db, id);
    await db.from("tenants").delete().eq("id", id);
  }
  if (vendorIds.length) await db.from("compliance_vendors").delete().in("id", vendorIds);
}

async function main() {
  await cleanup();
  const simulator = await startVendorSimulator();
  const tenant = await db.from("tenants").insert([{ id: tenantId, name: `LA14 import ${stamp}`, status: "active", onboarding_state: "completed" }, { id: otherTenantId, name: `LA14 import other ${stamp}`, status: "active", onboarding_state: "completed" }]);
  if (tenant.error) throw new Error(tenant.error.message);
  ({ userId: ownerId } = await createFixtureUser(db, { email: `la14-import-owner-${stamp}@invalid.test`, name: "LA-1.4 import owner" }));
  ({ userId: otherOwnerId } = await createFixtureUser(db, { email: `la14-import-other-${stamp}@invalid.test`, name: "LA-1.4 other owner" }));
  ({ userId: bookkeeperId } = await createFixtureUser(db, { email: `la14-import-bookkeeper-${stamp}@invalid.test`, name: "LA-1.4 import bookkeeper" }));
  const members = await db.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" }, { tenant_id: tenantId, user_id: bookkeeperId, role: "bookkeeper" }]);
  if (members.error) throw new Error(members.error.message);
  const plan = await db.from("plans").select("id").eq("code", "advance").eq("version", 1).single();
  if (plan.error) throw new Error(plan.error.message);
  for (const id of [tenantId, otherTenantId]) {
    const subscription = await db.rpc("admin_assign_subscription", { p_tenant_id: id, p_plan_id: plan.data.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() });
    if (subscription.error) throw new Error(subscription.error.message);
    const entitlement = await db.rpc("refresh_tenant_entitlement", { p_tenant_id: id });
    if (entitlement.error) throw new Error(entitlement.error.message);
  }
  const endpoint = `http://127.0.0.1:${simulator.port}`;
  const vendors = await db.from("compliance_vendors").insert([
    { name: `000-LA14 litigator ${stamp}`, vendor_type: "litigator_scrub", endpoint: `${endpoint}/litigator`, is_enabled: true, priority: 0, cost_per_lookup_cents: 1 },
    { name: `000-LA14 dnc ${stamp}`, vendor_type: "dnc_scrub", endpoint: `${endpoint}/dnc`, is_enabled: true, priority: 0, cost_per_lookup_cents: 1 },
  ]).select("id");
  if (vendors.error) throw new Error(vendors.error.message);
  vendorIds.push(...(vendors.data ?? []).map((row) => row.id));
  const owner = cookie(await token(ownerId));
  const otherOwner = cookie(await token(otherOwnerId, otherTenantId));
  const bookkeeper = cookie(await token(bookkeeperId));
  try {
    check("missing and forged sessions are rejected", (await api("/api/app/leads/import", "")).status === 401 && (await api("/api/app/leads/import", cookie(await token(ownerId, tenantId, `${process.env.TENANT_SESSION_SECRET}-wrong`)))).status === 401);
    check("wrong tenant role is rejected", (await api("/api/app/leads/import", bookkeeper)).status === 403);
    const templateResponse = await api("/api/app/templates", owner); const templateBody = await templateResponse.json(); copyId = templateBody.current?.tenant_template_id;
    if (!copyId) throw new Error("Could not create tenant template copy");
    const original = templateBody.current.template;
    const customField = { field_key: "preferred_language", label: "Preferred language", type: "text", is_required: false, options: [], sort_order: original.fields.length, help_text: null, validation: {} };
    const form = { sections: original.form_definition.sections.map((section, index) => index === 0 ? { ...section, fields: [...section.fields, { field_key: customField.field_key, is_required: false, show_when: null }] } : section) };
    const edit = await api(`/api/app/templates/${copyId}`, owner, { method: "PATCH", ...json({ name: original.name, description: original.description, fields: [...original.fields, customField], stages: original.stages, form_definition: form }) }); const editBody = await edit.clone().json().catch(() => null);
    check("custom lead field can be added without a deployment", edit.status === 200, JSON.stringify({ status: edit.status, body: editBody }));
    const leadsResponse = await api("/api/app/leads", owner); const leadsBody = await leadsResponse.json();
    const template = leadsBody.template.template; const pipeline = leadsBody.pipelines.find((item) => item.partner_type === "marketing" && item.is_default) ?? leadsBody.pipelines.find((item) => item.is_default); const stage = pipeline?.stages.find((item) => !item.is_archived);
    const firstValues = { ...valuesFor(template, 1), preferred_language: "Spanish" };
    const created = await api("/api/app/leads", owner, { method: "POST", ...json({ values: firstValues, stage_id: stage?.id }) }); const createdBody = await created.clone().json().catch(() => null);
    check("source lead can be created for the export fixture", created.status === 201, JSON.stringify({ status: created.status, body: createdBody }));
    const exported = await api("/api/app/leads/export", owner); const csv = await exported.text();
    check("lead export contains stable custom-field keys", exported.status === 200 && csv.includes("preferred_language") && csv.includes("Spanish"));
    const importInfo = await api("/api/app/leads/import", owner); const importInfoBody = await importInfo.json();
    check("import page API exposes current fields and stages", importInfo.status === 200 && importInfoBody.fields.some((field) => field.key === "preferred_language") && importInfoBody.stages.some((item) => item.id === stage?.id));
    const importCsv = `stage,${template.fields.map((field) => field.field_key).join(",")}\r\n${stage.name},${template.fields.map((field, index) => { const value = field.field_key === "preferred_language" ? "English" : valueFor(field, 30 + index); return Array.isArray(value) ? `"${value.join("|")}"` : `"${String(value).replaceAll('"', '""')}"`; }).join(",")}\r\n`;
    const beforeImport = (await (await api("/api/app/leads", owner)).json()).leads.length;
    const importKey = `qa-import-${stamp}`;
    const imported = await api("/api/app/leads/import", owner, { method: "POST", ...json({ csv: importCsv }), headers: { "Idempotency-Key": importKey, "content-type": "application/json" } }); const importedBody = await imported.json();
    const afterImportBody = await (await api("/api/app/leads", owner)).json();
    check("CSV import creates a lead with custom fields and typed values", imported.status === 201 && importedBody.imported === 1 && afterImportBody.leads.length === beforeImport + 1 && afterImportBody.leads.some((lead) => lead.values.preferred_language === "English"), JSON.stringify({ status: imported.status, body: importedBody, beforeImport, afterImport: afterImportBody.leads.length, values: afterImportBody.leads.at(0)?.values }));
    const replay = await api("/api/app/leads/import", owner, { method: "POST", ...json({ csv: importCsv }), headers: { "Idempotency-Key": importKey, "content-type": "application/json" } }); const replayBody = await replay.json();
    const afterReplayBody = await (await api("/api/app/leads", owner)).json();
    check("replaying a completed import returns its result without duplicating leads", replay.status === 200 && replayBody.imported === importedBody.imported && afterReplayBody.leads.length === afterImportBody.leads.length, JSON.stringify({ status: replay.status, body: replayBody, before: afterImportBody.leads.length, after: afterReplayBody.leads.length }));
    const concurrentKey = `qa-import-concurrent-${stamp}`;
    const beforeConcurrent = afterReplayBody.leads.length;
    // Use a distinct lead value here. Reusing the earlier CSV would exercise the contact/lead
    // duplicate detector instead of proving import-batch idempotency, making a successful batch
    // look like it created no lead at all.
    const concurrentCsv = importCsv.replace("English", "German").replace(/602555\d{4}/, "6025559998");
    const concurrent = await Promise.all([
      api("/api/app/leads/import", owner, { method: "POST", ...json({ csv: concurrentCsv }), headers: { "Idempotency-Key": concurrentKey, "content-type": "application/json" } }),
      api("/api/app/leads/import", owner, { method: "POST", ...json({ csv: concurrentCsv }), headers: { "Idempotency-Key": concurrentKey, "content-type": "application/json" } }),
    ]);
    const concurrentBodies = await Promise.all(concurrent.map((response) => response.json()));
    const afterConcurrentBody = await (await api("/api/app/leads", owner)).json();
    check("concurrent identical imports create one batch", concurrent.some((response) => response.status === 201) && concurrent.every((response) => [200, 201, 409].includes(response.status)) && afterConcurrentBody.leads.length === beforeConcurrent + 1, JSON.stringify({ statuses: concurrent.map((response) => response.status), bodies: concurrentBodies, before: beforeConcurrent, after: afterConcurrentBody.leads.length }));
    const beforeInvalid = afterConcurrentBody.leads.length;
    const invalid = await api("/api/app/leads/import", owner, { method: "POST", ...json({ csv: "stage,unknown\nNew,value\n" }) });
    const afterInvalid = (await (await api("/api/app/leads", owner)).json()).leads.length;
    check("invalid CSV is rejected before any lead is written", invalid.status === 400 && afterInvalid === beforeInvalid);
    // The isolation property is "tenant B's import lands in B and never in A" — not "tenant B's
    // import is refused". This check used to demand a 400 or a 403, which is the wrong shape: both
    // fixture tenants are given the same plan and entitlement, both are seeded with the same default
    // pipelines (LA-1.9), and the lead template is platform-wide. A second tenant importing its own
    // file is therefore normal operation, and 201 is the correct answer.
    //
    // Asserting the refusal made the check pass for an incidental reason — whichever of entitlement,
    // pipeline or template tenant B happened to be missing — and fail the moment the fixture gave B
    // a complete setup. So it now measures the thing that matters: A's lead count either side of B's
    // import, and B ending up with the row.
    const firstTenantBefore = (await (await api("/api/app/leads", owner)).json()).leads.length;
    const crossTenant = await api("/api/app/leads/import", otherOwner, { method: "POST", ...json({ csv: importCsv }) });
    const firstTenantAfter = (await (await api("/api/app/leads", owner)).json()).leads.length;
    const secondTenantLeads = (await (await api("/api/app/leads", otherOwner)).json()).leads.length;
    check(
      "a second tenant's import lands in its own tenant and never in the first",
      firstTenantAfter === firstTenantBefore && crossTenant.status === 201 && secondTenantLeads === 1,
      JSON.stringify({ status: crossTenant.status, firstTenantBefore, firstTenantAfter, secondTenantLeads }),
    );
    const auditRows = await db.from("audit_log").select("action, metadata").eq("actor_id", ownerId).eq("action", "tenant.lead_stage_changed");
    check("imported lead writes an audit row", (auditRows.data ?? []).some((row) => row.metadata?.operation === "imported"), JSON.stringify({ error: auditRows.error?.message, rows: auditRows.data }));
  } finally { await new Promise((resolve) => simulator.server.close(resolve)); await cleanup(); }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll live lead CSV import checks passed.");
  return failures ? 1 : 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
