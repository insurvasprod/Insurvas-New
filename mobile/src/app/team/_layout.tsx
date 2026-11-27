import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";

/**
 * Team's own stack (release 3: I2 a producer, I8 a partner from the agency's side). The Team tab itself (I1) is a
 * component on the owner's and the manager's tab bars; `index` is the same Team pushed, for an owner whose bar
 * has no Team tab. Every screen draws the kit's Header, so the stack never shows
 * one. The root layout registers this folder once, inside the signed-in door, as "team".
 */
export default function TeamLayout() {
  // Board index.html 168: reduced motion turns pushes into fades.
  const reduced = useReducedMotion();
  return (
    <Stack screenOptions={{ headerShown: false, animation: reduced ? "fade" : "default" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[userId]" />
      <Stack.Screen name="partner/[id]" />
    </Stack>
  );
}
