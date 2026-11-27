import { Stack } from "expo-router";

import { SetupScreen } from "@/components/home3/setup-screen";

/** Board B9 · Get set up, opened from the owner's Home or Menu (web /app/setup). */
export default function SetupRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SetupScreen />
    </>
  );
}
