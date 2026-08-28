import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";
import { USER_STATUS_BADGE_CLASS, USER_STATUS_LABELS, type UserStatus } from "@/lib/users/constants";
import { relativeTime } from "@/lib/relativeTime";

type DetailUser = {
  name: string | null;
  email: string | null;
  phone: string | null;
  status: UserStatus | null;
  tenant_name: string | null;
  tenant_role: string | null;
  plan_code: string | null;
  last_login_at: string | null;
  created_at: string | null;
  has_password: boolean | null;
  suspension_reason: string | null;
  distinct_ips_24h: number | null;
};

/** More than this many distinct IPs in 24h suggests a shared account (SA-1.5). */
const SHARED_ACCOUNT_IP_THRESHOLD = 3;

export function UserDetailSummary({ user }: { user: DetailUser }) {
  const sharedAccountSuspected = (user.distinct_ips_24h ?? 0) > SHARED_ACCOUNT_IP_THRESHOLD;

  const fields = [
    { label: "Tenant", value: user.tenant_name ?? "—" },
    {
      label: "Role",
      value: user.tenant_role ? TENANT_ROLE_LABELS[user.tenant_role as TenantRole] : "—",
    },
    { label: "Phone", value: user.phone || "—" },
    { label: "Plan", value: user.plan_code ?? "No plan yet" },
    { label: "Last login", value: relativeTime(user.last_login_at) },
    {
      label: "Created",
      value: user.created_at ? new Date(user.created_at).toLocaleDateString() : "—",
    },
  ];

  return (
    <div className="space-y-4">
      {sharedAccountSuspected && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
          <p>
            <span className="font-medium">Possible shared account.</span> Successful logins from{" "}
            {user.distinct_ips_24h} distinct IP addresses in the last 24 hours.
          </p>
        </div>
      )}

      {user.status === "suspended" && user.suspension_reason && (
        <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-4 text-sm">
          <span className="font-medium">Suspended:</span> {user.suspension_reason}
        </div>
      )}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {user.status && (
              <Badge variant="outline" className={USER_STATUS_BADGE_CLASS[user.status]}>
                {USER_STATUS_LABELS[user.status]}
              </Badge>
            )}
            {user.has_password === false && (
              <Badge
                variant="outline"
                className="border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
              >
                Invite pending
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {fields.map(({ label, value }) => (
              <div key={label}>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-medium">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
