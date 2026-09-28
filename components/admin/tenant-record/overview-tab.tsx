import Link from "next/link";
import { notFound } from "next/navigation";

import { Callout, KeyValues, SettingsCard } from "@/components/app/settings/primitives";
import { TenantUsagePanel } from "@/components/admin/tenant-usage-panel";
import type { TenantTabProps } from "@/components/admin/tenant-record/types";
import { fetchTenantUsage } from "@/lib/metering/queries";
import { BILLING_CYCLE_LABELS } from "@/lib/money";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { SUBSCRIPTION_STATUS_LABELS, accessLevelForStatus, availableActions } from "@/lib/subscriptions/access";
import type { SubscriptionRow } from "@/lib/subscriptions/queries";
import { fetchLatestSuspension, fetchTenantRecordFrame } from "@/lib/tenants/recordFrame";
import { recordDate, recordDayMonth, sentenceCase } from "@/lib/tenants/recordFormat";
import { isTenantSuspended } from "@/lib/tenants/suspension";
import { Button } from "@/components/ui/button";

/**
 * Overview (board p-adm-tenant-detail), inside the record's approved frame.
 *
 * The board's own frame (subtitle, chips, facts) and its inner card tabs are not drawn: the frame is
 * the tab boards', and the inner tabs would repeat the page tabs above them. What the board puts in
 * its card is here — the subscription at a glance and its three money controls — beside usage
 * against plan limits. The controls are links to Subscription & billing (decision 1): money moves
 * in one place, where each dialog confirms with its effective date.
 *
 * Below the subscription card, the account facts the old tenant detail showed (tenant id, owner,
 * onboarding, collection). When the agency is suspended, when, by whom and why sits above both
 * columns. Every role that can open the record sees all of it; the links are gated by the same
 * helper the subscription routes use.
 */

const DANGER_LINK = "border-[var(--error)] text-[var(--error-ink)] no-underline hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]";

const ACCESS_NOTE = {
  read_only: "Read-only: they can still open their book of business, but cannot dial, import or sell.",
  none: "No access.",
} as const;


/**
 * "12 Sep – 11 Oct 2026": the days the period covers. It ends AT its end instant (the next period
 * starts there), so the last day covered is the one before a midnight end. UTC, like every date on
 * the record.
 */
function periodCovered(start: string | null, end: string | null): string {
  if (!start || !end) return start ? `From ${recordDate(start)}` : "—";
  const from = new Date(start);
  const last = new Date(new Date(end).getTime() - 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(last.getTime())) return "—";
  const sameYear = from.getUTCFullYear() === last.getUTCFullYear();
  return `${sameYear ? recordDayMonth(start) : recordDate(start)} – ${recordDate(last.toISOString())}`;
}

function planName(name: string | null, version: number | null): string {
  return `${name ?? "Unknown plan"} v${version ?? "?"}`;
}

