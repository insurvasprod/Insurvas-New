import { Stack, useLocalSearchParams } from "expo-router";

import { BillScreen } from "@/components/money/bill";

/** Board G3c · Vendor bill, as the web's /app/vendor-bills/<id>. */
export default function BillRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <BillScreen id={String(id)} />
    </>
  );
}
