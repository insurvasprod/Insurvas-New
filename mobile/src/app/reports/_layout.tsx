import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";

/**
 * Reports' own stack (release 3: I3 the cards, I4 Sales performance, I4b Team activity, I4c Retention scorecard,
 * I4d Callbacks kept, I4e Partner quality, and the lists behind a funnel bar and a decline reason). The root
 * layout registers this folder once as "reports".
 */
export default function ReportsLayout() {
  // Board index.html 168: reduced motion turns pushes into fades.
  const reduced = useReducedMotion();
  return (
    <Stack screenOptions={{ headerShown: false, animation: reduced ? "fade" : "default" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="sales" />
      <Stack.Screen name="activity" />
      <Stack.Screen name="retention" />
      <Stack.Screen name="callbacks" />
      <Stack.Screen name="partners" />
      <Stack.Screen name="funnel" />
      <Stack.Screen name="declines" />
    </Stack>
  );
}
