import Link from "next/link";

import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { LoginActivityTable } from "@/components/admin/login-activity-table";
import { UserDetailPager } from "@/components/admin/user-detail-pager";
import { Pill } from "@/components/app/settings/primitives";
import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import {
  fetchRecentSignIns,
  fetchUserAuditPage,
  SESSION_WINDOW_SECONDS,
  USER_AUDIT_PAGE_SIZE,
  type UserAuditRow,
} from "@/lib/adminUsers/detail";
import { USER_DETAIL_TABS, utcDateTime, type UserDetailTabKey } from "@/lib/adminUsers/detailFormat";
import { fetchUserLoginEvents } from "@/lib/loginEvents/queries";
import { loginEventTime, summariseUserAgent } from "@/lib/loginEvents/present";
import { userStatusLabel } from "@/lib/users/constants";
import { cn } from "@/lib/utils";

// The boards' table vocabulary (settings primitives' `st`), restated because a server component
// cannot read values out of a "use client" module.
const TH = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase whitespace-nowrap text-[var(--muted)]";
const TD = "border-t border-[var(--border)] px-3 py-2 align-top text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";
const SUB = "block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";
const FOOT = "m-0 border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";

/**
 * The record's tabbed card: Login activity, Sessions, Audit. Tabs are links (`?tab=`), each its own
 * server render fetching only its own data — bookmarkable, and the back button works.
 */
