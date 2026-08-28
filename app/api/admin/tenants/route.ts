import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { createTenantSchema } from "@/lib/tenants/schemas";
import { hashPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { CAN_VIEW_TENANTS } from "@/lib/tenants/permissions";

export async function GET() {
  const auth = await requireAdminRole(CAN_VIEW_TENANTS);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseServiceClient();

  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, name, status, plan_code, onboarding_state, created_at, suspended_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Could not load tenants" }, { status: 500 });
  }

  const { data: owners } = await supabase
    .from("tenant_users")
    .select("tenant_id, users(name, email)")
    .eq("role", "owner")
    .returns<{ tenant_id: string; users: { name: string; email: string } | null }[]>();

  const ownerByTenant = new Map((owners ?? []).map((row) => [row.tenant_id, row.users]));

  const withOwners = (tenants ?? []).map((tenant) => ({
    ...tenant,
    owner: ownerByTenant.get(tenant.id) ?? null,
  }));

  return NextResponse.json({ tenants: withOwners });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { tenantName, ownerName, ownerEmail, ownerPassword } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const passwordHash = await hashPassword(ownerPassword);

  const { data, error } = await supabase.rpc("create_tenant_with_owner", {
    p_tenant_name: tenantName,
    p_owner_name: ownerName,
    p_owner_email: ownerEmail,
    p_owner_password_hash: passwordHash,
  });

  if (error) {
    const message = error.code === "23505" ? "A user with this email already exists" : "Could not create tenant";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  const result = Array.isArray(data) ? data[0] : data;

  await audit({
    actorId: auth.session.sub,
    action: "tenant.created",
    targetType: "tenant",
    targetId: result.tenant_id,
    metadata: { name: tenantName, ownerEmail },
    request,
  });

  return NextResponse.json(
    { tenant: { id: result.tenant_id, name: tenantName }, owner: { id: result.user_id, email: ownerEmail } },
    { status: 201 },
  );
}
