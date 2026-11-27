import { AppTabs } from "@/components/app-tabs";
import { OngoingCallProvider } from "@/components/inbound/on-call-bar";
import { useQuickActionsMenu } from "@/components/native/quick-actions";
import { CountsProvider } from "@/lib/counts";

export default function TabsLayout() {
  // Board L3: the long-press menu routes from this signed-in sub-layout (expo-quick-actions asks for one).
  useQuickActionsMenu();
  return (
    <CountsProvider>
      {/* Board L2: one ongoing-call poller for every tab — it keeps the Android notification current, and Calls' card reads it. */}
      <OngoingCallProvider>
        <AppTabs />
      </OngoingCallProvider>
    </CountsProvider>
  );
}