function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{item.label}</dt>
          <dd className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] break-words text-[var(--ink)] tabular-nums">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SubscriptionCard({
  tenantId,
  subscription,
  canManage,
}: {
  tenantId: string;
  subscription: SubscriptionRow | null;
  canManage: boolean;
}) {
  const tabHref = `/admin/tenants/${tenantId}?tab=subscription`;
  const actions = subscription ? availableActions(subscription.status) : null;
  const access = subscription ? accessLevelForStatus(subscription.status) : "full";
  const periodEnd = subscription?.current_period_end ? recordDate(subscription.current_period_end) : null;

  return (
    <section
      aria-labelledby="overview-subscription"
      className="flex min-w-0 flex-1 flex-col gap-5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <h2 id="overview-subscription" className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">
        Subscription
      </h2>

      {subscription ? (
        <>
          <Facts
            items={[
              { label: "Plan", value: `${subscription.plan_name ?? "Unknown plan"} · v${subscription.plan_version ?? "?"}` },
              { label: "Cycle", value: BILLING_CYCLE_LABELS[subscription.billing_cycle] ?? sentenceCase(subscription.billing_cycle) },
              { label: "Status", value: SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? sentenceCase(subscription.status) },
              { label: "Current period", value: periodCovered(subscription.current_period_start, subscription.current_period_end) },
            ]}
          />

          {access !== "full" && <Callout tone="warning" title={ACCESS_NOTE[access]} />}

          {subscription.pending_plan_id && (
            <Callout
              tone="warning"
              title={`Queued change: ${planName(subscription.plan_name, subscription.plan_version)} → ${planName(subscription.pending_plan_name, subscription.pending_plan_version)}, takes effect ${periodEnd ?? "at period end"}`}
            />
          )}

          {subscription.cancel_at_period_end && (
            <Callout tone="error" title={`Cancelling — ends ${periodEnd ?? "at period end"}`}>
              {subscription.cancel_reason ?? undefined}
            </Callout>
          )}
        </>
      ) : (
        <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
          Nothing sold to this tenant yet — no plan, no allowances, no seat limit.
        </p>
      )}

      {canManage ? (
        <div className="flex flex-wrap gap-3">
          {!subscription && (
            <Button asChild>
              <Link href={tabHref} scroll={false} className="no-underline">
                Assign a plan
              </Link>
            </Button>
          )}
          {actions?.canChangePlan && (
            <Button asChild>
              <Link href={tabHref} scroll={false} className="no-underline">
                Change plan
              </Link>
            </Button>
          )}
          {actions?.canCancel && !subscription?.cancel_at_period_end && (
            <Button asChild variant="outline" className={DANGER_LINK}>
              <Link href={tabHref} scroll={false}>
                Cancel subscription
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
          Read-only for your role.
        </p>
      )}
    </section>
  );
}

export async function TenantOverviewTab({ tenantId, admin }: TenantTabProps) {
  // The frame read is memoised for this request, so this costs nothing the page has not already paid;
  // the seat count inside the usage read is memoised the same way and shared with the frame's chip.
  const [frame, usage] = await Promise.all([fetchTenantRecordFrame(tenantId), fetchTenantUsage(tenantId)]);
  if (!frame) notFound();

  const { tenant, subscription, owner } = frame;
  const suspended = isTenantSuspended(tenant.status);
  const suspension = suspended ? await fetchLatestSuspension(tenantId) : null;

  const account = [
    { label: "Tenant id", value: <span className="font-mono text-[13px] font-normal break-all">{tenant.id}</span> },
    {
      label: "Owner",
      value: owner ? (
        <>
          {owner.name}
          <span className="block text-[12px] leading-[1.5] font-normal tracking-[-0.01em] text-[var(--muted)]">{owner.email}</span>
        </>
      ) : (
        "No owner yet"
      ),
    },
    { label: "Created", value: recordDate(tenant.createdAt) },
    {
      label: subscription?.cancel_at_period_end || subscription?.status === "cancelling" ? "Ends" : "Renews",
      value: subscription?.current_period_end ? recordDate(subscription.current_period_end) : "—",
    },
    { label: "Onboarding", value: sentenceCase(tenant.onboardingState) },
    { label: "Collection", value: tenant.billingMode === "manual" ? "Manual" : "Automatic" },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {suspended && (
        <Callout tone="error" title={`Suspended${suspension ? ` since ${recordDate(suspension.ts)}` : ""}`}>
          {suspension?.reason ? (
            <p className="m-0">
              &ldquo;{suspension.reason}&rdquo;{suspension.actorName ? ` — ${suspension.actorName}` : ""}
            </p>
          ) : null}
        </Callout>
      )}

      <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-stretch">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SubscriptionCard tenantId={tenantId} subscription={subscription} canManage={canManageSubscriptions(admin.role)} />

          <SettingsCard title="Account" pad={20}>
            <KeyValues items={account} />
          </SettingsCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:w-[360px] lg:shrink-0">
          <TenantUsagePanel usage={usage} />
        </div>
      </div>
    </div>
  );
}
