import { redirect } from "next/navigation";

import { AlertCentre } from "@/components/app/alert-centre";
import { SlaDigestCard, SlaJobStrip } from "@/components/app/sla-job-digest";
import { ErrorState } from "@/components/ui/page-states";
import { PageHeader } from "@/components/ui/page-header";
import { listAlertCentre } from "@/lib/agentAlerts/service";
import { getSlaDailyDigests, getSlaJobStatus } from "@/lib/queueSla/digest";
import { scopeFor } from "@/lib/agency/visibility";
import { contextRoles, resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";

/**
 * The alert centre — where the alerts panel's "Open the alert centre" leads.
 *
 * Every workspace alert of the last week: the open ones with the action that resolves them, and
 * the resolved ones with what resolved them. No "mark as read" anywhere on the page, for the same
 * reason the panel has none: an alert clears when it is fixed.
 *
 * Under the header, the unclaimed-SLA job as the page's one stat strip (LA-1.23-7: what it did, and
 * an alert line when it fails or stops); then the open alerts, the resolved ones and the job's daily
 * digest of escalated and expired transfers by partner (LA-1.23-6) as three tabs (2026-10-06
 * redesign). Each is read on its own, so one failing read never takes the alert lists down with it.
 */
export default async function AlertCentrePage() {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const now = new Date();
  // AG-0.5: inside an agency a narrow session sees only alerts about its visible producers' leads, and not the
  // daily digest, which counts every partner's escalations across the agency.
  const scope = await scopeFor(context);
  const [centre, job, digest] = await Promise.all([
    listAlertCentre(context.tenantId, context.userId, scope).catch(() => null),
    getSlaJobStatus(context.tenantId, now).catch((error) => { console.error("SLA job status read failed", error); return null; }),
    scope !== null ? Promise.resolve(undefined) : getSlaDailyDigests(context.tenantId, 7, now).catch((error) => { console.error("SLA digest read failed", error); return null; }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Alert centre" description="Alerts clear when the work is claimed, not read." />
      {job
        ? <SlaJobStrip status={job} nowMs={now.getTime()} />
        : <ErrorState title="SLA job status did not load" detail="Reload the page to try again. Nothing has changed." />}
      <AlertCentre
        lists={centre ? { open: centre.open, resolved: centre.resolved } : null}
        canClaim={holdsAnyRole(contextRoles(context), ["owner", "producer", "assistant"])}
        // Before 20260925709910 the strip's one line already says the update is pending; one is enough,
        // so the digest tab is left out until then.
        digest={digest === undefined ? undefined : digest
          ? (digest.ready || job?.ready !== false) ? <SlaDigestCard ready={digest.ready} days={digest.days} /> : undefined
          : <ErrorState title="The daily digest did not load" detail="Reload the page to try again. Nothing has changed." />}
      />
    </div>
  );
}
