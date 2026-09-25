import type { ReactElement } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { Callout, Pill } from "@/components/app/settings/primitives";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/adminAuth/roles";
import { activeAdminsByRole, formatUtcDateTime, plural } from "@/lib/adminDashboard/figures";
import { fetchDashboardFigures } from "@/lib/adminDashboard/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** The board writes role names in sentence case ("Super admin"); the shared labels are title case. */
function roleLabel(role: AdminRole) {
  const label = ADMIN_ROLE_LABELS[role];
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/** "Start here": three steps, each a list of pages. Links are unchanged from the previous dashboard. */
const STEPS: { title: string; open?: boolean; links: { label: string; href: string }[] }[] = [
  {
    title: "Establish who and what is active",
    open: true,
    links: [
      { label: "Tenants", href: "/admin/tenants" },
      { label: "Users", href: "/admin/users" },
    ],
  },
  {
    title: "Configure what customers can buy",
    links: [
      { label: "Plans", href: "/admin/plans" },
      { label: "Features", href: "/admin/features" },
      { label: "Products", href: "/admin/products" },
    ],
  },
  {
    title: "Verify changes and platform health",
    links: [
      { label: "Audit log", href: "/admin/audit-log" },
      { label: "Maintenance", href: "/admin/system" },
      { label: "Compliance", href: "/admin/compliance-sources" },
    ],
  },
];

const cardClass = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6";
const cardTitle = "m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";
const factLabel = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const factValue = "mt-1 block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] tabular-nums text-[var(--ink)]";

export default async function AdminDashboardPage() {
  const admin = await getCurrentAdmin();

  const supabase = getSupabaseServiceClient();
  const [{ data: rows, error }, figures] = await Promise.all([
    supabase.from("admin_users").select("role, is_active"),
    admin ? fetchDashboardFigures(admin.role) : null,
  ]);

  // Without this the dashboard greets a failed query with no admins at all, which is both wrong and
  // impossible — somebody is logged in reading it.
  if (error) throw new Error(`Could not load admin counts: ${error.message}`);

  const admins = (rows ?? []) as { role: AdminRole; is_active: boolean }[];
  const byRole = activeAdminsByRole(admins);
  const deactivated = admins.filter((row) => !row.is_active).length;
  const signedIn = formatUtcDateTime(admin?.last_login_at);

  const tiles: ReactElement[] = [];
  if (figures?.tenants) {
    tiles.push(
      <BoardStatTile
        key="tenants"
        label="Tenants"
        value={figures.tenants.total.toLocaleString("en-US")}
        footnote={`${figures.tenants.suspended.toLocaleString("en-US")} suspended`}
      />,
    );
  }
  if (figures?.subscriptions) {
    const { active, startedThisWeek } = figures.subscriptions;
    tiles.push(
      <BoardStatTile
        key="subscriptions"
        label="Active subscriptions"
        value={active.toLocaleString("en-US")}
        tone={active > 0 ? "success" : "default"}
        footnote={`${startedThisWeek.toLocaleString("en-US")} started this week`}
        title="Subscriptions with status active. The footnote counts those that started since Monday 00:00 UTC."
      />,
    );
  }
  if (figures?.logins) {
    const { failedToday, lockedEmails } = figures.logins;
    tiles.push(
      <BoardStatTile
        key="logins"
        label="Failed logins today"
        value={failedToday.toLocaleString("en-US")}
        tone={failedToday > 0 ? "warning" : "default"}
        footnote={lockedEmails === null ? "wrong password, locked or blocked" : plural(lockedEmails, "sign-in lockout", "sign-in lockouts")}
        title={
          lockedEmails === null
            ? "Failed sign-in attempts today, tenant users and staff alike — the figure on Login activity."
            : "Failed sign-in attempts today, as on Login activity. Lockouts count email addresses locked out of signing in right now."
        }
      />,
    );
  }
  if (figures?.mismatchedInvoices !== null && figures?.mismatchedInvoices !== undefined) {
    tiles.push(
      <BoardStatTile
        key="mismatched"
        label="Mismatched invoices"
        value={figures.mismatchedInvoices.toLocaleString("en-US")}
        tone={figures.mismatchedInvoices > 0 ? "error" : "default"}
        footnote="we billed a different amount"
      />,
    );
  }

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader title="Platform administration" subtitle="Start with the workspace you need below." />

      {tiles.length > 0 && <BoardStatGrid>{tiles}</BoardStatGrid>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className={`m-card ${cardClass}`} aria-labelledby="start-here-title">
          <div>
            <h2 id="start-here-title" className={cardTitle}>
              Start here
            </h2>
            <p className="mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
              The order of operations, for someone who opens this panel twice a month.
            </p>
          </div>

          {STEPS.map((step, index) => (
            <details key={step.title} className="group border-t border-[var(--border)] py-3.5" open={step.open}>
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <span className="inline-flex -rotate-90 text-[var(--muted)] transition-transform duration-150 group-open:rotate-0 motion-reduce:transition-none" aria-hidden="true">
                  <ChevronDown className="size-[13px]" strokeWidth={2.4} />
                </span>
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] tabular-nums text-[var(--ink)]">
                  {index + 1}
                </span>
                <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{step.title}</span>
              </summary>

              {step.links.map((link) => (
                <div key={link.href} className="flex items-center gap-3 border-t border-[var(--border)] py-2.5">
                  <span className="flex-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{link.label}</span>
                  <Link
                    href={link.href}
                    className="m-arrow inline-flex items-center gap-1.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] no-underline"
                  >
                    Open<span className="sr-only"> {link.label}</span>
                    <ArrowRight className="size-[13px]" strokeWidth={2.4} aria-hidden="true" />
                  </Link>
                </div>
              ))}
            </details>
          ))}
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <section className={cardClass} aria-labelledby="admins-by-role-title">
            <h2 id="admins-by-role-title" className={cardTitle}>
              Admins by role
            </h2>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {byRole.map(({ role, count }) => (
                <Pill key={role} tone={role === "super_admin" ? "info" : "neutral"} dot>
                  {roleLabel(role)} &middot; {count.toLocaleString("en-US")}
                </Pill>
              ))}
              {byRole.length === 0 && (
                <p className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No active admins.</p>
              )}
            </div>
            {deactivated > 0 && (
              <p className="mt-2 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                {plural(deactivated, "deactivated account is", "deactivated accounts are")} not counted.
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <div className={factLabel}>Your role</div>
                <span className={factValue}>{admin ? roleLabel(admin.role) : "—"}</span>
              </div>
              <div>
                <div className={factLabel}>Signed in</div>
                {admin?.last_login_at && signedIn ? (
                  <DashboardUtcTime iso={admin.last_login_at} text={signedIn} className={factValue} />
                ) : (
                  <span className={factValue}>First sign-in</span>
                )}
              </div>
            </div>
          </section>

          <Callout tone="info" title="Counting admins is the least useful fact available">
            The tiles above are platform health instead &mdash; each one comes from the page that owns it.
          </Callout>
        </div>
      </div>
    </div>
  );
}
