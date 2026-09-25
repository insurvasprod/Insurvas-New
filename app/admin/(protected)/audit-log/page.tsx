import { AUDIT_LOG_PAGE_SIZE } from "@/lib/audit/constants";
import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { Callout } from "@/components/app/settings/primitives";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { fetchAuditLogPage, fetchAuditSummary, isSuperAdmin, listStaff, type AuditSummary } from "@/lib/audit/logQuery";
import { parseAuditLogFilters } from "@/lib/audit/logView";
import { MONEY_ACTIONS_DESCRIPTION } from "@/lib/audit/moneyActions";

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const viewer = { id: admin.id, role: admin.role };
  const everyone = isSuperAdmin(viewer);

  // `?target=` deep-links one record's history (detail screens link here). It is applied on the
  // server, so the first render is already the filtered list rather than the whole log.
  const { target } = await searchParams;
  const initialFilters = parseAuditLogFilters(new URLSearchParams(target ? { target } : {}), AUDIT_ACTIONS);

  const staff = await listStaff(viewer);
  const [firstPage, summary] = await Promise.all([
    // Throws when the log cannot be read: the evidence of record must never render as "empty".
    fetchAuditLogPage(viewer, initialFilters, staff),
    fetchAuditSummary(viewer).catch((error: unknown): AuditSummary | null => {
      console.error("audit log summary failed", error);
      return null;
    }),
  ]);

  const unavailable = "—";
  const todayFoot = !summary
    ? "could not be counted"
    : everyone
      ? summary.todayAdmins === null
        ? "staff count unavailable"
        : `${summary.todayAdminsAtLeast ? "at least " : ""}${plural(summary.todayAdmins, "admin", "admins")}`
      : "your actions";

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Audit log"
        subtitle={
          everyone
            ? "Every recorded action — staff, agency users and system — platform-wide. Append-only."
            : "Your own recorded actions. Append-only."
        }
      />

      <BoardStatGrid>
        <BoardStatTile
          label="Entries today"
          value={summary ? summary.todayCount.toLocaleString() : unavailable}
          footnote={todayFoot}
          title="Since 00:00 UTC today"
        />
        <BoardStatTile
          label="This week"
          value={summary ? summary.weekCount.toLocaleString() : unavailable}
          footnote={summary ? (everyone ? "last 7 days" : "your actions, last 7 days") : "could not be counted"}
          title="The last 7 days, to this moment"
        />
        <BoardStatTile
          label="Money actions"
          value={summary ? summary.moneyCount.toLocaleString() : unavailable}
          tone={summary && summary.moneyCount > 0 ? "warning" : "default"}
          footnote={summary ? "billing and credit actions, last 7 days" : "could not be counted"}
          title={MONEY_ACTIONS_DESCRIPTION}
        />
        <BoardStatTile
          label="Retention"
          value="Kept indefinitely"
          footnote="nothing is purged; edits and deletes are refused"
        />
      </BoardStatGrid>

      <AuditLogTable
        initialEntries={firstPage.entries}
        initialTotal={firstPage.total}
        initialApproximate={firstPage.approximate}
        initialTarget={initialFilters.target ?? ""}
        renderedAt={firstPage.readAt}
        pageSize={AUDIT_LOG_PAGE_SIZE}
        isSuperAdmin={everyone}
        allAdmins={staff}
      />

      <Callout tone="error" title="There is no edit and no delete on this page, for anyone">
        {everyone
          ? "The database refuses any change to a recorded entry, including from a super admin. You see every actor's actions; other staff see only their own. Times are in UTC — hover a time for your local time."
          : "The database refuses any change to a recorded entry. You see only the actions you took yourself; a super admin can see everyone's. Times are in UTC — hover a time for your local time."}
      </Callout>
    </div>
  );
}
