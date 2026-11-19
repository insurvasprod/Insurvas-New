import { AUDIT_LOG_PAGE_SIZE } from "@/lib/audit/constants";
import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { AuditExportButton } from "@/components/admin/monitoring/audit-export-button";
import { MonitoringPage } from "@/components/admin/monitoring/monitoring-page";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import {
  AUDIT_EXPORT_LIMIT,
  fetchAuditEntry,
  fetchAuditLogPage,
  fetchAuditSummary,
  isSuperAdmin,
  listStaff,
  type AuditSummary,
} from "@/lib/audit/logQuery";
import { auditQueryString, parseAuditLogFilters, type AuditLogEntry } from "@/lib/audit/logView";
import { MONEY_ACTIONS_DESCRIPTION } from "@/lib/audit/moneyActions";

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Admin › Monitoring › Audit log (admin round 1, docs/design/admin-r1/monitoring.html screen 5), inside the Monitoring
 * frame. Every staff role may open it; only a super admin sees other people's actions (lib/audit/logQuery.ts), and the
 * tiles count the same rows the table shows. Every filter is in the address and is applied on the server for the first
 * render — `?target=` from a record's page still opens that record's history — and `?entry=` opens one entry's sheet.
 */
export default async function AuditLogPage({ searchParams }: { searchParams: Search }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const viewer = { id: admin.id, role: admin.role };
  const everyone = isSuperAdmin(viewer);

  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") params.set(key, first);
  }
  const filters = parseAuditLogFilters(params, AUDIT_ACTIONS);
  const entryId = params.get("entry");

  const staff = await listStaff(viewer);
  const [firstPage, summary] = await Promise.all([
    // Throws when the log cannot be read: the evidence of record must never render as "empty".
    fetchAuditLogPage(viewer, filters, staff),
    fetchAuditSummary(viewer).catch((error: unknown): AuditSummary | null => {
      console.error("audit log summary failed", error);
      return null;
    }),
  ]);
  // A linked entry not on this page is read on its own (still under the per-actor rule).
  const entry: AuditLogEntry | null =
    entryId && !firstPage.entries.some((row) => row.id === entryId)
      ? await fetchAuditEntry(viewer, entryId, staff).catch((error: unknown) => {
          console.error("audit entry read failed", error);
          return null;
        })
      : null;

  // The tiles' links name UTC days, from the clock the rows were read at.
  const weekAgo = new Date(firstPage.readAt - 6 * 86_400_000).toISOString().slice(0, 10);
  const today = new Date(firstPage.readAt).toISOString().slice(0, 10);
  const admins = summary?.todayAdmins;
  const by = !summary
    ? null
    : everyone
      ? admins === null || admins === undefined
        ? null
        : `by ${summary.todayAdminsAtLeast ? "at least " : ""}${plural(admins, "admin", "admins")}`
      : "all yours";

  return (
    <MonitoringPage
      step="audit"
      info="Every recorded staff, agency and system action, newest first. Nothing is purged, and the database refuses edits and deletes, including from a super admin."
      actions={<AuditExportButton isSuperAdmin={everyone} limit={AUDIT_EXPORT_LIMIT} />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Audit log at a glance">
          <StatTile
            label="Entries today"
            value={summary ? summary.todayCount.toLocaleString("en-US") : "—"}
            footnote={!summary ? "Could not be counted" : everyone ? (by ? by.replace(/^by /, "") : "Staff count unavailable") : "Your actions"}
            labelTitle="Since 00:00 UTC today"
            href={`/admin/audit-log?from=${today}`}
          />
          <StatTile
            label="This week"
            value={summary ? summary.weekCount.toLocaleString("en-US") : "—"}
            footnote={summary ? (everyone ? "Last 7 days" : "Your actions, last 7 days") : "Could not be counted"}
            labelTitle="The last 7 days, to this moment"
            href={`/admin/audit-log?from=${weekAgo}`}
          />
          <StatTile
            label="Money actions"
            value={summary ? summary.moneyCount.toLocaleString("en-US") : "—"}
            footnote={summary ? "Billing and credit, 7 days" : "Could not be counted"}
            labelTitle={MONEY_ACTIONS_DESCRIPTION}
            href={`/admin/audit-log?lens=money&from=${weekAgo}`}
          />
        </StatStrip>

        <AuditLogTable
          initialEntries={firstPage.entries}
          initialTotal={firstPage.total}
          initialApproximate={firstPage.approximate}
          initialQuery={auditQueryString(filters, everyone)}
          initialEntry={entry}
          renderedAt={firstPage.readAt}
          pageSize={AUDIT_LOG_PAGE_SIZE}
          isSuperAdmin={everyone}
          allAdmins={staff}
          role={admin.role}
        />
      </div>
    </MonitoringPage>
  );
}
