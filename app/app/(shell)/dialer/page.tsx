import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { DialerWorkspace } from "@/components/app/dialer-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DialerPage({ searchParams }: { searchParams: Promise<{ lead?: string | string[] }> }) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Dialer" description="Every number is checked against the enabled DNC vendors before dialing." />;
  // LA-2.12 audit: a setter belongs here. Derived from the permission rather than re-listed.
  if (!hasTenantPermission(guard.role, "dialer.use")) {
    return <RoleGateNotice featureLabel="Dialer" detail="Only owners, producers and setters can place calls." />;
  }
  const readOnly = guard.entitlement.access === "read_only";
  // "Call now" from Setters, the Calendar and Callbacks links here as ?lead=<id>. The workspace
  // opens that lead through the pick (serve_lead_by_id), so every serving rule still applies.
  const { lead } = await searchParams;
  const requestedLead = typeof lead === "string" && UUID.test(lead) ? lead : null;
  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {/* The ad-hoc number check ("Check a number" in the Dialer header) opens a dialog now. Owners
          and producers only: /api/app/dial/preflight admits those two, and a setter dials what the
          queue serves. */}
      <DialerWorkspace readOnly={readOnly} role={guard.role} canCheckNumber={hasTenantPermission(guard.role, "sales.use")} requestedLeadId={requestedLead} />
    </div>
  );
}
