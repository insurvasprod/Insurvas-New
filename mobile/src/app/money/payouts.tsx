import { Stack } from "expo-router";

import { MoneyTab } from "@/components/money/money-tab";

/** Board G3b · Partner payouts: the review sheet over Money, as the board draws it. */
export default function PartnerPayoutsRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MoneyTab asTab={false} initialSheet="partners" />
    </>
  );
}
