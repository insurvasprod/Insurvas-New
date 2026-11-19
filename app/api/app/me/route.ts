import { NextResponse } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { readTenantScoped } from "@/lib/tenantDb/withTenantScope";

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;

  // Runs through the tenant_app Postgres role (RLS enforced), not the service-role client —
  // this is the read that actually proves tenant isolation, not just an application-layer filter.
  // One round trip to the pooler (readTenantScoped), not five in a row.
  const [users, tenants] = await readTenantScoped(context.tenantId, context.userId, [
    "select id, email, name, status, last_login_at from users where id = $user",
    "select id, name, status, plan_code from tenants where id = $tenant",
  ]);
  const user = users[0] ?? null;
  const tenant = tenants[0] ?? null;

  if (!user || !tenant) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json({ user, tenant, role: context.role });
}
