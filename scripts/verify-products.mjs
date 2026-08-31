// SA-4.5 live verification. Run with: npm run verify:products
// Exercises the product API and the archive/picker contract against the configured Supabase app.
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const stamp = Date.now();
let failures = 0;
const temporaryAdmins = [];
let productId = null;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

async function sign(adminId, role) {
  const token = await new SignJWT({ role, stage: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET));
  return `insurvas_admin_session=${token}`;
}

async function findOrCreate(role) {
  const { data: existing } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("role", role)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await supabase
    .from("admin_users")
    .insert({
      email: `verify-products-${role}-${stamp}@insurvas.invalid`,
      name: `SA-4.5 ${role}`,
      role,
      password_hash: "verification-only",
      totp_secret: "verification-only",
      is_active: true,
    })
    .select("id, role")
    .single();
  if (error) throw new Error(`Could not create ${role} fixture: ${error.message}`);
  temporaryAdmins.push(created.id);
  return created;
}

async function api(path, cookie, options = {}) {
  return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) } });
}

async function cleanup() {
  if (productId) {
    const { error } = await supabase.from("products").delete().eq("id", productId);
    if (error) console.error(`Could not remove product fixture: ${error.message}`);
  }
  for (const id of temporaryAdmins) {
    const { error } = await supabase.from("admin_users").delete().eq("id", id);
    if (error) console.error(`Could not remove admin fixture: ${error.message}`);
  }
}

async function main() {
  const { error: tableError } = await supabase.from("products").select("id").limit(1);
  if (tableError?.message?.includes("Could not find the table")) {
    console.log("NOT TESTABLE YET — apply supabase/migrations/0003_products.sql first.");
    return 2;
  }
  if (tableError) throw new Error(`Products table could not be read: ${tableError.message}`);

  const { data: seeds, error: seedError } = await supabase.from("products").select("code, name, category").order("sort_order");
  if (seedError) throw new Error(`Could not read seed products: ${seedError.message}`);
  const expected = [
    ["final_expense", "Final Expense", "life"],
    ["term_life", "Term Life", "life"],
    ["whole_life", "Whole Life", "life"],
    ["iul", "Indexed Universal Life", "life"],
    ["medicare_advantage", "Medicare Advantage", "health"],
    ["annuity", "Annuity", "retirement"],
  ];
  check("six seeded products exist", expected.every(([code, name, category]) => seeds.some((row) => row.code === code && row.name === name && row.category === category)));

  const superAdmin = await findOrCreate("super_admin");
  const platformConfig = await findOrCreate("platform_config");
  const supportAgent = await findOrCreate("support_agent");
  const billingAdmin = await findOrCreate("billing_admin");
  const superCookie = await sign(superAdmin.id, "super_admin");
  const platformCookie = await sign(platformConfig.id, "platform_config");

  try {
    const create = await api("/api/admin/products", superCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: `qa_product_${stamp}`, name: "QA Product", category: "life", description: "temporary", sort_order: 999 }),
    });
    const createBody = await create.json();
    productId = createBody.product?.id ?? null;
    check("adding a product succeeds without a deploy", create.status === 201 && Boolean(productId), `status ${create.status}`);

    const edit = await api(`/api/admin/products/${productId}`, platformCookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Product Edited", sort_order: 998 }),
    });
    check("platform_config can edit products", edit.status === 200, `status ${edit.status}`);

    const archive = await api(`/api/admin/products/${productId}`, superCookie, { method: "DELETE" });
    const archiveBody = await archive.json();
    check("delete archives instead of hard-deleting", archive.status === 200 && archiveBody.archived === true && archiveBody.product?.is_active === false, `status ${archive.status}`);

    const adminList = await api("/api/admin/products", superCookie);
    const adminListBody = await adminList.json();
    check("archived products remain in the admin list", adminList.status === 200 && adminListBody.products.some((row) => row.id === productId));
    const picker = await api("/api/admin/products?picker=1", superCookie);
    const pickerBody = await picker.json();
    check("archived products disappear from picker results", picker.status === 200 && !pickerBody.products.some((row) => row.id === productId));

    const restore = await api(`/api/admin/products/${productId}`, platformCookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    });
    check("platform_config can restore products", restore.status === 200);

    const auditRows = await supabase.from("audit_log").select("action").eq("target_id", productId);
    const actions = (auditRows.data ?? []).map((row) => row.action);
    check("create, edit and archive are audit-logged", ["product.created", "product.updated", "product.archived"].every((action) => actions.includes(action)), actions.join(", "));

    for (const [role, cookie] of [["support_agent", await sign(supportAgent.id, "support_agent")], ["billing_admin", await sign(billingAdmin.id, "billing_admin")]]) {
      const response = await api("/api/admin/products", cookie, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      check(`${role} cannot edit products`, response.status === 403, `status ${response.status}`);
    }
  } finally {
    await cleanup();
  }

  if (failures > 0) return 1;
  console.log("\nAll live product checks passed.");
  return 0;
}

process.exitCode = await main().catch(async (error) => {
  console.error(error);
  await cleanup();
  return 1;
});
