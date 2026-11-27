import { Stack, useLocalSearchParams } from "expo-router";

import { PnlScreen } from "@/components/money/pnl";

/** Board G3e · Profit & loss, as the web's /app/pnl; `month` is the month Money's calendar chose. */
export default function PnlRoute() {
  const { month } = useLocalSearchParams<{ month?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PnlScreen month={typeof month === "string" ? month : null} />
    </>
  );
}
