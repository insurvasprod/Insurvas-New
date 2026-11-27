import { Stack, useLocalSearchParams } from "expo-router";

import { StatementScreen } from "@/components/money/statement";

/** Board G2 · Pay statement: one payout run, as the web's /app/producer-statements/<run>. */
export default function StatementRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatementScreen runId={String(id)} />
    </>
  );
}
