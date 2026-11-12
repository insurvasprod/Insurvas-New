import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TcpaExemptionForm } from "@/components/app/tcpa-dnc-exemptions";
import { RouteSheet } from "@/components/app/route-sheet";

/** Record a DNC exemption, opened from inside the app: a panel from the right (route-sheet.tsx); the same gate as its page. */
export default async function NewExemptionSheet() {
  const title = "Record an exemption";
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <RouteSheet title={title}><FeatureGateNotice guard={guard} featureLabel="TCPA / DNC" description="Numbers you must never call, and a check before dialling." /></RouteSheet>;
  if (!actAsPage(guard, ["owner"])) return <RouteSheet title={title}><RoleGateNotice featureLabel="DNC exemptions" detail="Only the agency owner records a DNC exemption." /></RouteSheet>;
  if ((await scopeFor(guard.context)) !== null) return <RouteSheet title={title}><RoleGateNotice reason="agency" featureLabel="DNC exemptions" detail="In an agency, the owner and admins keep the DNC exemptions." /></RouteSheet>;
  if (guard.entitlement.access === "read_only") return <RouteSheet title={title}><RoleGateNotice featureLabel="DNC exemptions" detail="This plan is read-only here: exemptions can be seen, not recorded." /></RouteSheet>;
  return (
    <RouteSheet title={title}>
      <TcpaExemptionForm />
    </RouteSheet>
  );
}