export function UserDetailTabCard({
  userId,
  active,
  children,
}: {
  userId: string;
  active: UserDetailTabKey;
  children: React.ReactNode;
}) {
  const base = `/admin/users/${userId}`;
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
      <nav aria-label="User record" className="min-w-0 overflow-x-auto border-b border-[var(--border)]">
        <ul className="m-0 flex w-max min-w-full list-none gap-6 p-0">
          {USER_DETAIL_TABS.map((tab) => {
            const current = tab.key === active;
            return (
              <li key={tab.key}>
                <Link
                  href={tab.key === "login" ? base : `${base}?tab=${tab.key}`}
                  aria-current={current ? "page" : undefined}
                  scroll={false}
                  className={cn(
                    "inline-flex h-10 items-center border-b-2 px-1 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap no-underline transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                    current
                      ? "border-[var(--primary)] text-[var(--ink)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Login activity: the 50 newest attempts, failures included (matched by email as well as id). */
export async function UserLoginTab({ userId, email }: { userId: string; email: string | null }) {
  const events = await fetchUserLoginEvents(userId, email);
  return (
    // The shared table draws its own bordered shell; inside this card the card is the shell.
    <div className="[&>div]:rounded-none [&>div]:border-0">
      <LoginActivityTable
        events={events}
        layout="board"
        // One user's page: every row's actor is the same email, and the column is ~713px wide.
        hideActor
        minWidth={600}
        empty={
          <div className="px-4 py-10 text-center">
            <p className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              No login attempts recorded yet
            </p>
            <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
              Every sign-in and failed attempt for this person or their email lands here.
            </p>
          </div>
        }
        footer={
          events.length > 0 ? (
            <p className={FOOT}>
              {events.length === 50 ? "The 50 most recent attempts" : `All ${events.length} recorded attempts`},
              successful or not · newest first
            </p>
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * Sessions: sign-ins recent enough that their session may not have expired. The product keeps no
 * live session list (a session is a signed cookie), so this says what can be known and no more.
 */
export async function UserSessionsTab({ userId, status }: { userId: string; status: string }) {
  const signIns = await fetchRecentSignIns(userId, new Date());
  const hours = Math.round(SESSION_WINDOW_SECONDS / 3600);
  const blocked = status !== "active";

  return (
    <>
      {blocked && signIns.length > 0 && (
        <p className="m-0 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2.5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
          None of these can be used: this account is {userStatusLabel(status).toLowerCase()}, and every request from it is
          refused.
        </p>
      )}

      {signIns.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            No sign-ins in the last {hours} hours
          </p>
          <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
            Nothing this person started from a sign-in could still be open.
          </p>
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="bg-[var(--surface-alt)]">
                <th scope="col" className={cn(TH, "w-[190px]")}>Signed in</th>
                <th scope="col" className={cn(TH, "w-[140px]")}>IP</th>
                <th scope="col" className={TH}>User agent</th>
                <th scope="col" className={cn(TH, "w-[200px]")}>Session</th>
              </tr>
            </thead>
            <tbody>
              {signIns.map((signIn) => (
                <tr key={signIn.id}>
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                    <DashboardUtcTime iso={signIn.ts} text={loginEventTime(signIn.ts)} />
                  </td>
                  <td className={cn(TD, "tabular-nums")}>{signIn.ip ?? "—"}</td>
                  <td className={cn(TD, "max-w-[240px] truncate")} title={signIn.userAgent ?? undefined}>
                    {summariseUserAgent(signIn.userAgent) ?? "—"}
                  </td>
                  <td className={TD}>
                    {blocked ? (
                      <Pill tone="neutral">Ended</Pill>
                    ) : (
                      <>
                        <Pill tone="info" dot>
                          May still be open
                        </Pill>
                        <span className={cn(SUB, "mt-0.5 tabular-nums")}>
                          until <DashboardUtcTime iso={signIn.expiresAt} text={utcDateTime(signIn.expiresAt)} />
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </>
  );
}

function actionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action as AuditAction] ?? action;
}

function who(row: UserAuditRow): { name: string; sub: string | null } {
  if (row.actorType === "system") return { name: "System", sub: "Scheduled job or provider event" };
  if (row.actorType === "tenant") return { name: row.actorName ?? "Agency member", sub: "Agency" };
  if (row.actorName) return { name: row.actorName, sub: "Staff" };
  return { name: "Staff member", sub: row.actorId ? "No longer on the admin list" : null };
}

/** Audit: what has been done to this person, newest first, 25 a page. Read-only. */
export async function UserAuditTab({ userId, page }: { userId: string; page: number }) {
  const { rows, total } = await fetchUserAuditPage(userId, page);
  const auditLogHref = `/admin/audit-log?target=${encodeURIComponent(userId)}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-2.5">
        <Link
          href={auditLogHref}
          className="rounded-sm text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--accent-ink)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          Open in the audit log
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="border-t border-[var(--border)] px-4 py-10 text-center">
          <p className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {page > 1 ? "Nothing on this page" : "No recorded actions yet"}
          </p>
          <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
            {page > 1 ? "The history is shorter than this." : "Nobody on staff or in their agency has changed this account."}
          </p>
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="bg-[var(--surface-alt)]">
                <th scope="col" className={cn(TH, "w-[190px]")}>When</th>
                <th scope="col" className={TH}>Who</th>
                <th scope="col" className={TH}>What</th>
                <th scope="col" className={TH}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const actor = who(row);
                return (
                  <tr key={row.id}>
                    <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                      <DashboardUtcTime iso={row.ts} text={loginEventTime(row.ts)} />
                    </td>
                    <td className={TD}>
                      <span className="font-semibold text-[var(--ink)]">{actor.name}</span>
                      {actor.sub && <span className={SUB}>{actor.sub}</span>}
                    </td>
                    <td className={TD}>
                      <span className="font-semibold text-[var(--ink)]">{actionLabel(row.action)}</span>
                      <span className={cn(SUB, "font-mono")}>{row.action}</span>
                    </td>
                    <td className={cn(TD, "max-w-[280px] break-words")}>
                      {row.reason ?? <span className="text-[var(--muted)]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(total > 0 || page > 1) && (
        <UserDetailPager
          baseHref={`/admin/users/${userId}?tab=audit`}
          page={page}
          pageSize={USER_AUDIT_PAGE_SIZE}
          total={total}
          itemLabel={total === 1 ? "action" : "actions"}
          order="newest first"
        />
      )}
    </>
  );
}
