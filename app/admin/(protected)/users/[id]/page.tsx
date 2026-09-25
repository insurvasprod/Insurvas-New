import { notFound, redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { ADMIN_ROLE_LABELS } from "@/lib/adminAuth/roles";
import { CAN_SET_USER_STATUS, canViewUsers } from "@/lib/users/permissions";
import { fetchLatestUserSuspension, fetchUserDetail } from "@/lib/adminUsers/detail";
import { pageFrom, userDetailTabFrom, utcDateTime } from "@/lib/adminUsers/detailFormat";
import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { UserDetailSummary } from "@/components/admin/user-detail-summary";
import { UserDetailActions } from "@/components/admin/user-detail-actions";
import {
  UserAuditTab,
  UserDetailTabCard,
  UserLoginTab,
  UserSessionsTab,
} from "@/components/admin/user-detail-tabs";

const CARD = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5";
const CARD_TITLE = "m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";

/**
 * The admin user record (board p-adm-user-detail): header, chips and facts, then the tabbed
 * Login activity / Sessions / Audit card beside the suspension reason and the Actions card.
 * `?tab=` picks the tab; each tab fetches only its own data.
 */
export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; page?: string | string[] }>;
}) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewUsers(admin.role)) redirect("/admin");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Not a uuid is "no such user", not "the database failed" (which is what the query would say).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const tab = userDetailTabFrom(query.tab);
  const page = pageFrom(query.page);

  // Same distinction as the tenant page: a failed read throws, it is not reported as a deleted user.
  const user = await fetchUserDetail(id);
  if (!user) notFound();

  const suspended = user.status === "suspended";
  const suspension = suspended ? await fetchLatestUserSuspension(id) : null;
  const suspendedWhen = suspension?.ts ?? user.suspendedAt;
  const suspendedBy = suspension ? (suspension.actorName ?? "A staff member no longer on the admin list") : null;

  // The status routes admit CAN_SET_USER_STATUS; reset and invitation routes admit super_admin.
  const canManage = admin.role === "super_admin" && CAN_SET_USER_STATUS.includes(admin.role);

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <UserDetailSummary user={user} />

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <UserDetailTabCard userId={id} active={tab}>
          {tab === "login" && <UserLoginTab userId={id} email={user.email} />}
          {tab === "sessions" && <UserSessionsTab userId={id} status={user.status} />}
          {tab === "audit" && <UserAuditTab userId={id} page={page} />}
        </UserDetailTabCard>

        <div className="flex min-w-0 flex-col gap-4">
          {suspended && (
            <section className={CARD} aria-labelledby="user-suspension-title">
              <h2 id="user-suspension-title" className={CARD_TITLE}>
                Suspension reason
              </h2>
              <p className="m-0 mt-3 text-[14px] leading-[1.5] tracking-[-0.02em] break-words text-[var(--body)]">
                {user.suspensionReason ?? suspension?.reason ?? "No reason was recorded."}
              </p>
              {(suspendedBy || suspendedWhen) && (
                <div className="mt-2 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                  {suspendedBy}
                  {suspendedBy && suspendedWhen && " · "}
                  {suspendedWhen && <DashboardUtcTime iso={suspendedWhen} text={utcDateTime(suspendedWhen)} />}
                </div>
              )}
            </section>
          )}

          <section className={CARD} aria-labelledby="user-actions-title">
            <h2 id="user-actions-title" className={CARD_TITLE}>
              Actions
            </h2>
            <UserDetailActions
              user={{
                id: user.id,
                name: user.name ?? user.email ?? "this user",
                email: user.email ?? "",
                status: user.status,
                hasPassword: user.hasPassword,
                acceptedMembership: user.acceptedMembership,
              }}
              canManage={canManage}
              managerRoleLabel={ADMIN_ROLE_LABELS.super_admin}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
