import { Stack, useLocalSearchParams } from "expo-router";

import { MoneyTab } from "@/components/money/money-tab";

/** Board G3 · Money as a stack screen (from Menu or a link); the owner's and bookkeeper's tab draws the same component. `?sheet=team|partners` opens G4 / G3b over it. */
export default function MoneyRoute() {
  const { sheet } = useLocalSearchParams<{ sheet?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MoneyTab asTab={false} initialSheet={sheet === "team" || sheet === "partners" ? sheet : null} />
    </>
  );
}
