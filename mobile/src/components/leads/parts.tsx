import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";
import { ModalCover } from "@/components/states/privacy-cover";

/**
 * Pieces of the mobile board the shared kit (components/ui.tsx) does not draw yet, measured from
 * docs/design/mobile-v1/kit.css: the stage path (.path), underline tabs on both platforms (.utabs),
 * the card title (.card h4), key/value pairs (.kv), the timeline (.timeline .ev), the note composer
 * (.composer) and a picker sheet (.sheet, rows only).
 */

// ─── .path — chevron segments, 32px, 13.5px semibold, 4px apart; done soft green, current green ────
/**
 * The path scrolls so the current stage shows with the one before it (as on the board, where the
 * current one sits third with the done ones to its left), however long the stage names are.
 */
export function StagePath({ stages, current, testID, onPick }: { stages: { id: string; name: string }[]; current: number; testID?: string; onPick?: (index: number) => void }) {
  const scroller = useRef<ScrollViewInstance>(null);
  const [xs, setXs] = useState<Record<number, number>>({});
  const target = current > 0 ? current - 1 : 0;
  const targetX = xs[target];
  useEffect(() => {
    if (targetX === undefined || target === 0) return;
    scroller.current?.scrollTo({ x: Math.max(0, targetX - 16), animated: false });
  }, [targetX, target]);
  return (
    <ScrollView ref={scroller} testID={testID} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 4 }}
      accessibilityLabel={current >= 0 ? `Stage ${current + 1} of ${stages.length}: ${stages[current]?.name ?? ""}` : undefined}>
      {stages.map((s, i) => (
        <View key={s.id} onLayout={i === target ? (e) => { const x = e.nativeEvent.layout.x; setXs((cur) => (cur[i] === x ? cur : { ...cur, [i]: x })); } : undefined}>
          <PathSeg testID={testID ? `${testID}-${s.id}` : undefined} label={s.name} first={i === 0} state={i < current ? "done" : i === current ? "cur" : "todo"}
            onPress={onPick && i !== current ? () => onPick(i) : undefined} />
        </View>
      ))}
    </ScrollView>
  );
}

function PathSeg({ label, first, state, onPress, testID }: { label: string; first: boolean; state: "done" | "cur" | "todo"; onPress?: () => void; testID?: string }) {
  const p = usePalette();
  const [w, setW] = useState(0);
  const bg = state === "cur" ? p.green : state === "done" ? p.greenSoft : p.surf2;
  const fg = state === "cur" ? p.onGreen : state === "done" ? p.greenInk : p.muted;
  // clip-path: polygon(0 0, 100%-9px 0, 100% 50%, 100%-9px 100%, 0 100%, 9px 50%); the first has square-cut 8px corners on the left.
  const d = first
    ? `M8 0 L${w - 9} 0 L${w} 16 L${w - 9} 32 L8 32 Q0 32 0 24 L0 8 Q0 0 8 0 Z`
    : `M0 0 L${w - 9} 0 L${w} 16 L${w - 9} 32 L0 32 L9 16 Z`;
  const body = (
    <View onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} style={{ height: 32, justifyContent: "center", paddingLeft: first ? 14 : 18, paddingRight: 14 }}>
      {w > 0 ? <Svg width={w} height={32} style={StyleSheet.absoluteFill}><Path d={d} fill={bg} /></Svg> : null}
      <Text style={{ fontFamily: F.s, fontSize: 13.5, color: fg }}>{label}</Text>
    </View>
  );
  if (!onPress) return body;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`Move to ${label}`} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{body}</Pressable>;
}

