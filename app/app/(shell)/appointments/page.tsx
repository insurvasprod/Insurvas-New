import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CarrierAppointmentsPage } from "@/components/app/carrier-appointments-page";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";

export default async function AppointmentsPage() {
  const guard = await guardPage("appointment_vault");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Appointment vault"
        description="Manage carrier appointments and licences."
      />
    );
  }
  if (!actAsPage(guard, ["owner", "producer"])) {
    return (
      <RoleGateNotice
        featureLabel="Appointments"
        detail="Only owners and producers can view the appointment vault."
      />
    );
  }
  // Compliance › Licences & appointments (owner 2026-11-02: out of the Book group).
  return (
    <ComplianceFlowPage step="appointments">
    <CarrierAppointmentsPage
      framed
      canEdit={guard.role === "owner" && guard.entitlement.access === "full"}
      isOwner={guard.role === "owner"}
      readOnlyReason={guard.entitlement.access === "read_only" ? "Your account is read-only: appointments and licences can be read but not changed until the subscription is reactivated." : null}
    />
    </ComplianceFlowPage>
  );
}
