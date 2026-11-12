import { scopeFor } from "@/lib/agency/visibility";
import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { ExceptionQueues, type ExceptionsTab } from "@/components/app/exception-queues";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { Callout } from "@/components/app/settings/primitives";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { ageDays } from "@/lib/ingestion/exceptionQueues";
import { loadQueues, QUEUES_PENDING_MESSAGE } from "@/lib/ingestion/exceptionQueuesStore";

/**
 * Book of Business › Exceptions (LA-4.9, Notion sprint): the three exception queues. Everyone sees
 * the items they own; the owner and bookkeepers see all. Opening it writes nothing.
 */
export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Exceptions" description="Policies with no sale, sales with no policy, and clients who may be one person." />;
  // Premiums are inside: owner, producer and bookkeeper, as the API.
  if (!actAsPagePermission(guard, "policies.view")) return <RoleGateNotice featureLabel="Exceptions" detail="Exceptions are cleared by producers, bookkeepers and the account owner." />;
  // AG-0.5: inside an agency these are operations — every item's choices reach across producers' books — so a
  // narrow session is refused, as the API refuses it. A solo tenant and the all-seeing roles are unchanged.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Exceptions" detail="In an agency, the owner, admins and the bookkeeper clear exceptions." />;
  const seesAll = guard.role === "owner" || guard.role === "bookkeeper";
  // Ages are counted in the agency's day, not UTC's.
  const [view, today] = await Promise.all([loadQueues({ tenantId: guard.context.tenantId, userId: guard.context.userId, seesAll }), agencyToday(guard.context.tenantId)]);

  const isOwner = guard.role === "owner";
  const { tab: asked } = await searchParams;
  const tab: ExceptionsTab = asked === "closed" ? "closed" : asked === "owners" && isOwner ? "owners" : "open";
  // The views on the title line (UI-CONSISTENCY §8a), each its own address.
  const tabs = view.available ? (
    <ViewTabs<ExceptionsTab>
      label="Exception views"
      value={tab}
      controls="exceptions-panel"
      tabs={[
        { key: "open", label: "Open", count: view.open.length, href: "/app/exceptions" },
        { key: "closed", label: "Closed, 30 days", count: view.closed.length, href: "/app/exceptions?tab=closed" },
        ...(isOwner ? [{ key: "owners" as const, label: "Who owns each queue", href: "/app/exceptions?tab=owners" }] : []),
      ]}
    />
  ) : undefined;

  return (
    <DataInPage step="needs-you" title="Exceptions" tabs={tabs}>
      {!view.available ? (
        // §3: a blocked state raises a bell alert, never a box on the page.
        <Callout tone="warning" title={QUEUES_PENDING_MESSAGE} />
      ) : (
        <>
          <StatStrip label="Exception totals">
            <StatTile label="Sales no carrier has" value={view.open.filter((i) => i.queueType === "no_policy").length.toLocaleString("en-US")} footnote={view.open.some((i) => i.queueType === "no_policy") ? <StatusChip tone="warning">May not be submitted</StatusChip> : "may never have been submitted"} />
            <StatTile label="Policies with no sale" value={view.open.filter((i) => i.queueType === "no_deal_flow").length.toLocaleString("en-US")} footnote="client is provisional until confirmed" />
            <StatTile label="Possibly one client" value={view.open.filter((i) => i.queueType === "multi_policy").length.toLocaleString("en-US")} footnote="only when not certain" />
            <StatTile label="Oldest open" value={view.open.length ? `${Math.max(...view.open.map((i) => ageDays(i.ageFrom, today)))} d` : "—"} footnote={view.open.some((i) => i.escalated) ? <StatusChip tone="warning">{view.open.filter((i) => i.escalated).length} escalated</StatusChip> : "0 escalated"} />
          </StatStrip>
          <ExceptionQueues open={view.open} closed={view.closed} rules={view.rules} isOwner={isOwner} today={today} readOnly={guard.entitlement.access === "read_only"} carriers={view.carriers} tab={tab} />
        </>
      )}
    </DataInPage>
  );
}
