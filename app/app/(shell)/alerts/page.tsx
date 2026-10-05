import { redirect } from "next/navigation";

import { AlertCentre } from "@/components/app/alert-centre";
import { SlaDigestCard, SlaJobStrip } from "@/components/app/sla-job-digest";
import { ErrorState } from "@/components/ui/page-states";
import { PageHeader } from "@/components/ui/page-header";
import { listAlertCentre } from "@/lib/agentAlerts/service";
import { getSlaDailyDigests, getSlaJobStatus } from "@/lib/queueSla/digest";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";

/**
 * The alert centre — where the alerts panel's "Open the alert centre" leads.
 *
 * Every workspace alert of the last week: the open ones with the action that resolves them, and
 * the resolved ones with what resolved them. No "mark as read" anywhere on the page, for the same
 * reason the panel has none: an alert clears when it is fixed.
 *
 * Under the header, the unclaimed-SLA job as the page's one stat strip (LA-1.23-7: what it did, and
 * an alert line when it fails or stops); below the lists, its daily digest of escalated and expired
 * transfers by partner (LA-1.23-6). Each is read on its own, so one failing read never takes the
 * alert lists down with it.
 */
export default async function AlertCentrePage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const now = new Date();
  const [centre, job, digest] = await Promise.all([
    listAlertCentre(context.tenantId, context.userId).catch(() => null),
    getSlaJobStatus(context.tenantId, now).catch((error) => { console.error("SLA job status read failed", error); return null; }),
    getSlaDailyDigests(context.tenantId, 7, now).catch((error) => { console.error("SLA digest read failed", error); return null; }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Alert centre" description="Alerts clear when the work is claimed, not when they are read." />
      {job
        ? <SlaJobStrip status={job} nowMs={now.getTime()} />
        : <ErrorState detail="The unclaimed SLA job's status could not be read. Nothing has changed; reload the page to try again." />}
      {centre
        ? <AlertCentre open={centre.open} resolved={centre.resolved} canClaim={context.role === "owner" || context.role === "producer" || context.role === "assistant"} />
        : <ErrorState detail="The alert centre could not read the queue, so it cannot say which alerts are open. Nothing has changed; reload the page to try again." />}
      {/* Before 20260925709910 the strip's one line already says the update is pending; one is enough. */}
      {digest
        ? (digest.ready || job?.ready !== false) && <SlaDigestCard ready={digest.ready} days={digest.days} />
        : <ErrorState detail="The daily digest could not be read. Nothing has changed; reload the page to try again." />}
    </div>
  );
}
