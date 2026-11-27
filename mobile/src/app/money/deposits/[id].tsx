import { Stack, useLocalSearchParams } from "expo-router";

import { DepositScreen } from "@/components/money/deposit";

/** Board G3d · Bank deposit: one carrier payment, as the web's /app/bank/payments/<statement id>. */
export default function DepositRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DepositScreen id={String(id)} />
    </>
  );
}
