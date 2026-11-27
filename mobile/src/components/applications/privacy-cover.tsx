import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { F } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * Board E2c / rules "app-switcher cover": while the app is not in front, a screen with bank numbers on
 * it is covered, so the app switcher's snapshot shows a lock rather than the numbers. On iOS the
 * snapshot is taken after "inactive", so the cover is in it. Android takes its recents thumbnail
 * natively and blocks screenshots only with FLAG_SECURE, which needs a native module the app does not
 * have yet (expo-screen-capture, a new development build) — the cover is the most JS can do there.
 * `onAway` lets the screen drop anything it revealed.
 */
export function usePrivacyCover(onAway?: () => void): boolean {
  // The screen opens in front; only a change of state covers it.
  const [away, setAway] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      const gone = s !== "active";
      setAway(gone);
      if (gone) onAway?.();
    });
    return () => sub.remove();
  }, [onAway]);
  return away;
}

export function PrivacyCover({ visible }: { visible: boolean }) {
  const p = usePalette();
  if (!visible) return null;
  return (
    <View testID="app-privacy-cover" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.canvas, alignItems: "center", justifyContent: "center", gap: 10, zIndex: 50 }]}>
      <Icon name="lock" size={32} color={p.muted} />
      <Text style={{ fontFamily: F.m, fontSize: 15, color: p.muted }}>Bank details hidden</Text>
    </View>
  );
}
