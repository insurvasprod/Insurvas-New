import { guardPage } from "@/lib/entitlements/guardPage";
import { UpgradePrompt } from "@/components/app/upgrade-prompt";
import { CallbackCalendar } from "@/components/app/callback-calendar";

export default async function CallbacksPage() {
  const guard = await guardPage("callback_calendar");
  if (!guard.entitled) return <UpgradePrompt featureLabel="Callback Calendar" planCode={guard.entitlement.plan_code} description="Keep customer-local callback times, reminders, and follow-up history in one place." />;
  return <CallbackCalendar readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} />;
}
