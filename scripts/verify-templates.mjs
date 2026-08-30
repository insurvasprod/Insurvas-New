// SA-4.6 live verification. Run with: npm run verify:templates
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const templateIds = new Set();
const temporaryAdmins = [];
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

async function sign(adminId, role, secret = process.env.ADMIN_SESSION_SECRET, expiry = "10m") {
  const token = await new SignJWT({ role, stage: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(adminId).setIssuedAt().setExpirationTime(expiry).sign(new TextEncoder().encode(secret));
  return `insurvas_admin_session=${token}`;
}

async function findOrCreate(role) {
  const { data: existing } = await supabase.from("admin_users").select("id, role").eq("role", role).eq("is_active", true).limit(1).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await supabase.from("admin_users").insert({ email: `verify-templates-${role}-${stamp}@insurvas.invalid`, name: `SA-4.6 ${role}`, role, password_hash: "verification-only", totp_secret: "verification-only", is_active: true }).select("id, role").single();
  if (error) throw new Error(`Could not create ${role} fixture: ${error.message}`);
  temporaryAdmins.push(created.id);
  return created;
}

async function api(path, cookie, options = {}) {
  return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" });
}

const field = (key, label, type, required, sort_order) => ({ field_key: key, label, type, is_required: required, options: type === "single_select" ? ["Yes", "No"] : [], sort_order });
const stage = (key, label, type, color, sort_order) => ({ stage_key: key, label, stage_type: type, color, sort_order });
const content = (name, description = "Reusable Term Life starting point") => ({
  name,
  product_code: "term_life",
  description,
  fields: [field("full_name", "Full name", "text", true, 10), field("date_of_birth", "Date of birth", "date", true, 20), field("tobacco_use", "Tobacco use", "boolean", true, 30), field("coverage_wanted", "Coverage wanted", "currency", false, 40)],
  stages: [stage("new", "New", "open", "#2563eb", 10), stage("quoted", "Quoted", "open", "#7c3aed", 20), stage("issued", "Issued", "won", "#16a34a", 30), stage("lost", "Lost", "lost", "#dc2626", 40)],
  form_definition: { sections: [{ section_key: "application", label: "Term Life application", sort_order: 0, fields: [{ field_key: "full_name", is_required: true, show_when: null }, { field_key: "tobacco_use", is_required: true, show_when: null }, { field_key: "coverage_wanted", is_required: false, show_when: { field_key: "tobacco_use", equals: "Yes" } }] }] },
});

async function cleanup() {
  const ids = [...templateIds];
  if (ids.length) {
    await supabase.from("template_forms").delete().in("template_id", ids);
    await supabase.from("template_fields").delete().in("template_id", ids);
    await supabase.from("template_stages").delete().in("template_id", ids);
    await supabase.from("templates").delete().in("id", ids);
  }
  for (const id of temporaryAdmins) await supabase.from("admin_users").delete().eq("id", id);
}

async function main() {
  const { error: tableError } = await supabase.from("templates").select("id").limit(1);
  if (tableError?.message?.includes("Could not find the table")) { console.log("NOT TESTABLE YET — apply supabase/migrations/0004_templates.sql first."); return 2; }
  if (tableError) throw new Error(`Templates table could not be read: ${tableError.message}`);

  const superAdmin = await findOrCreate("super_admin");
  const platformConfig = await findOrCreate("platform_config");
  const supportAgent = await findOrCreate("support_agent");
  const billingAdmin = await findOrCreate("billing_admin");
  const superCookie = await sign(superAdmin.id, "super_admin");
  const platformCookie = await sign(platformConfig.id, "platform_config");

  try {
    console.log("Authentication and dependency failures\n");
    const noCookie = await api("/api/admin/templates");
    check("missing session returns 401", noCookie.status === 401, `status ${noCookie.status}`);
    const expired = await sign(superAdmin.id, "super_admin", process.env.ADMIN_SESSION_SECRET, Math.floor(Date.now() / 1000) - 10);
    const expiredResponse = await api("/api/admin/templates", expired);
    check("expired session returns 401", expiredResponse.status === 401, `status ${expiredResponse.status}`);
    const forged = await sign(superAdmin.id, "super_admin", `${process.env.ADMIN_SESSION_SECRET}-forged`);
    const forgedResponse = await api("/api/admin/templates", forged);
    check("forged session returns 401", forgedResponse.status === 401, `status ${forgedResponse.status}`);
    for (const [role, cookie] of [["support_agent", await sign(supportAgent.id, "support_agent")], ["billing_admin", await sign(billingAdmin.id, "billing_admin")]]) {
      const response = await api("/api/admin/templates", cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(content("blocked")) });
      check(`${role} cannot create templates`, response.status === 403, `status ${response.status}`);
    }
    const missingProduct = await api("/api/admin/templates", superCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...content("missing product"), product_code: "does_not_exist" }) });
    check("missing product dependency is rejected", missingProduct.status === 400, `status ${missingProduct.status}`);
    const hostile = await api("/api/admin/templates", superCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...content(`QA <img src=x onerror=alert(1)> ${stamp}`, "<script>alert(1)</script>"), fields: [{ ...content("x").fields[0], field_key: "bad-key" }] }) });
    check("hostile/invalid field keys are rejected", hostile.status === 400, `status ${hostile.status}`);

    console.log("\nCreate, schema, duplicate, version and archive behavior\n");
    const create = await api("/api/admin/templates", superCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(content(`Term Life QA ${stamp}`)) });
    const createdBody = await create.json();
    const templateId = createdBody.template?.id;
    if (templateId) templateIds.add(templateId);
    check("creating a template requires no deploy", create.status === 201 && Boolean(templateId), `status ${create.status}`);
    const list = await api("/api/admin/templates", platformCookie);
    const listBody = await list.json();
    const current = listBody.templates?.find((template) => template.id === templateId);
    check("template is visible to platform_config", list.status === 200 && Boolean(current));
    check("lead field schema is normalized and form is JSONB-shaped", current?.fields?.length === 4 && current?.form_definition?.sections?.[0]?.fields?.length === 3);
    check("pipeline stages are ordered and typed", current?.stages?.map((item) => item.stage_key).join(",") === "new,quoted,issued,lost" && current?.stages?.some((item) => item.stage_type === "won") && current?.stages?.some((item) => item.stage_type === "lost"));

    const duplicate = await api(`/api/admin/templates/${templateId}/duplicate`, platformCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Term Life QA copy ${stamp}` }) });
    const duplicateBody = await duplicate.json();
    const duplicateId = duplicateBody.template?.id;
    if (duplicateId) templateIds.add(duplicateId);
    check("duplicate creates a new template", duplicate.status === 201 && duplicateId !== templateId, `status ${duplicate.status}`);
    const duplicateGet = await api(`/api/admin/templates/${duplicateId}`, platformCookie);
    const duplicateTemplate = (await duplicateGet.json()).template;
    check("duplicate copies fields, stages and form in one action", duplicateTemplate?.fields?.length === 4 && duplicateTemplate?.stages?.length === 4 && duplicateTemplate?.form_definition?.sections?.[0]?.fields?.length === 3);
    const duplicateOwner = duplicateId ? await supabase.from("templates").select("created_by").eq("id", duplicateId).maybeSingle() : { data: null };
    check("duplicate records the requesting administrator as creator", duplicateOwner.data?.created_by === platformConfig.id);

    const edit = await api(`/api/admin/templates/${templateId}`, platformCookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(content(`Term Life QA edited ${stamp}`, "version two")) });
    const editBody = await edit.json();
    check("editing creates a new version", edit.status === 200 && editBody.template?.version === 2, `status ${edit.status}`);
    const oldFields = await supabase.from("template_fields").select("field_key").eq("template_id", templateId).eq("version", 1);
    const newFields = await supabase.from("template_fields").select("field_key").eq("template_id", templateId).eq("version", 2);
    check("version one remains intact after editing", (oldFields.data ?? []).length === 4 && (newFields.data ?? []).length === 4);

    const concurrent = await Promise.all([1, 2].map((index) => api(`/api/admin/templates/${templateId}`, superCookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(content(`Concurrent ${index} ${stamp}`)) })));
    const concurrentBodies = await Promise.all(concurrent.map((response) => response.json()));
    const versions = concurrentBodies.map((body) => body.template?.version).sort((a, b) => a - b);
    check("concurrent edits become distinct versions", concurrent.every((response) => response.status === 200) && versions[0] === 3 && versions[1] === 4, versions.join(","));

    const archive = await api(`/api/admin/templates/${templateId}`, superCookie, { method: "DELETE" });
    check("archive succeeds", archive.status === 200 && (await archive.json()).archived === true, `status ${archive.status}`);
    const archiveAgain = await api(`/api/admin/templates/${templateId}`, superCookie, { method: "DELETE" });
    check("repeated archive is safe", archiveAgain.status === 200, `status ${archiveAgain.status}`);
    const picker = await api("/api/admin/templates?picker=1", superCookie);
    const pickerBody = await picker.json();
    check("archived templates disappear from picker results", picker.status === 200 && !(pickerBody.templates ?? []).some((template) => template.id === templateId));
    const restore = await api(`/api/admin/templates/${templateId}`, platformCookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_active: true }) });
    check("restore succeeds", restore.status === 200);

    const audit = await supabase.from("audit_log").select("action").eq("target_id", templateId);
    const actions = (audit.data ?? []).map((row) => row.action);
    check("template writes are audit-logged", ["template.created", "template.version_created", "template.archived", "template.restored"].every((action) => actions.includes(action)), actions.join(","));
  } finally {
    await cleanup();
  }

  if (failures > 0) return 1;
  console.log("\nAll live template checks passed.");
  return 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
