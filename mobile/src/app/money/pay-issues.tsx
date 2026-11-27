import { Stack } from "expo-router";

import { PayIssuesScreen } from "@/components/money/pay-issues";

/** Board G8 · Pay issues (owner, bookkeeper), as the web's /app/discrepancies. The bookkeeper's tab can draw `PayIssuesScreen asTab`. */
export default function PayIssuesRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PayIssuesScreen />
    </>
  );
}
