import { ShieldCheck, Users, UserCheck, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/adminAuth/roles";
import { AdminPageHeader } from "@/components/admin/page-header";

export default async function AdminDashboardPage() {
  const admin = await getCurrentAdmin();

  const supabase = getSupabaseServiceClient();
  const { data: rows } = await supabase.from("admin_users").select("role, is_active");

  const total = rows?.length ?? 0;
  const active = rows?.filter((r) => r.is_active).length ?? 0;
  const byRole = new Map<AdminRole, number>();
  for (const row of rows ?? []) {
    byRole.set(row.role, (byRole.get(row.role) ?? 0) + 1);
  }

  const tiles = [
    { label: "Total admins", value: total, icon: Users },
    { label: "Active", value: active, icon: UserCheck },
    {
      label: "Your role",
      value: admin ? ADMIN_ROLE_LABELS[admin.role] : "—",
      icon: ShieldCheck,
    },
    {
      label: "Last login",
      value: admin?.last_login_at ? new Date(admin.last_login_at).toLocaleDateString() : "First login",
      icon: Clock,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title={`Welcome back${admin ? `, ${admin.name}` : ""}`}
        subtitle="Super admin foundation — SA-0.1."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold tracking-tight">{value}</p>
              </div>
              <div className="flex size-9 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]">
                <Icon className="size-4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Admins by role</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[...byRole.entries()].map(([role, count]) => (
            <Badge key={role} variant="outline">
              {ADMIN_ROLE_LABELS[role]} · {count}
            </Badge>
          ))}
          {byRole.size === 0 && <p className="text-sm text-muted-foreground">No admins yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
