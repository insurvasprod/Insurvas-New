import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";

/**
 * Compliance's own stack (release 3: I5 Check a number, I5b Consent proof, I6 Complaints, I6b a complaint, I7 Licences
 * and appointments). The root layout registers this folder once as "compliance".
 */
export default function ComplianceLayout() {
  // Board index.html 168: reduced motion turns pushes into fades.
  const reduced = useReducedMotion();
  return (
    <Stack screenOptions={{ headerShown: false, animation: reduced ? "fade" : "default" }}>
      <Stack.Screen name="check-number" />
      <Stack.Screen name="consent" />
      <Stack.Screen name="complaints/index" />
      <Stack.Screen name="complaints/[id]" />
      <Stack.Screen name="licences" />
    </Stack>
  );
}
