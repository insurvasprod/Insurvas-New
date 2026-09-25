import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing Supabase URL or service-role key.");
  process.exit(1);
}

const demoAccounts = [
  { email: "demo.superadmin@insurvas.test", name: "Demo Super Admin", password: process.env.DEMO_SUPERADMIN_PASSWORD, kind: "admin", adminRole: "super_admin" },
  { email: "demo.systemadmin@insurvas.test", name: "Demo System Admin", password: process.env.DEMO_SYSTEMADMIN_PASSWORD, kind: "admin", adminRole: "platform_config" },
  { email: "demo.agent@insurvas.test", name: "Demo Agent", password: process.env.DEMO_AGENT_PASSWORD, kind: "agent" },
  { email: "demo.partneradmin@insurvas.test", name: "Demo Partner Admin", password: process.env.DEMO_PARTNERADMIN_PASSWORD, kind: "partner", partnerRole: "partner_admin" },
  { email: "demo.partneruser@insurvas.test", name: "Demo Partner User", password: process.env.DEMO_PARTNERUSER_PASSWORD, kind: "partner", partnerRole: "partner_user" },
];

const seedAdmin = {
  email: process.env.SEED_SUPER_ADMIN_EMAIL,
  name: process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin",
  password: process.env.SEED_SUPER_ADMIN_PASSWORD,
  kind: "admin",
  adminRole: "super_admin",
};

for (const account of [...demoAccounts, seedAdmin]) {
  if (!account.email || !account.password || account.password.length < 12) {
    console.error(`Missing or weak password configuration for ${account.email ?? "an account"}.`);
    process.exit(1);
  }
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];

async function findAuthUser(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function ensureAuthUser(account) {
  const existing = await findAuthUser(account.email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: account.password,
      email_confirm: true,
      user_metadata: { name: account.name },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email.toLowerCase(),
    password: account.password,
    email_confirm: true,
    user_metadata: { name: account.name },
  });
  if (error) throw error;
  return data.user;
}

async function ensureProfile(account, authUser) {
  const passwordHash = await bcrypt.hash(account.password, 12);
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, organization_id")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error(`Missing public.users profile for ${account.email}`);

  const { error } = await supabase.from("users").update({
    name: account.name,
    full_name: account.name,
    display_name: account.name,
    status: "active",
    active: true,
    must_reset_password: false,
    password_hash: passwordHash,
  }).eq("id", authUser.id);
  if (error) throw error;
  return profile;
}

async function ensureAdmin(account, updateExisting = account.email.endsWith("@insurvas.test")) {
  const { data: existing, error: readError } = await supabase
    .from("admin_users")
    .select("id, email, totp_secret")
    .ilike("email", account.email)
    .maybeSingle();
  if (readError) throw readError;

  const values = {
    email: account.email.toLowerCase(),
    name: account.name,
    role: account.adminRole,
    password_hash: await bcrypt.hash(account.password, 12),
    is_active: true,
  };

  if (existing) {
    if (!updateExisting) return "preserved";
    // Preserve a configured TOTP secret when an admin already exists.
    const { error } = await supabase.from("admin_users").update(values).eq("id", existing.id);
    if (error) throw error;
    return "updated";
  }

  const { error } = await supabase.from("admin_users").insert({
    ...values,
    totp_secret: new OTPAuth.Secret({ size: 20 }).base32,
  });
  if (error) throw error;
  return "created";
}

async function ensureTenantAgent(authUser, profile) {
  const { data: membership, error: readError } = await supabase
    .from("tenant_users")
    .select("tenant_id, role")
    .eq("user_id", authUser.id)
    .maybeSingle();
  if (readError) throw readError;
  if (!membership) throw new Error("Demo agent has no tenant membership.");

  const { error } = await supabase.from("tenant_users").update({
    // The LA/Agent fixture is the QA owner so the full owner-only LA-0 mutation matrix is
    // executable without changing an existing production-looking user.
    role: "owner",
    accepted_at: new Date().toISOString(),
  }).eq("tenant_id", membership.tenant_id).eq("user_id", authUser.id);
  if (error) throw error;
  return { tenantId: membership.tenant_id, organizationId: profile.organization_id };
}

async function ensurePartnerMembership(account, authUser, profile) {
  const { data: membership, error: membershipError } = await supabase
    .from("partner_users")
    .select("id, partner_id, tenant_id")
    .eq("user_id", authUser.id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error(`Partner membership missing for ${account.email}`);

  const { error } = await supabase.from("partner_users").update({
    tenant_id: membership.tenant_id,
    role: account.partnerRole,
    access_role: account.partnerRole,
    status: "active",
    accepted_at: new Date().toISOString(),
    deactivated_at: null,
  }).eq("id", membership.id);
  if (error) throw error;
  return { tenantId: membership.tenant_id, partnerId: membership.partner_id, organizationId: profile.organization_id };
}

for (const account of demoAccounts) {
  const authUser = await ensureAuthUser(account);
  const profile = await ensureProfile(account, authUser);
  let scope = null;
  if (account.kind === "agent") scope = await ensureTenantAgent(authUser, profile);
  if (account.kind === "partner") scope = await ensurePartnerMembership(account, authUser, profile);
  const adminState = account.kind === "admin" ? await ensureAdmin(account) : null;
  results.push({ email: account.email, auth: "ready", kind: account.kind, admin: adminState, scope: scope ? "ready" : null });
}

// The explicitly configured seed identity is an admin-plane account and is intentionally not
// added to a tenant or partner membership.
const seedAdminState = await ensureAdmin(seedAdmin, false);
results.push({ email: seedAdmin.email, auth: "not-used-by-admin-login", kind: "admin", admin: seedAdminState, scope: null });

console.log(JSON.stringify({ ok: true, accounts: results }, null, 2));
