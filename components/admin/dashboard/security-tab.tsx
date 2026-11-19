import { Suspense } from "react";

import { LineSeries } from "@/components/ui/chart";
import { ADMIN_ROLE_LABELS } from "@/lib/adminAuth/roles";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { activeAdminsByRole } from "@/lib/adminDashboard/figures";
import { adminAccounts, signInDayCounts, signInScope, staffChangesToday } from "@/lib/adminDashboard/securityQueries";
import { GraphCard, GraphCardError, GraphCardLoading, GraphEmpty, settleCard } from "./ov-card";
import type { DashboardAdmin } from "./types";

const DAYS = 14;

/** A server render reads the clock once per request, which is the point. */
function readNow() {
  return Date.now();
}

const n = (value: number) => value.toLocaleString("en-US");

/* ── Sign-ins per day ─────────────────────────────────────────────────────────────────────────── */

async function SecSignIns({ admin }: { admin: DashboardAdmin }) {
  const title = "Sign-ins per day";
  const now = readNow();
  const { includeStaff } = signInScope(admin.role);
  const days = await settleCard(title, () => signInDayCounts(DAYS, includeStaff, now));
  if (!days) return <GraphCardError title={title} />;

  const today = days[days.length - 1];
  const attempts = today.succeeded + today.failed;
  const link = canOpenAdminHref(admin.role, "/admin/activity") ? { label: "Login activity", href: "/admin/activity" } : null;
  const who = includeStaff ? "customers and staff" : "customers";
  const any = days.some((day) => day.succeeded + day.failed > 0);

  return (
    <GraphCard
      title={title}
      link={link}
      value={n(today.succeeded)}
      line={`today · ${n(today.failed)} failed of ${n(attempts)} attempt${attempts === 1 ? "" : "s"}`}
      foot={`Last ${DAYS} days, ${who}, UTC days.`}
    >
      {any ? (
        <LineSeries
          points={days.map((day) => ({ key: day.key, label: day.label, value: day.succeeded }))}
          summary={`Successful sign-ins per day over the last ${DAYS} days`}
          unit="sign-ins"
          minHeight={110}
          legend={{ label: "Signed in" }}
          lines={[{ key: "failed", label: "Failed", tone: "warning", dashed: true, points: days.map((day) => ({ key: day.key, label: day.label, value: day.failed })) }]}
        />
      ) : (
        <GraphEmpty title="No sign-ins yet" hint={`Nobody signed in during the last ${DAYS} days.`} />
      )}
    </GraphCard>
  );
}

/* ── Staff changes today ──────────────────────────────────────────────────────────────────────── */

async function SecStaffChanges({ admin }: { admin: DashboardAdmin }) {
  const own = admin.role !== "super_admin";
  const title = own ? "Your changes today" : "Staff changes today";
  const changes = await settleCard(title, () => staffChangesToday(admin.id, admin.role));
  if (!changes) return <GraphCardError title={title} />;
  const link = canOpenAdminHref(admin.role, "/admin/audit-log") ? { label: "Audit log", href: "/admin/audit-log" } : null;
  const more = changes.total - changes.rows.length;
  return (
    <GraphCard
      title={title}
      link={link}
      value={n(changes.total)}
      line={`change${changes.total === 1 ? "" : "s"} today (UTC), sign-ins left out`}
      foot={more > 0 ? `and ${n(more)} more in the audit log` : undefined}
    >
      {changes.rows.length === 0 ? (
        <GraphEmpty title="Nothing changed yet" hint={own ? "You haven't changed anything today." : "No staff member has changed anything today."} />
      ) : (
        <ul className="text-sm">
          {changes.rows.map((row) => (
            <li key={row.id} className="flex min-w-0 items-center gap-3 border-b border-[var(--rule)] py-1.5 last:border-b-0">
              {/* Staff, so initials (UI-CONSISTENCY §10 keeps avatars for staff); gold marks people (BRAND.md). */}
              <span title={row.who} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--highlight-soft)] text-xs font-semibold text-[var(--highlight-ink)]">
                {row.initials}
                <span className="sr-only"> {row.who}</span>
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground" title={row.what}>{row.what}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{row.time}</span>
            </li>
          ))}
        </ul>
      )}
    </GraphCard>
  );
}

/* ── Admins by role (moved here from the old home page) ───────────────────────────────────────── */

async function SecAdmins({ admin }: { admin: DashboardAdmin }) {
  // A plain card, not a TableCard: a TableCard that ends the page stretches to the screen's foot (the table
  // foundation), which is right for a list and wrong for three short cards side by side.
  const title = "Admins";
  const rows = await settleCard(title, () => adminAccounts());
  if (!rows) return <GraphCardError title={title} />;
  const link = canOpenAdminHref(admin.role, "/admin/admins") ? { label: "Admin users", href: "/admin/admins" } : null;
  const byRole = activeAdminsByRole(rows);
  const active = byRole.reduce((sum, item) => sum + item.count, 0);
  const deactivated = rows.filter((row) => !row.is_active).length;
  return (
    <GraphCard title={title} link={link} value={n(active)} line="active">
      <ul className="text-sm">
        {byRole.map(({ role, count }) => (
          <li key={role} className="flex items-center justify-between border-b border-[var(--rule)] py-2 text-foreground">
            <span>{ADMIN_ROLE_LABELS[role]}</span>
            <span className="tabular-nums">{n(count)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between py-2 text-muted-foreground">
          <span>Deactivated</span>
          <span className="tabular-nums">{n(deactivated)}</span>
        </li>
      </ul>
    </GraphCard>
  );
}

/**
 * Admin dashboard › Security & staff (admin round 1, docs/design/admin-r1/dashboard-combined.html §6): sign-ins
 * and failed attempts per day, what staff changed today, and the admins by role (moved here from the old home).
 * Each card streams and fails on its own. The pages' own rules hold: staff sign-ins count only for a role that
 * may see them, a non-super admin sees only their own changes, and Admin users is linked only for the role
 * that can open it.
 */
export async function SecurityTab({ admin }: { admin: DashboardAdmin }) {
  return (
    <div className="grid min-w-0 items-start gap-3 lg:grid-cols-3">
      <Suspense fallback={<GraphCardLoading title="Sign-ins per day" />}>
        <SecSignIns admin={admin} />
      </Suspense>
      <Suspense fallback={<GraphCardLoading title={admin.role === "super_admin" ? "Staff changes today" : "Your changes today"} />}>
        <SecStaffChanges admin={admin} />
      </Suspense>
      <Suspense fallback={<GraphCardLoading title="Admins" />}>
        <SecAdmins admin={admin} />
      </Suspense>
    </div>
  );
}
