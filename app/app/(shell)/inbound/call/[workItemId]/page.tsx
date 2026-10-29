import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { guardCase } from "@/lib/agency/guards";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { InboundCall, type Underwriting } from "@/components/app/inbound/inbound-call";
import { phaseOf } from "@/lib/inbound/callPhase";
import { ApplicationError } from "@/lib/applications/db";
import { FIXTURE_CASE } from "@/lib/applications/fixtures";
import { isUuid } from "@/lib/applications/http";
import { getCaseView } from "@/lib/applications/service";
import { canWrite } from "@/lib/entitlements/types";
import { getViewerTimezone } from "@/lib/users/viewerTimezone";

/**
 * The call (owner 2026-10-28): steps 2–5 of Inbound on one page — Transfer check, Verification,
 * Underwriting and Finish the call (`?phase=`; the older `?step=finish` still lands on Finish). Was
 * /app/inbound/<id>/verification and /app/inbound/<id>/disposition, which forward here. The call is
 * open to owners, agents and screeners; underwriting and recording how the call ended stay with owners
 * and agents (a screener passes the call to a licensed agent instead).
 */
export default async function InboundCallPage({ params, searchParams }: { params: Promise<{ workItemId: string }>; searchParams: Promise<{ step?: string; phase?: string; case?: string; preview?: string }> }) {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound" description="Check each caller's details and record how the call ended." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Inbound" detail="Inbound callers are taken by owners, agents and screeners. Ask your owner if you should be one." />;
  const [{ workItemId }, query] = await Promise.all([params, searchParams]);
  const phase = phaseOf(query);
  const readOnly = guard.entitlement.status === "suspended" || guard.entitlement.status === "paused";
  const licensed = actAsPage(guard, ["owner", "producer"]);

  let underwriting: Underwriting | undefined;
  if (phase === "underwriting") {
    if (!licensed) underwriting = { kind: "refused", message: "A licensed agent takes the application. Pass the call to one from Verification." };
    else if (query.preview === "sample" && process.env.NODE_ENV !== "production") underwriting = { kind: "case", view: FIXTURE_CASE, sample: true, seatReadOnly: false };
    else if (query.case && isUuid(query.case)) {
      const appGuard = await guardPage("applications");
      if (!appGuard.entitled) underwriting = { kind: "refused", message: "Applications are not on your agency's plan." };
      else if (await guardCase(appGuard.context, query.case)) underwriting = { kind: "refused", message: "That application could not be found." };
      else {
        try {
          const [view, zone] = await Promise.all([getCaseView(appGuard.context.tenantId, query.case), getViewerTimezone(appGuard.context.tenantId, appGuard.context.userId).catch(() => null)]);
          underwriting = { kind: "case", view, sample: false, timeZone: zone ?? undefined, seatReadOnly: !canWrite(appGuard.entitlement) };
        } catch (error) {
          if (!(error instanceof ApplicationError)) throw error;
          underwriting = { kind: "refused", message: error.code === "SCHEMA_PENDING" ? "Applications are still being set up for your agency." : "That application could not be found." };
        }
      }
    } else underwriting = { kind: "open" };
  }

  return <InboundCall workItemId={workItemId} phase={phase} readOnly={readOnly} canHandoff={guard.role === "assistant"} canFinish={licensed} underwriting={underwriting} />;
}
