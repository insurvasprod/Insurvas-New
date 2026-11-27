import { Stack } from "expo-router";

import { NeedsYouScreen } from "@/components/book/needs-you";

/** Board F6 · Carrier sync · needs you, opened from Menu. */
export default function NeedsYouRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <NeedsYouScreen />
    </>
  );
}
