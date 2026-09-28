import Link from "next/link";

import type { TenantTabProps } from "@/components/admin/tenant-record/types";
import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import { fetchTenantActivity, TENANT_ACTIVITY_PAGE_SIZE, type TenantActivityRow } from "@/lib/tenants/activity";
import { recordDateTime, sentenceCase } from "@/lib/tenants/recordFormat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/table-card";

// The boards' table vocabulary (settings primitives' `st`), restated here because a server
// component cannot read values out of a "use client" module.
const TH = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase whitespace-nowrap text-[var(--muted)]";
const TD = "border-t border-[var(--border)] px-3 py-2 align-top text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";
const SUB = "block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";

const TARGET_LABELS: Record<string, string> = {
  tenant: "Agency",
  subscription: "Subscription",
  user: "Person",
  invoice: "Invoice",
};

function actionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action as AuditAction] ?? action;
}

function who(row: TenantActivityRow): { name: string; sub: string | null } {
  if (row.actorType === "system") return { name: "System", sub: "Scheduled job or provider event" };
  if (row.actorName) return { name: row.actorName, sub: "Staff" };
  return { name: "Staff member", sub: row.actorId ? "No longer on the admin list" : null };
}

function target(row: TenantActivityRow, tenantId: string): { name: string; sub: string | null } {
  if (row.targetId === tenantId) return { name: "This agency", sub: null };
  const kind = row.targetType ? (TARGET_LABELS[row.targetType] ?? sentenceCase(row.targetType)) : "Record";
  return { name: kind, sub: row.targetId ? `${row.targetId.slice(0, 8)}…` : null };
}

/**
 * Activity: what staff and the platform did to this agency — the admin audit trail for the tenant,
 * its subscriptions, its people and its invoices — newest first, 50 a page. Read-only.
 *
 * Everyone who can open the tenant sees the full history (user decision). /admin/audit-log keeps its
 * stricter rule, where only super_admin sees every staff member's actions.
 */
export async function TenantActivityTab({ tenantId, page }: TenantTabProps & { page: number }) {
  const { rows, total, partial } = await fetchTenantActivity(tenantId, { page });

  const pages = Math.max(1, Math.ceil(total / TENANT_ACTIVITY_PAGE_SIZE));
  const base = `/admin/tenants/${tenantId}?tab=activity`;
  const first = total === 0 ? 0 : (page - 1) * TENANT_ACTIVITY_PAGE_SIZE + 1;
  const last = (page - 1) * TENANT_ACTIVITY_PAGE_SIZE + rows.length;

  return (
    <TableCard
      toolbar={
        partial ? (
          <p role="note" className="m-0 text-xs text-[var(--warning-ink)]">
            Partial history: the agency, its subscriptions, its newest 100 people and newest 60 invoices.
          </p>
        ) : undefined
      }
      footer={
        total > 0 || page > 1 ? (
          <>
            <span className="tabular-nums">{rows.length ? `${first}–${last} of ${total} · newest first` : `Page ${page}`}</span>
            <span className="flex items-center gap-2">
              {page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={page === 2 ? base : `${base}&page=${page - 1}`} scroll={false} className="no-underline">
                    Newer
                  </Link>
                </Button>
              )}
              {page < pages && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`${base}&page=${page + 1}`} scroll={false} className="no-underline">
                    Older
                  </Link>
                </Button>
              )}
            </span>
          </>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {page > 1 ? "Nothing on this page" : "No recorded actions yet"}
          </p>
          <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
            {page > 1
              ? "The history is shorter than this."
              : "Staff and system actions on this agency appear here."}
          </p>
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="bg-[var(--surface-alt)]">
                <th scope="col" className={TH}>When</th>
                <th scope="col" className={TH}>Who</th>
                <th scope="col" className={TH}>What</th>
                <th scope="col" className={TH}>On</th>
                <th scope="col" className={TH}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const actor = who(row);
                const on = target(row, tenantId);
                return (
                  <tr key={row.id}>
                    <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{recordDateTime(row.ts)}</td>
                    <td className={TD}>
                      <span className="font-semibold text-[var(--ink)]">{actor.name}</span>
                      {actor.sub && <span className={SUB}>{actor.sub}</span>}
                    </td>
                    <td className={TD}>
                      <span className="font-semibold text-[var(--ink)]">{actionLabel(row.action)}</span>
                      <span className={cn(SUB, "font-mono")}>{row.action}</span>
                    </td>
                    <td className={TD}>
                      {on.name}
                      {on.sub && (
                        <span className={cn(SUB, "font-mono")} title={row.targetId ?? undefined}>
                          {on.sub}
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, "max-w-[320px] break-words")}>
                      {row.reason ?? <span className="text-[var(--muted)]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}
