import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { CallbackCalendar } from "@/components/app/callback-calendar";

export default async function CallbacksPage() {
  const guard = await guardPage("callback_calendar");
  // Through the gate notice, so an outage says "temporarily unavailable" instead of offering an upgrade.
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Callback Calendar" description="Keep customer-local callback times, reminders, and follow-up history in one place." />;
  return <CallbackCalendar readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} />;
}
