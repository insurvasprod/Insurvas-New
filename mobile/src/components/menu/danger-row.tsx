import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * A .row whose words are the danger colour (board J3's Sign out: `.lic.b` icon, red title, no
 * chevron). The kit's Row takes its title as plain ink text, so this draws the same measurements.
 */
export function DangerRow({ icon, title, onPress, first, testID }: { icon: IconName; title: string; onPress: () => void; first?: boolean; testID?: string }) {
  const p = usePalette();
  const box = IOS ? 30 : 40;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} android_ripple={{ color: p.surf2 }} style={({ pressed }) => (pressed && IOS ? { backgroundColor: p.surf2 } : null)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: IOS ? 11 : 10, minHeight: IOS ? 52 : 56 }}>
        {!first ? <View style={IOS ? { position: "absolute", top: 0, left: 58, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: p.line2 } : { position: "absolute", top: 0, left: 16, right: 16, height: 1, backgroundColor: p.line }} /> : null}
        <View style={{ width: box, height: box, borderRadius: IOS ? 8 : 12, backgroundColor: p.badS, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={IOS ? 18 : 20} color={p.bad} /></View>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.m, fontSize: 16, color: p.bad }}>{title}</Text>
      </View>
    </Pressable>
  );
}