// ─── .utabs — 14.5px semibold, 12/14 padding, 3px green underline inset 12px ───────────────────
/** Two or three tabs share the width; more scroll sideways, as the lead page's six do on the board. */
export function UnderTabs({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (key: string) => void }) {
  const p = usePalette();
  const scroll = items.length > 3;
  const tabs = items.map((it) => {
    const on = it.key === value;
    return (
      <Pressable key={it.key} testID={`tab-${it.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(it.key)} style={{ flexGrow: scroll ? 0 : 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 14 }}>
        <Text style={{ fontFamily: F.s, fontSize: 14.5, color: on ? p.greenInk : p.muted }}>{it.label}</Text>
        {on ? <View style={{ position: "absolute", left: 12, right: 12, bottom: scroll ? 0 : -1, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: p.green }} /> : null}
      </Pressable>
    );
  });
  if (!scroll) return <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: p.line }}>{tabs}</View>;
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: p.line }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row" }}>{tabs}</ScrollView>
    </View>
  );
}

// ─── .card.p with an h4 (16px semibold ink) ─────────────────────────────────────────────────────
export function CardTitle({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{children}</Text>;
}

// ─── .kv — label muted left, value ink right, 15px, rows 8px apart ─────────────────────────────
export function KV({ pairs }: { pairs: [string, ReactNode][] }) {
  const p = usePalette();
  return (
    <View style={{ gap: 8 }}>
      {pairs.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 20, color: p.muted }}>{k}</Text>
          <View style={{ flex: 1, minWidth: 0, alignItems: "flex-end" }}>
            {typeof v === "string" ? <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 15, lineHeight: 20, color: p.ink, fontVariant: ["tabular-nums"] }}>{v}</Text> : v}
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── .timeline — 2px rail at 6px, 12px rings (green, or line2 when older), 15px / 13px lines ────
export type TimelineItem = { id: string; title: string; meta: string; muted: boolean };
export function Timeline({ items }: { items: TimelineItem[] }) {
  const p = usePalette();
  return (
    <View style={{ paddingLeft: 22 }}>
      <View style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, backgroundColor: p.line2 }} />
      {items.map((e) => (
        <View key={e.id} style={{ paddingBottom: 14 }}>
          <View style={{ position: "absolute", left: -21, top: 5, width: 12, height: 12, borderRadius: 6, backgroundColor: p.surf, borderWidth: 2, borderColor: e.muted ? p.line2 : p.green }} />
          <Text style={{ fontFamily: F.m, fontSize: 15, lineHeight: 20, color: p.ink }}>{e.title}</Text>
          {e.meta ? <Text style={{ fontFamily: F.r, fontSize: 13, lineHeight: 18, color: p.muted }}>{e.meta}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ─── .composer — iOS 38px round field with a border; Android 48px filled field on the surface ───
export function Composer({ value, onChange, onSend, busy, placeholder }: { value: string; onChange: (t: string) => void; onSend: () => void; busy?: boolean; placeholder: string }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const ready = Boolean(value.trim()) && !busy;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 + insets.bottom, backgroundColor: IOS ? p.bar : p.surf, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }}>
      <TextInput testID="note-input" value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.faint} accessibilityLabel="New note" multiline
        style={[{ flex: 1, fontFamily: F.r, fontSize: 16, color: p.ink, paddingHorizontal: 14, paddingVertical: IOS ? 8 : 12, maxHeight: 120 },
          IOS ? { minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: p.line2, backgroundColor: p.field } : { minHeight: 48, borderRadius: 24, backgroundColor: p.surf2 }]} />
      <Pressable testID="note-send" accessibilityRole="button" accessibilityLabel="Post note" accessibilityState={{ disabled: !ready, busy }} disabled={!ready} onPress={onSend}
        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: p.green, alignItems: "center", justifyContent: "center", opacity: ready ? 1 : 0.5 }}>
        <Icon name="send" size={18} color={p.onGreen} />
      </Pressable>
    </View>
  );
}

// ─── .sheet with rows: a picker (grab, 18px title / Android 22px, rows, the chosen one soft green) ─
export function PickerSheet({ title, items, value, onPick, onClose, visible }: { title: string; items: { key: string; label: string; meta?: string; icon?: IconName }[]; value: string | null; onPick: (key: string) => void; onClose: () => void; visible: boolean }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType={reduced ? "fade" : "slide"} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: p.dim }} />
      <View style={{ backgroundColor: p.sheet, borderTopLeftRadius: IOS ? 14 : 28, borderTopRightRadius: IOS ? 14 : 28, paddingTop: 8, paddingBottom: 12 + insets.bottom, maxHeight: "80%" }}>
        <View style={IOS ? { width: 36, height: 5, borderRadius: 3, backgroundColor: p.line2, alignSelf: "center", marginBottom: 8 } : { width: 32, height: 4, borderRadius: 2, backgroundColor: p.muted, opacity: 0.5, alignSelf: "center", marginTop: 6, marginBottom: 14 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
          <Text style={IOS ? { fontFamily: F.db, fontSize: 18, letterSpacing: -0.2, color: p.ink } : { fontFamily: F.ds, fontSize: 22, color: p.ink }}>{title}</Text>
          {IOS ? <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}><Icon name="x" size={16} color={p.muted} /></Pressable> : null}
        </View>
        <ScrollView>
          {items.map((it) => {
            const on = it.key === value;
            return (
              <Pressable key={it.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { onPick(it.key); onClose(); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: IOS ? 11 : 10, minHeight: IOS ? 52 : 56, backgroundColor: on ? p.greenSoft : "transparent" }}>
                {it.icon ? <View style={{ width: IOS ? 30 : 40, height: IOS ? 30 : 40, borderRadius: IOS ? 8 : 12, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}><Icon name={it.icon} size={IOS ? 18 : 20} color={p.greenInk} /></View> : null}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: F.m, fontSize: 16, color: p.ink }}>{it.label}</Text>
                  {it.meta ? <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 13.5, color: p.muted, marginTop: 1 }}>{it.meta}</Text> : null}
                </View>
                {on ? <Icon name="checkC" size={20} color={p.greenInk} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <ModalCover />
    </Modal>
  );
}
