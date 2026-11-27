import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * `k.group("", rows)` straight under a section head (.sh): the iOS inset box (.grp, 16px in, 14px
 * corners) or Android's flat list, with no title gap of its own — the kit's Group adds one.
 */
export function GroupBox({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <View style={IOS ? { marginHorizontal: 16, backgroundColor: p.surf, borderRadius: 14, borderWidth: 1, borderColor: p.line, overflow: "hidden" } : null}>{children}</View>;
}

/** .av.sm — the person's gold initials, 26px, 11px bold (board B1 header). */
export function SmallAvatar({ initials, onPress, label }: { initials: string; onPress?: () => void; label: string }) {
  const p = usePalette();
  const dot = (
    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: p.gold, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: F.b, fontSize: 11, color: p.onGold }}>{initials}</Text>
    </View>
  );
  const box = { width: IOS ? 36 : 48, height: IOS ? 36 : 48, alignItems: "center", justifyContent: "center" } as const;
  if (!onPress) return <View style={box}>{dot}</View>;
  return <Pressable testID="home-avatar" accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={box}>{dot}</Pressable>;
}

/** .ring (kit.js `ring`): a 7px track and a round-capped arc from the top, the label in 20px Inter Tight bold. */
export function Ring({ pct, size = 76, label, gold, bad }: { pct: number; size?: number; label: string; gold?: boolean; /** A date already passed: the arc turns the warning red, never a calm green. */ bad?: boolean }) {
  const p = usePalette();
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.track} strokeWidth={7} />
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bad ? p.bad : gold ? p.gold : p.green} strokeWidth={7} strokeLinecap="round"
          strokeDasharray={`${c}`} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <Text style={{ fontFamily: F.db, fontSize: 20, color: p.ink, fontVariant: ["tabular-nums"] }}>{label}</Text>
    </View>
  );
}
