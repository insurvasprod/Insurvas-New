import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { TenantsListCreate } from "@/components/admin/tenants-list-create";
import { TenantsTable } from "@/components/admin/tenants-table";
import { Callout } from "@/components/app/settings/primitives";
import { canViewTenants } from "@/lib/tenants/permissions";
import { tenantListStats } from "@/lib/tenantsList/present";
import { fetchTenantList } from "@/lib/tenantsList/queries";

/** A server render reads the clock once per request, which is the point. */
function readClock() {
  return Date.now();
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export default async function TenantsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewTenants(admin.role)) redirect("/admin");

  // Throws on a failed read rather than rendering an empty table: a query that failed and a platform
  // with no customers must never look the same. The route's error boundary offers Try again.
  const rows = await fetchTenantList();
  const stats = tenantListStats(rows, readClock());

  const beyond = [
    stats.provisioning > 0 ? `${stats.provisioning.toLocaleString("en-US")} provisioning` : null,
    stats.cancelled > 0 ? `${stats.cancelled.toLocaleString("en-US")} cancelled` : null,
  ].filter(Boolean);

  const trialFoot =
    stats.trial === 0
      ? "none in flight"
      : [
          `${stats.trialsEndingSoon.toLocaleString("en-US")} end within 7 days`,
          stats.trialsPastEnd > 0 ? `${stats.trialsPastEnd.toLocaleString("en-US")} past end date` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Tenants"
        subtitle="Every customer account on the platform, with its owner, plan and onboarding state."
        // POST /api/admin/tenants is super_admin only; nobody else is offered a button it would refuse.
        actions={admin.role === "super_admin" ? <TenantsListCreate /> : undefined}
      />

      <BoardStatGrid>
        <BoardStatTile
          label="Tenants"
          value={stats.total.toLocaleString("en-US")}
          footnote={["all states", ...beyond].join(" · ")}
        />
        <BoardStatTile
          label="Active"
          value={stats.active.toLocaleString("en-US")}
          tone={stats.active > 0 ? "success" : "default"}
          footnote={stats.total > 0 ? `${((stats.active / stats.total) * 100).toFixed(1)}%` : "no tenants yet"}
          title="Active and not in a trial, as a share of every tenant"
        />
        <BoardStatTile
          label="In trial"
          value={stats.trial.toLocaleString("en-US")}
          tone={stats.trial > 0 ? "warning" : "default"}
          footnote={trialFoot}
          title="Active tenants whose live subscription is trialing"
        />
        <BoardStatTile
          label="Suspended"
          value={stats.suspended.toLocaleString("en-US")}
          tone={stats.suspended > 0 ? "error" : "default"}
          footnote={stats.oldestSuspendedDays === null ? (stats.suspended > 0 ? "no suspension date recorded" : "none on hold") : `oldest ${plural(stats.oldestSuspendedDays, "day", "days")}`}
        />
      </BoardStatGrid>

      <TenantsTable rows={rows} />

      <Callout tone="info" title="Status and onboarding state are two different axes">
        <p className="m-0">
          They are chipped differently on purpose — a suspended tenant can have completed onboarding, and a trialling one may
          not have. A tenant is never deleted.
        </p>
      </Callout>
    </div>
  );
}
