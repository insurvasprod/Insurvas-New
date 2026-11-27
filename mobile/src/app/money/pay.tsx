import { Stack } from "expo-router";

import { MyPayScreen } from "@/components/money/my-pay";

/** Board G1 · My pay, opened from Menu and from Home (producers). */
export default function MyPayRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MyPayScreen />
    </>
  );
}
