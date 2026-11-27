import type { ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";

import { Icon } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";
import { STEP_NAMES, type Tick } from "./model";

/**
 * Board pieces the inbound call screens draw that the shared kit does not, measured from
 * docs/design/mobile-v1/kit.css: the call's step head (screens-a.js `callSteps`: .mini line, "On the
 * call" in green, .steps), a check tick (screens-e.js `tick`), .kv, .card h4, .prog and the radio
 * cards of C6.
 */

// ─── callSteps: "Step 1 of 4 · Caller profile" · "On the call 03:18", then four bars ───────────
export function StepHead({ step, onCall }: { step: number; onCall: string | null }) {
  const p = usePalette();
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{`Step ${step + 1} of 4 · ${STEP_NAMES[step]}`}</Text>
        {onCall ? (
          <View testID="call-clock" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Icon name="phone" size={14} color={p.greenInk} />
            <Text style={{ fontFamily: F.s, fontSize: 12.5, color: p.greenInk, fontVariant: ["tabular-nums"] }}>{`On the call ${onCall}`}</Text>
          </View>
        ) : null}
      </View>
      <Steps n={4} cur={step} />
    </View>
  );
}

/** .steps — 4px bars, 4px apart: done green, current green at 55%, the rest the track. */
export function Steps({ n, cur }: { n: number; cur: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= cur ? p.green : p.track, opacity: i === cur ? 0.55 : 1 }} />
      ))}
    </View>
  );
}

// ─── tick (screens-e.js): green check, red ×, or a clock while it is not known ───────────────
export function TickRow({ tick }: { tick: Tick }) {
  const p = usePalette();
  const color = tick.ok === 1 ? p.ok : tick.ok === 0 ? p.bad : p.faint;
  return (
    <View testID={`tick-${tick.key}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Icon name={tick.ok === 1 ? "checkC" : tick.ok === 0 ? "xC" : "clock"} size={20} color={color} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: F.r, fontSize: 15, color: p.ink }}>{tick.title}</Text>
        {tick.meta ? <Text style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{tick.meta}</Text> : null}
      </View>
    </View>
  );
}

// ─── .kv — dt muted left, dd ink right, 15px, 8px between rows ─────────────────────────────────
export function KV({ rows }: { rows: { label: string; value: ReactNode; key?: string }[] }) {
  const p = usePalette();
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r) => (
        <View key={r.key ?? r.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
          <Text style={{ fontFamily: F.r, fontSize: 15, color: p.muted }}>{r.label}</Text>
          {typeof r.value === "string"
            ? <Text numberOfLines={1} selectable style={{ flexShrink: 1, fontFamily: F.r, fontSize: 15, color: p.ink, textAlign: "right", fontVariant: ["tabular-nums"] }}>{r.value}</Text>
            : r.value}
        </View>
      ))}
    </View>
  );
}

/** .card h4 — 16 semibold ink. */
export function H4({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text accessibilityRole="header" style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{children}</Text>;
}

/** .hr — 1px line, 12px above and below. */
export function Hr() {
  const p = usePalette();
  return <View style={{ height: 1, backgroundColor: p.line, marginVertical: 12 }} />;
}

/** .prog — 6px track, green fill. */
export function Prog({ percent }: { percent: number }) {
  const p = usePalette();
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ height: 6, borderRadius: 3, backgroundColor: p.track, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: "100%", borderRadius: 3, backgroundColor: p.green }} />
    </View>
  );
}

// ─── C6 option cards: 14×16 padding, 22px ring, the chosen one green ──────────────────────────
export function RadioCard({ label, on, onPress, disabled, square, testID }: { label: string; on: boolean; onPress: () => void; disabled?: boolean; square?: boolean; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole={square ? "checkbox" : "radio"} accessibilityLabel={label} accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: on ? p.green : p.line, backgroundColor: on ? p.greenSoft : pressed ? p.surf2 : p.surf, opacity: disabled && !on ? 0.6 : 1 })}>
      <View style={{ width: 22, height: 22, borderRadius: square ? 6 : 11, borderWidth: 2, borderColor: on ? p.green : p.line2, alignItems: "center", justifyContent: "center" }}>
        {on ? (square ? <Icon name="check" size={14} color={p.green} /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.green }} />) : null}
      </View>
      <Text style={{ flex: 1, fontFamily: on ? F.s : F.r, fontSize: 16, color: p.ink }}>{label}</Text>
    </Pressable>
  );
}

/** .fc as a choice (C6 quick times, C5 options): green-soft when chosen. */
export function ChoiceChip({ label, on, onPress, icon, testID }: { label: string; on: boolean; onPress: () => void; icon?: "calendar"; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 13, borderRadius: 9, borderWidth: 1, borderColor: on ? "transparent" : p.line2, backgroundColor: on ? p.greenSoft : "transparent" }}>
      {icon ? <Icon name={icon} size={16} color={on ? p.greenInk : p.body} /> : null}
      <Text style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.greenInk : p.body }}>{label}</Text>
    </Pressable>
  );
}

/** .grp-t on its own, over something that is not a grouped list (C4 "Now"). */
export function GroupTitle({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  return (
    <View style={[{ paddingTop: IOS ? 20 : 18, paddingBottom: IOS ? 7 : 6, paddingHorizontal: IOS ? 32 : 16 }, style]}>
      <Text style={IOS ? { fontFamily: F.m, fontSize: 13, color: p.muted } : { fontFamily: F.s, fontSize: 14, color: p.greenInk }}>{children}</Text>
    </View>
  );
}
