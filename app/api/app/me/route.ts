import { NextResponse } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { withTenantScope } from "@/lib/tenantDb/withTenantScope";

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;

  // Runs through the tenant_app Postgres role (RLS enforced), not the service-role client —
  // this is the read that actually proves tenant isolation, not just an application-layer filter.
  const { user, tenant } = await withTenantScope(context.tenantId, context.userId, async (client) => {
    const userResult = await client.query(
      "select id, email, name, status, last_login_at from users where id = $1",
      [context.userId],
    );
    const tenantResult = await client.query("select id, name, status, plan_code from tenants where id = $1", [
      context.tenantId,
    ]);
    return { user: userResult.rows[0] ?? null, tenant: tenantResult.rows[0] ?? null };
  });

  if (!user || !tenant) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json({ user, tenant, role: context.role });
}
