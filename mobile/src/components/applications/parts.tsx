import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/icon";
import { F } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * Pieces the application screens draw that the shared kit does not, measured from
 * docs/design/mobile-v1/kit.css: the step line under the header (.between .mini + .steps), the big
 * answer cards (E2), the bottom bar (bottomBar/bar), the key-value card (.kv) and the muted line
 * with an icon (.mini .row2).
 */

/** .steps — one 4px bar a step: green done, green at 55% for the one on screen, the track for the rest. */
export function StepBars({ total, current, testID }: { total: number; current: number; testID?: string }) {
  const p = usePalette();
  return (
    <View testID={testID} accessibilityLabel={`Step ${current + 1} of ${total}`} style={{ flexDirection: "row", gap: 4 }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= current ? p.green : p.track, opacity: i === current ? 0.55 : 1 }} />
      ))}
    </View>
  );
}

/**
 * The line under the header on every step (E2 · E3 · E4): what is on screen on the left (a tap opens
 * all the steps when `onOpen` is given), where it sits on the right, then the bars.
 */
export function StepLine({ left, right, total, current, onOpen }: { left: string; right: string; total: number; current: number; onOpen?: () => void }) {
  const p = usePalette();
  const label = <Text style={{ fontFamily: F.s, fontSize: 12.5, color: p.ink }}>{left}</Text>;
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        {onOpen ? (
          <Pressable testID="app-step-name" accessibilityRole="button" accessibilityLabel={`${left}. Show all steps`} onPress={onOpen} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {label}
            <Icon name="chevD" size={14} color={p.ink} />
          </Pressable>
        ) : label}
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{right}</Text>
      </View>
      <StepBars total={total} current={current} />
    </View>
  );
}

/** The board's bottom bar (bottomBar / bar): the screen's next move over the safe area. */
export function BottomBar({ children }: { children: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + insets.bottom, gap: 10, backgroundColor: p.bar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }}>
      {children}
    </View>
  );
}

/** Two buttons side by side (.btnrow). */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>;
}

/** E2's answer: a card 18px in, a 24px radio (or tick box for several answers), 18px semibold words. */
export function AnswerCard({ label, selected, onPress, multi, tone, testID }: { label: string; selected: boolean; onPress: () => void; multi?: boolean; tone?: "bad"; testID?: string }) {
  const p = usePalette();
  const accent = tone === "bad" && selected ? p.bad : p.green;
  return (
    <Pressable testID={testID} accessibilityRole={multi ? "checkbox" : "radio"} accessibilityState={multi ? { checked: selected } : { selected }} accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: selected ? accent : p.line, backgroundColor: selected ? (tone === "bad" ? p.badS : p.greenSoft) : pressed ? p.surf2 : p.surf })}>
      <View style={{ width: 24, height: 24, borderRadius: multi ? 6 : 12, borderWidth: 2, borderColor: selected ? accent : p.line2, alignItems: "center", justifyContent: "center", backgroundColor: multi && selected ? accent : "transparent" }}>
        {selected ? (multi ? <Icon name="check" size={16} color={p.onGreen} /> : <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: accent }} />) : null}
      </View>
      <Text style={{ flex: 1, fontFamily: F.s, fontSize: 18, lineHeight: 23, color: p.ink }}>{label}</Text>
    </Pressable>
  );
}

/** .mini with a 14px icon in front (.row2): "✓ Saved · a dropped call resumes here". */
export function MiniLine({ icon, children, color, testID }: { icon?: IconName; children: ReactNode; color?: string; testID?: string }) {
  const p = usePalette();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {icon ? <Icon name={icon} size={14} color={color ?? p.muted} /> : null}
      <Text style={{ flexShrink: 1, fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: color ?? p.muted }}>{children}</Text>
    </View>
  );
}

/** .card.p with a .kv list: label muted on the left, value ink on the right, 15px, 8px between rows. */
export function KVCard({ pairs, testID }: { pairs: [string, string][]; testID?: string }) {
  const p = usePalette();
  return (
    <View testID={testID} style={{ backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 8 }}>
      {pairs.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 14 }}>
          <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.muted }}>{k}</Text>
          <Text numberOfLines={1} style={{ flexShrink: 1, textAlign: "right", fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink, fontVariant: ["tabular-nums"] }}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/** The big question / heading (.disp, Inter Tight): 24px, 600 for a question read aloud, 700 for a step heading. */
export function Question({ children, bold }: { children: ReactNode; bold?: boolean }) {
  const p = usePalette();
  return <Text accessibilityRole="header" style={{ fontFamily: bold ? F.db : F.ds, fontSize: 24, lineHeight: 31, letterSpacing: -0.48, color: p.ink }}>{children}</Text>;
}

/** The server's refusal, in its own words, under what it refused. */
export function ErrorLine({ text, testID }: { text: string | null; testID?: string }) {
  const p = usePalette();
  if (!text) return null;
  return <Text testID={testID} accessibilityLiveRegion="polite" style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.bad }}>{text}</Text>;
}
