import { forwardRef, type ComponentRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TabTriggerSlotProps } from "expo-router/ui";

import { Icon, type IconName } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * The partner app's tab bar (board .tabs-and / .tabs for role "partner": Home · Send a lead · Pipeline ·
 * Messages · Account). The agency tabs are the platform's NativeTabs with icons rendered to images; the
 * partner's five are drawn here from the board's own icons, so no image assets are needed. Android: the
 * Material bar, the selected icon in its green pill and every label showing. iOS: the selected tab in the
 * brand green. Badges are gold (new counts).
 */
export function TabBarFrame({ children }: { children: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: "row", backgroundColor: IOS ? p.bar : p.surf, borderTopWidth: IOS ? StyleSheet.hairlineWidth : 0, borderTopColor: p.line, paddingTop: IOS ? 6 : 12, paddingBottom: (IOS ? 2 : 16) + insets.bottom }}>
      {children}
    </View>
  );
}

type TabButtonProps = TabTriggerSlotProps & { icon: IconName; label: string; badge?: number };

export const TabButton = forwardRef<ComponentRef<typeof Pressable>, TabButtonProps>(function TabButton({ icon, label, badge, isFocused, ...props }, ref) {
  const p = usePalette();
  const color = isFocused ? (IOS ? p.greenInk : p.ink) : p.muted;
  return (
    <Pressable ref={ref} {...props} accessibilityRole="tab" accessibilityLabel={badge ? `${label}, ${badge} new` : label} accessibilityState={{ selected: Boolean(isFocused) }}
      style={{ flex: 1, alignItems: "center", gap: IOS ? 2 : 4 }}>
      {/* .tabs-and .pill: 60 × 32; the badge sits 8px right of the centre, 2px above (.tabs-and .badge). */}
      <View style={{ width: 60, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: isFocused && !IOS ? p.greenSoft : "transparent" }}>
        <Icon name={icon} size={24} color={isFocused && !IOS ? p.greenInk : color} />
        {badge ? (
          <View style={{ position: "absolute", top: -2, left: 38, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: p.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
            <Text style={{ fontFamily: F.b, fontSize: 11, color: p.onGold }}>{badge > 99 ? "99+" : String(badge)}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={{ fontFamily: isFocused ? F.s : F.m, fontSize: IOS ? 10.5 : 12, color }}>{label}</Text>
    </Pressable>
  );
});
