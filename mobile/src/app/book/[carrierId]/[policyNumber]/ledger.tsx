import { Stack, useLocalSearchParams } from "expo-router";

import { LedgerScreen } from "@/components/book/ledger";

/** Board F2b · Commission ledger for one policy. */
export default function LedgerRoute() {
  const { carrierId, policyNumber } = useLocalSearchParams<{ carrierId: string; policyNumber: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LedgerScreen carrierId={String(carrierId)} policyNumber={String(policyNumber)} />
    </>
  );
}
