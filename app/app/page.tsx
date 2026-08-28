import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/app/logout-button";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { withTenantScope } from "@/lib/tenantDb/withTenantScope";
import { TENANT_ROLE_LABELS } from "@/lib/tenantAuth/roles";

export default async function TenantHomePage() {
  // Resolves the live role from the database, so a role change an admin just made shows here
  // immediately rather than after the next login (SA-1.3).
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const { user, tenant } = await withTenantScope(context.tenantId, context.userId, async (client) => {
    const userResult = await client.query("select name, email, last_login_at from users where id = $1", [
      context.userId,
    ]);
    const tenantResult = await client.query("select name, status from tenants where id = $1", [context.tenantId]);
    return { user: userResult.rows[0] ?? null, tenant: tenantResult.rows[0] ?? null };
  });

  if (!user || !tenant) {
    redirect("/app/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]">
            <Building2 className="size-5" />
          </div>
          <CardTitle className="text-xl">{tenant.name}</CardTitle>
          <CardDescription>Tenant plane foundation — SA-0.2</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Signed in as</p>
              <p className="font-medium">{user.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Role</p>
              <p className="font-medium">{TENANT_ROLE_LABELS[context.role]}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{user.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Account status</p>
              <p className="font-medium capitalize">{tenant.status}</p>
            </div>
          </div>
          <LogoutButton />
        </CardContent>
      </Card>
    </div>
  );
}
