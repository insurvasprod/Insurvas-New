import { Stack } from "expo-router";

import { PoliciesScreen } from "@/components/book/policies";

/** Board F1 · Policies, opened from Menu (the bookkeeper's Book tab draws the same screen with `asTab`). */
export default function BookRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PoliciesScreen />
    </>
  );
}
