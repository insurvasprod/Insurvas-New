import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { Callout, Pill } from "@/components/app/settings/primitives";
import type { UserDetail } from "@/lib/adminUsers/detail";
import { userStatusTone, utcDate, utcDateTime } from "@/lib/adminUsers/detailFormat";
import { TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";
import { isOnboarded } from "@/lib/adminUsers/credential";
import { userStatusLabel } from "@/lib/users/constants";

/** More than this many distinct IPs in 24h suggests a shared account (same threshold as the list). */
const SHARED_ACCOUNT_IP_THRESHOLD = 3;

/** The board's 44px secondary header button, as a link. */
const HEADER_LINK =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap text-[var(--ink)] no-underline hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

type Fact = { label: string; value: string; iso?: string | null };

/**
 * The top of the admin user record (board p-adm-user-detail): back link, header, the chip row, the
 * shared-account warning when it applies, and the fact card. Server-rendered; times are printed in
 * UTC with the reader's local time on hover.
 */
export function UserDetailSummary({ user }: { user: UserDetail }) {
  const sharedAccountSuspected = user.distinctIps24h > SHARED_ACCOUNT_IP_THRESHOLD;
  const roleLabel = (role: string | null) =>
    role ? (TENANT_ROLE_LABELS[role as TenantRole] ?? role) : null;

  const facts: Fact[] = [
    { label: "User id", value: user.id },
    { label: "Email", value: user.email ?? "—" },
    { label: "Created", value: utcDate(user.createdAt), iso: user.createdAt },
    { label: "Last login", value: user.lastLoginAt ? utcDateTime(user.lastLoginAt) : "Never", iso: user.lastLoginAt },
    ...(user.suspendedAt
      ? [{ label: "Suspended", value: utcDateTime(user.suspendedAt), iso: user.suspendedAt }]
      : []),
    { label: "Phone", value: user.phone || "—" },
    { label: "Plan", value: user.planCode ?? "No plan yet" },
  ];

  return (
    <>
      <div>
        <Link
          href="/admin/users"
          className="mb-2.5 inline-flex items-center gap-2 rounded-sm text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          <ArrowLeft className="size-[13px] stroke-[2.4]" aria-hidden="true" />
          Back to users
        </Link>
        <AdminPageHeader
          title={user.name || user.email || "User"}
          subtitle="One user, their tenant membership, and their sign-in history."
          actions={
            <Link href="/admin/users" className={HEADER_LINK}>
              Back to users
            </Link>
          }
        />
      </div>

      <div role="group" aria-label="Account state" className="flex flex-wrap gap-2">
        <Pill tone={userStatusTone(user.status)} dot>
          {userStatusLabel(user.status)}
        </Pill>
        {user.memberships.length === 0 && <Pill tone="neutral">No agency</Pill>}
        {user.memberships.map((membership) => (
          <span key={membership.tenantId} className="contents">
            {roleLabel(membership.role) && <Pill tone="neutral">{roleLabel(membership.role)}</Pill>}
            <Link
              href={`/admin/tenants/${membership.tenantId}`}
              className="rounded-full no-underline hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
              title="Open this agency's record"
            >
              <Pill tone="neutral">{membership.tenantName ?? "Unnamed agency"}</Pill>
            </Link>
          </span>
        ))}
        {!isOnboarded(user) && <Pill tone="warning">Invite pending</Pill>}
      </div>

      {sharedAccountSuspected && (
        <Callout tone="warning" title="Possible shared account">
          Successful logins from {user.distinctIps24h} different IP addresses in the last 24 hours.
        </Callout>
      )}

      <section aria-label="Key facts" className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">
                {fact.label}
              </dt>
              <dd
                className="m-0 mt-1 truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums"
                title={fact.iso ? undefined : fact.value}
              >
                {fact.iso ? <DashboardUtcTime iso={fact.iso} text={fact.value} /> : fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
