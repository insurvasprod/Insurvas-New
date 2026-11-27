import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";

import { usePalette } from "@/theme/use-palette";

/**
 * The Menu tab's own stack: pages the board draws with the tab bar still showing (J4 Help and guides)
 * open inside it. Every screen draws the kit's Header, so the stack never shows one.
 */
export default function MenuLayout() {
  // Board index.html 168: reduced motion turns pushes into fades.
  const reduced = useReducedMotion();
  const p = usePalette();
  return <Stack screenOptions={{ headerShown: false, animation: reduced ? "fade" : "default", contentStyle: { backgroundColor: p.canvas } }} />;
}
