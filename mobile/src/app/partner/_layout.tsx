import { View } from "react-native";
import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";

import { PartnerSessionProvider, usePartnerSession } from "@/components/partner/session";
import { usePalette } from "@/theme/use-palette";

/**
 * The partner app (Release 3, board K1–K6). A partner signs in to the same app and lands here, on their
 * own plane: this folder holds its own session (components/partner/session.tsx) and its own doors, so
 * nothing here ever carries the agency session, and no agency screen ever carries a partner's.
 * The root layout registers this folder once, outside the agency's doors, as "partner".
 */
function PartnerNavigator() {
  const { status } = usePartnerSession();
  const p = usePalette();
  // Board index.html 168: reduced motion turns pushes into fades.
  const reduced = useReducedMotion();
  // Starting: blank under the root layout's launch cover, which stays up until this session has started.
  if (status === "starting") return <View style={{ flex: 1, backgroundColor: p.canvas }} />;
  return (
    <Stack screenOptions={{ headerShown: false, animation: reduced ? "fade" : "default", contentStyle: { backgroundColor: p.canvas } }}>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="(tabs)" />
        {/* K3b · K6 · a conversation from K5 (each draws the kit's own Header). */}
        <Stack.Screen name="lead/[id]" />
        <Stack.Screen name="thread/[id]" />
        <Stack.Screen name="team" />
        <Stack.Screen name="notifications" />
      </Stack.Protected>
      <Stack.Protected guard={status === "locked"}>
        <Stack.Screen name="locked" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="sign-in" />
        {/* Development only (redirects in a release build): tokens minted for a test partner. */}
        <Stack.Screen name="dev-sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function PartnerLayout() {
  return (
    <PartnerSessionProvider>
      <PartnerNavigator />
    </PartnerSessionProvider>
  );
}
