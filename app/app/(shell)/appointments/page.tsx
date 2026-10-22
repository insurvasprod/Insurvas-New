import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CarrierAppointmentsPage } from "@/components/app/carrier-appointments-page";

export default async function AppointmentsPage() {
  const guard = await guardPage("appointment_vault");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Appointment vault"
        description="Manage carrier appointments, licences, E&O insurance and continuing education."
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
  return (
    <CarrierAppointmentsPage
      canEdit={guard.role === "owner" && guard.entitlement.access === "full"}
      isOwner={guard.role === "owner"}
      readOnlyReason={guard.entitlement.access === "read_only" ? "Your account is read-only: appointments and licences can be read but not changed until the subscription is reactivated." : null}
    />
  );
}
