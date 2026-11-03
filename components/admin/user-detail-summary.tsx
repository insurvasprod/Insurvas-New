import { StatusChip } from "@/components/ui/status-chip";
import Link from "next/link";

import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { Callout } from "@/components/app/settings/primitives";
import { pillTone } from "@/lib/ui/pillTone";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import type { UserDetail } from "@/lib/adminUsers/detail";
import { userStatusTone, utcDate, utcDateTime } from "@/lib/adminUsers/detailFormat";
import { TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";
import { isOnboarded } from "@/lib/adminUsers/credential";
import { userStatusLabel } from "@/lib/users/constants";

/** More than this many distinct IPs in 24h suggests a shared account (same threshold as the list). */
const SHARED_ACCOUNT_IP_THRESHOLD = 3;

/** Names, addresses and dates rather than counts: set at 18px and truncated, as on the tenant record. */
const FACT = "block truncate text-lg leading-[1.33]";

/**
 * The top of the admin user record (board p-adm-user-detail): back link, header with the state
 * chips, the shared-account warning when it applies, and the fact card. Server-rendered; times are printed in
 * UTC with the reader's local time on hover.
 */
export function UserDetailSummary({ user }: { user: UserDetail }) {
  const sharedAccountSuspected = user.distinctIps24h > SHARED_ACCOUNT_IP_THRESHOLD;
  const roleLabel = (role: string | null) =>
    role ? (TENANT_ROLE_LABELS[role as TenantRole] ?? role) : null;

  const agencies = user.memberships.map((membership) => membership.tenantName ?? "Unnamed agency");
  const when = (iso: string | null, text: string) => (iso ? <DashboardUtcTime iso={iso} text={text} /> : text);

  return (
    <>
      <div>
        <PageHeader
          title={user.name || user.email || "User"}
          breadcrumbs={[{ label: "Customers" }, { label: "Users", href: "/admin/users" }, { label: user.name || user.email || "User" }]}
          actions={
            <span role="group" aria-label="Account state" className="flex flex-wrap items-center gap-2">
              <StatusChip tone={pillTone(userStatusTone(user.status))} dot>
                {userStatusLabel(user.status)}
              </StatusChip>
              {user.memberships.length === 0 && <StatusChip dot={false} tone="neutral">No agency</StatusChip>}
              {user.memberships.map((membership) => (
                <span key={membership.tenantId} className="contents">
                  {roleLabel(membership.role) && <StatusChip dot={false} tone="neutral">{roleLabel(membership.role)}</StatusChip>}
                  <Link
                    href={`/admin/tenants/${membership.tenantId}`}
                    className="rounded-full no-underline hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                    title="Open this agency's record"
                  >
                    <StatusChip dot={false} tone="neutral">{membership.tenantName ?? "Unnamed agency"}</StatusChip>
                  </Link>
                </span>
              ))}
              {!isOnboarded(user) && <StatusChip dot={false} tone="warning">Invite pending</StatusChip>}
            </span>
          }
        />
      </div>

      {sharedAccountSuspected && (
        <Callout
          tone="warning"
          title={`Possible shared account: successful logins from ${user.distinctIps24h} different IP addresses in the last 24 hours.`}
        />
      )}

      {/* The same strip as the tenant record, so the person and the agency read alike. */}
      <StatStrip label="Key facts">
        <StatTile valueSize="text"
          label="Email"
          value={<span className={FACT} title={user.email ?? undefined}>{user.email ?? "—"}</span>}
          footnote={user.phone ? <span className="block truncate">{user.phone}</span> : "no phone"}
        />
        <StatTile valueSize="text"
          label="Last login"
          value={<span className={FACT}>{when(user.lastLoginAt, user.lastLoginAt ? utcDateTime(user.lastLoginAt) : "Never")}</span>}
          valueTone={sharedAccountSuspected ? "warning" : undefined}
          footnote={`${user.distinctIps24h.toLocaleString("en-US")} ${user.distinctIps24h === 1 ? "address" : "addresses"} in 24 hours`}
        />
        <StatTile valueSize="text"
          label={agencies.length === 1 ? "Agency" : "Agencies"}
          value={<span className={FACT} title={agencies.join(", ") || undefined}>{agencies[0] ?? "None"}</span>}
          footnote={agencies.length > 1 ? `and ${agencies.length - 1} more` : (roleLabel(user.memberships[0]?.role ?? null) ?? "not in an agency")}
        />
        <StatTile valueSize="text" label="Plan" value={<span className={FACT}>{user.planCode ?? "No plan yet"}</span>} footnote={isOnboarded(user) ? "account set up" : "invite pending"} />
        <StatTile valueSize="text"
          label="Joined"
          value={<span className={FACT}>{when(user.createdAt, utcDate(user.createdAt))}</span>}
          footnote={user.suspendedAt ? <>Suspended {when(user.suspendedAt, utcDateTime(user.suspendedAt))}</> : "not suspended"}
        />
        <StatTile valueSize="text"
          label="User id"
          value={<span className="block truncate font-mono text-sm leading-[1.5]" title={user.id}>{user.id}</span>}
          reserveFootnote
        />
      </StatStrip>
    </>
  );
}
