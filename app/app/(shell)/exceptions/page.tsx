import { guardPage } from "@/lib/entitlements/guardPage";
import { ExceptionQueues } from "@/components/app/exception-queues";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { ageDays } from "@/lib/ingestion/exceptionQueues";
import { loadQueues, QUEUES_PENDING_MESSAGE } from "@/lib/ingestion/exceptionQueuesStore";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Exceptions (LA-4.9, Notion sprint): the three exception queues. Everyone sees
 * the items they own; the owner and bookkeepers see all. Opening it writes nothing.
 */
export default async function ExceptionsPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Exceptions" description="Policies with no sale, sales with no policy, and clients who may be one person." />;
  // Premiums are inside: owner, producer and bookkeeper, as the API.
  if (!hasTenantPermission(guard.role, "policies.view")) return <RoleGateNotice featureLabel="Exceptions" detail="Exceptions are cleared by producers, bookkeepers and the account owner." />;
  const seesAll = guard.role === "owner" || guard.role === "bookkeeper";
  // Ages are counted in the agency's day, not UTC's.
  const [view, today] = await Promise.all([loadQueues({ tenantId: guard.context.tenantId, userId: guard.context.userId, seesAll }), agencyToday(guard.context.tenantId)]);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Exceptions" description={seesAll ? "What the carrier files and the sales don't agree on, and who is clearing it." : "What the carrier files and your sales don't agree on."} />
      {!view.available ? (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{QUEUES_PENDING_MESSAGE}</div>
      ) : (
        <>
          <StatStrip label="Exception totals">
            <StatTile label="Sales no carrier has" value={view.open.filter((i) => i.queueType === "no_policy").length.toLocaleString("en-US")} valueTone={view.open.some((i) => i.queueType === "no_policy") ? "warning" : undefined} footnote="may never have been submitted" />
            <StatTile label="Policies with no sale" value={view.open.filter((i) => i.queueType === "no_deal_flow").length.toLocaleString("en-US")} footnote="client is provisional until confirmed" />
            <StatTile label="Possibly one client" value={view.open.filter((i) => i.queueType === "multi_policy").length.toLocaleString("en-US")} footnote="only when not certain" />
            <StatTile label="Oldest open" value={view.open.length ? `${Math.max(...view.open.map((i) => ageDays(i.ageFrom, today)))} d` : "—"} valueTone={view.open.some((i) => i.escalated) ? "warning" : undefined} footnote={`${view.open.filter((i) => i.escalated).length} escalated`} />
          </StatStrip>
          <ExceptionQueues open={view.open} closed={view.closed} rules={view.rules} isOwner={guard.role === "owner"} today={today} readOnly={guard.entitlement.access === "read_only"} carriers={view.carriers} />
        </>
      )}
    </div>
  );
}
