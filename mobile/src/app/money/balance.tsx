import { Stack } from "expo-router";

import { BalanceScreen } from "@/components/money/balance";

/** Board G7 · My balance (producers), as the web's /app/my-balance (which is My pay's ledger on an agency). */
export default function BalanceRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <BalanceScreen />
    </>
  );
}
