import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";

/**
 * Retention's own stack (release 2: F3 Cases, F3b Waiting on the carrier, F3c Win-back, F4 a case). Every screen
 * draws the kit's Header, so the stack never shows one. The root layout registers this folder once, inside the
 * signed-in door, as "retention".
 */
export default function RetentionLayout() {
  // Board index.html 168: reduced motion turns pushes into fades.
  const reduced = useReducedMotion();
  return (
    <Stack screenOptions={{ headerShown: false, animation: reduced ? "fade" : "default" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="waiting" />
      <Stack.Screen name="win-back" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
