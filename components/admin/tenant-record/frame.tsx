import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { subscriptionTone, type StatusTone } from "@/components/admin/status-chip";
import { Pill, type PillTone } from "@/components/app/settings/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TenantSuspensionControl } from "@/components/admin/tenant-record/suspension-control";
import { TENANT_TABS, type TenantTabKey } from "@/components/admin/tenant-record/types";
import { formatCentsAsCurrency } from "@/lib/money";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions/access";
import type { TenantRecordFrame as FrameData } from "@/lib/tenants/recordFrame";
import { recordDate, sentenceCase } from "@/lib/tenants/recordFormat";
import { isTenantSuspended } from "@/lib/tenants/suspension";
import { cn } from "@/lib/utils";

const FACT = "block truncate text-lg leading-[1.33]";

const PILL_FOR: Record<StatusTone, PillTone> = {
  neutral: "neutral",
  good: "success",
  info: "info",
  warning: "warning",
  danger: "error",
  action: "brand",
};

/**
 * The frame every tab of the admin tenant record shares (boards p-adm-tenant-subscription / users /
 * features): back link, header with the state chips and its actions, the five-fact strip and the
 * page-level tab strip. Server-rendered; the only island is the Suspend / Unsuspend control.
 *
 * Tabs are links (`?tab=`), not a JS tablist: each is its own server render, fetches only its own
 * data, and can be bookmarked, opened in a new tab and reached with the back button.
 */
export function TenantRecordFrame({
  frame,
  activeTab,
  canSuspend,
  suspensionReason,
}: {
  frame: FrameData;
  activeTab: TenantTabKey;
  /** super_admin only (decision 4). Everyone else sees the state, never the control. */
  canSuspend: boolean;
  /** From the latest suspend audit row; shown as the Suspended chip's tooltip. */
  suspensionReason: string | null;
}) {
  const { tenant, subscription, owner, seats } = frame;
  const suspended = isTenantSuspended(tenant.status);
  const planLabel = subscription?.plan_name
    ? `${subscription.plan_name} v${subscription.plan_version ?? "?"}`
    : null;
  const seatsFull = seats.used !== null && seats.max !== null && seats.used >= seats.max;
  // When the members could not be read the count is unknown — never shown as 0. The reason is the tooltip.
  const seatsTitle = seats.unavailable ? `Seats could not be counted: ${seats.unavailable}` : undefined;
  const statusLabel = subscription ? SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? sentenceCase(subscription.status) : null;

  let mrr = "—";
  if (subscription && frame.mrrCents !== null) {
    mrr = frame.mrrCounts
      ? formatCentsAsCurrency(frame.mrrCents)
      : `${formatCentsAsCurrency(0)} · ${(statusLabel ?? "").toLowerCase()}`;
  } else if (!subscription) {
    mrr = formatCentsAsCurrency(0);
  }

  const base = `/admin/tenants/${tenant.id}`;

  return (
    <>
      <div>
        <Link
          href="/admin/tenants"
          className="mb-2.5 inline-flex items-center gap-2 rounded-sm text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          <ArrowLeft className="size-[13px] stroke-[2.4]" aria-hidden="true" />
          Back to tenants
        </Link>
        <PageHeader
          title={tenant.name}
          actions={
            <>
              <span role="group" className="flex flex-wrap items-center gap-2" aria-label="Agency state">
                {tenant.status !== "active" && (
                  <span title={suspended && suspensionReason ? `Reason: ${suspensionReason}` : undefined}>
                    <Pill tone={suspended || tenant.status === "cancelled" ? "error" : "info"} dot>
                      {sentenceCase(tenant.status)}
                    </Pill>
                  </span>
                )}
                {subscription ? (
                  <Pill tone={PILL_FOR[subscriptionTone(subscription.status)]} dot>
                    {statusLabel}
                  </Pill>
                ) : (
                  <Pill tone="neutral">No subscription</Pill>
                )}
              </span>
              {canSuspend && tenant.status !== "cancelled" && (
                <TenantSuspensionControl tenantId={tenant.id} tenantName={tenant.name} suspended={suspended} />
              )}
            </>
          }
        />
      </div>

      {/* Mostly names and dates rather than counts, so the values are set at 18px (FACT) and truncate,
          instead of the strip's 24px figure. */}
      <StatStrip label="Key facts">
        <StatTile
          label="Owner"
          value={<span className={FACT} title={owner ? `${owner.name} · ${owner.email}` : undefined}>{owner?.name ?? "No owner yet"}</span>}
          footnote={owner ? <span className="block truncate">{owner.email}</span> : undefined}
          reserveFootnote
        />
        <StatTile label="Plan" value={<span className={FACT} title={planLabel ?? undefined}>{planLabel ?? "None"}</span>} footnote={statusLabel ?? "no subscription"} />
        <StatTile
          label="Seats"
          labelTitle={seatsTitle}
          value={<span className={FACT}>{seats.used === null ? "—" : seats.used.toLocaleString("en-US")}</span>}
          valueTone={seatsFull ? "warning" : undefined}
          footnote={seats.used === null ? "not counted" : seats.max === null ? "no limit" : `of ${seats.max.toLocaleString("en-US")}`}
        />
        <StatTile label="MRR" value={<span className={FACT}>{mrr}</span>} reserveFootnote />
        <StatTile label="Joined" value={<span className={FACT}>{recordDate(tenant.createdAt)}</span>} reserveFootnote />
      </StatStrip>

      <nav aria-label="Tenant record" className="min-w-0 overflow-x-auto">
        <ul className="m-0 flex w-max min-w-full list-none gap-6 border-b border-[var(--border)] p-0">
          {TENANT_TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <li key={tab.key}>
                <Link
                  href={tab.key === "overview" ? base : `${base}?tab=${tab.key}`}
                  aria-current={active ? "page" : undefined}
                  scroll={false}
                  className={cn(
                    "inline-flex h-10 items-center border-b-2 px-1 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap no-underline transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                    active
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
    </>
  );
}
