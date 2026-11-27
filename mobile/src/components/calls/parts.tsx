import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { useSheetBottomInset } from "@/lib/sheet-inset";
import { usePalette } from "@/theme/use-palette";
import { ModalCover } from "@/components/states/privacy-cover";

/**
 * Board pieces the Calls screens need that the shared kit does not draw yet, measured from
 * docs/design/mobile-v1/kit.css: .sheet, .dlg, .outc, .timeline, .wk, the time-slot grid, the bottom
 * bar, a display-only .fc and a group whose title carries a tone (C11 "Overdue").
 */

// ─── bottom bar (screens-e.js `bar`: 12px 16px 34px, --bar, hairline top) ──────────────────────
export function Bar({ children }: { children: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12),backgroundColor: p.bar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line, gap: 10 }}>
      {children}
    </View>
  );
}

// ─── .dim + .sheet ─────────────────────────────────────────────────────────────────────────────
export function Dim({ onPress }: { onPress?: () => void }) {
  const p = usePalette();
  return <Pressable accessibilityLabel="Close" accessible={Boolean(onPress)} onPress={onPress} style={[StyleSheet.absoluteFill, { backgroundColor: p.dim }]} />;
}

/** The sheet itself: grab, optional title row (iOS has the round ×), then a scrolling body. */
export function SheetPanel({ title, onClose, children, style }: { title?: string; onClose: () => void; children: ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  const bottom = useSheetBottomInset();
  return (
    <View style={[{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "88%", backgroundColor: p.sheet, borderTopLeftRadius: IOS ? 14 : 28, borderTopRightRadius: IOS ? 14 : 28, paddingTop: 8, paddingBottom: Math.max(bottom, 16) }, style]}>
      <View style={IOS
        ? { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: p.line2, marginBottom: 8 }
        : { alignSelf: "center", width: 32, height: 4, borderRadius: 2, backgroundColor: p.muted, opacity: 0.5, marginTop: 6, marginBottom: 14 }} />
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4, paddingHorizontal: 16, paddingBottom: 10 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={IOS ? { flex: 1, fontFamily: F.db, fontSize: 18, letterSpacing: -0.18, color: p.ink } : { flex: 1, fontFamily: F.ds, fontSize: 22, color: p.ink }}>{title}</Text>
          {IOS ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}>
              <Icon name="x" size={16} color={p.muted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
    </View>
  );
}

/** A sheet over the current screen (C7e, C12). */
export function SheetModal({ visible, title, onClose, children }: { visible: boolean; title?: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Dim onPress={onClose} />
        <SheetPanel title={title} onClose={onClose}>{children}</SheetPanel>
      </View>
      <ModalCover />
    </Modal>
  );
}

// ─── .dlg (C10): iOS alert, Android M3 dialog. actions: first is the bold/primary one. ─────────
export type DialogAction = { label: string; onPress: () => void; bold?: boolean; testID?: string };
export function DialogBox({ title, body, actions }: { title: string; body: string; actions: DialogAction[] }) {
  const p = usePalette();
  const { width } = useWindowDimensions();
  if (IOS) {
    return (
      <View accessibilityRole="alert" style={{ width: Math.min(280, width - 48), borderRadius: 16, overflow: "hidden", backgroundColor: p.elev }}>
        <Text style={{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: 4, fontFamily: F.s, fontSize: 17, color: p.ink, textAlign: "center" }}>{title}</Text>
        <Text style={{ paddingHorizontal: 16, paddingBottom: 16, fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.body, textAlign: "center" }}>{body}</Text>
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line2 }}>
          {actions.map((a, i) => (
            <Pressable key={a.label} testID={a.testID} accessibilityRole="button" accessibilityLabel={a.label} onPress={a.onPress}
              style={({ pressed }) => ({ padding: 12, alignItems: "center", borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: p.line2, backgroundColor: pressed ? p.surf2 : "transparent" })}>
              <Text style={{ fontFamily: a.bold ? F.s : F.r, fontSize: 17, color: p.greenInk }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View accessibilityRole="alert" style={{ width: Math.min(320, width - 48), borderRadius: 28, padding: 24, backgroundColor: p.sheet }}>
      <Text style={{ fontFamily: F.ds, fontSize: 22, color: p.ink, marginBottom: 12 }}>{title}</Text>
      <Text style={{ fontFamily: F.r, fontSize: 14.5, lineHeight: 20, color: p.body }}>{body}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
        {[...actions].reverse().map((a) => (
          <Pressable key={a.label} testID={a.testID} accessibilityRole="button" accessibilityLabel={a.label} onPress={a.onPress} android_ripple={{ color: p.surf2 }} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, flexShrink: 1 }}>
            <Text style={{ fontFamily: F.s, fontSize: 14.5, color: p.greenInk }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** The dialog over a dimmed screen, inside whatever view holds it. */
export function DialogLayer(props: { title: string; body: string; actions: DialogAction[] }) {
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Dim />
      <DialogBox {...props} />
    </View>
  );
}

/** The dialog in its own transparent modal (C10 from the dialer list). */
export function DialogModal({ visible, onClose, ...props }: { visible: boolean; onClose: () => void; title: string; body: string; actions: DialogAction[] }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <DialogLayer {...props} />
      <ModalCover />
    </Modal>
  );
}

// ─── .outc — outcome tiles, two to a row; the first spans both ─────────────────────────────────
const OUTCOME_ICONS: [RegExp, IconName][] = [
  [/not[_ ]?interested/i, "x"], [/interested/i, "star"], [/app(lication)?|submitted/i, "filePen"], [/call[_ ]?back/i, "calCheck"],
  [/no[_ ]?answer|busy/i, "phoneOff"], [/voice[_ ]?mail|left[_ ]?message/i, "mic"], [/wrong/i, "ban"], [/dnc|do[_ ]?not[_ ]?call/i, "shieldX"],
  [/appointment|booked/i, "calendar"], [/bad|invalid|disconnected/i, "undo"], [/sale|sold|closed/i, "check"],
];
export function outcomeIcon(key: string, label: string): IconName {
  for (const [re, icon] of OUTCOME_ICONS) if (re.test(key) || re.test(label)) return icon;
  return "checkC";
}

export function OutcomeTiles({ items, value, onPick, disabled }: { items: { key: string; label: string }[]; value: string | null; onPick: (key: string) => void; disabled?: boolean }) {
  const p = usePalette();
  const tile = (o: { key: string; label: string }) => {
    const on = o.key === value;
    return (
      <Pressable key={o.key} testID={`outcome-${o.key}`} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={() => onPick(o.key)}
        style={({ pressed }) => ({ flex: 1, height: 54, borderRadius: 12, borderWidth: 1, borderColor: on ? p.green : p.line, backgroundColor: on ? p.greenSoft : pressed ? p.surf2 : p.surf, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 })}>
        <Icon name={outcomeIcon(o.key, o.label)} size={20} color={p.greenInk} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.s, fontSize: 15, color: p.ink }}>{o.label}</Text>
      </Pressable>
    );
  };
  const [first, ...rest] = items;
  const rows: { key: string; label: string }[][] = [];
  for (let i = 0; i < rest.length; i += 2) rows.push(rest.slice(i, i + 2));
  return (
    <View style={{ gap: 8 }}>
      {first ? <View style={{ flexDirection: "row" }}>{tile(first)}</View> : null}
      {rows.map((r) => (
        <View key={r[0].key} style={{ flexDirection: "row", gap: 8 }}>
          {r.map(tile)}
          {r.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

// ─── .timeline ─────────────────────────────────────────────────────────────────────────────────
export function Timeline({ events }: { events: { key: string; title: string; detail?: string | null }[] }) {
  const p = usePalette();
  return (
    <View style={{ paddingLeft: 22 }}>
      <View style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, backgroundColor: p.line2 }} />
      {events.map((e, i) => (
        <View key={e.key} style={{ paddingBottom: 14 }}>
          <View style={{ position: "absolute", left: -21, top: 5, width: 12, height: 12, borderRadius: 6, backgroundColor: p.surf, borderWidth: 2, borderColor: i === 0 ? p.green : p.line2 }} />
          <Text style={{ fontFamily: F.m, fontSize: 15, color: p.ink }}>{e.title}</Text>
          {e.detail ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.muted }}>{e.detail}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ─── .wk — a week of days; the chosen one is a green circle, a gold dot marks a day with work ──
export function WeekStrip({ days, value, onPick, dots, padded = true }: { days: { key: string; label: string; num: string }[]; value: string | null; onPick?: (key: string) => void; dots?: Set<string>; padded?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: 2, paddingHorizontal: padded ? 10 : 0 }}>
      {days.map((d) => {
        const on = d.key === value;
        return (
          <Pressable key={d.key} accessibilityRole={onPick ? "button" : undefined} accessibilityLabel={`${d.label} ${d.num}`} accessibilityState={{ selected: on }} disabled={!onPick} onPress={() => onPick?.(d.key)}
            style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 6 }}>
            <Text style={{ fontFamily: F.r, fontSize: 12, color: p.muted }}>{d.label}</Text>
            {/* Keyed on the selection: on Android a View whose background changes from transparent after
                its first draw loses its corner radius (a square day), so the circle is drawn afresh. */}
            <View key={on ? "on" : "off"} style={{ width: 36, height: 36, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: on ? p.green : "transparent" }}>
              <Text style={{ fontFamily: F.s, fontSize: 17, color: on ? p.onGreen : p.ink, fontVariant: ["tabular-nums"] }}>{d.num}</Text>
            </View>
            {dots ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: dots.has(d.key) ? p.gold : "transparent" }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── C9 time slots: .fc cells, three to a row, 42px ────────────────────────────────────────────
export function SlotGrid({ slots, value, onPick }: { slots: { key: string; label: string; disabled?: boolean }[]; value: string | null; onPick: (key: string) => void }) {
  const p = usePalette();
  const rows: (typeof slots)[] = [];
  for (let i = 0; i < slots.length; i += 3) rows.push(slots.slice(i, i + 3));
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r) => (
        <View key={r[0].key} style={{ flexDirection: "row", gap: 8 }}>
          {r.map((s) => {
            const on = s.key === value;
            return (
              <Pressable key={s.key} testID={`slot-${s.key}`} accessibilityRole="button" accessibilityLabel={s.label} accessibilityState={{ selected: on, disabled: s.disabled }} disabled={s.disabled} onPress={() => onPick(s.key)}
                style={{ flex: 1, height: 42, borderRadius: IOS ? 9 : 8, borderWidth: 1, borderColor: on ? "transparent" : p.line2, backgroundColor: on ? p.greenSoft : "transparent", alignItems: "center", justifyContent: "center", opacity: s.disabled ? 0.4 : 1 }}>
                <Text style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.greenInk : p.body }}>{s.label}</Text>
              </Pressable>
            );
          })}
          {Array.from({ length: 3 - r.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  );
}

// ─── .fc shown as a figure, not a filter (C7 "Called 41") ──────────────────────────────────────
export function FigureChip({ label, n, icon }: { label: string; n?: number | null; icon?: IconName }) {
  const p = usePalette();
  return (
    <View accessible accessibilityLabel={n != null ? `${label} ${n}` : label} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: IOS ? 34 : 32, paddingHorizontal: 13, borderRadius: IOS ? 9 : 8, borderWidth: 1, borderColor: p.line2 }}>
      {icon ? <Icon name={icon} size={16} color={p.body} /> : null}
      <Text style={{ fontFamily: F.m, fontSize: 14, color: p.body }}>{label}</Text>
      {n != null ? <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted, fontVariant: ["tabular-nums"] }}>{n.toLocaleString()}</Text> : null}
    </View>
  );
}

// ─── .grp-t + .grp with a coloured title (C11 "Overdue · 1") ───────────────────────────────────
export function ToneGroup({ title, color, children }: { title: string; color?: string; children: ReactNode }) {
  const p = usePalette();
  return (
    <View>
      <View style={{ paddingTop: IOS ? 20 : 18, paddingBottom: IOS ? 7 : 6, paddingHorizontal: IOS ? 32 : 16 }}>
        <Text style={IOS ? { fontFamily: color ? F.s : F.m, fontSize: 13, color: color ?? p.muted } : { fontFamily: F.s, fontSize: 14, color: color ?? p.greenInk }}>{title}</Text>
      </View>
      <View style={IOS ? { marginHorizontal: 16, backgroundColor: p.surf, borderRadius: 14, borderWidth: 1, borderColor: p.line, overflow: "hidden" } : null}>{children}</View>
    </View>
  );
}

/** .seg drawn on both platforms (kit.js `seg(items, on, true)`), for choices inside a sheet. */
export function Seg({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (key: string) => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", height: 34, backgroundColor: p.surf2, borderRadius: 10, padding: 2 }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} testID={`seg-${it.key}`} accessibilityRole="tab" accessibilityLabel={it.label} accessibilityState={{ selected: on }} onPress={() => onChange(it.key)}
            style={[{ flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 8 }, on ? { backgroundColor: p.elev, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null]}>
            <Text numberOfLines={1} style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.ink : p.body }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** .mini — 12.5 muted. */
export function Mini({ children, color, style }: { children: ReactNode; color?: string; style?: object }) {
  const p = usePalette();
  return <Text style={[{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: color ?? p.muted }, style]}>{children}</Text>;
}

/** .fc as a choice inside a sheet (C7e "TX-Term-Nov"): wraps, no tick, green-soft when on. */
export function FcChip({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", height: IOS ? 34 : 32, paddingHorizontal: 13, borderRadius: IOS ? 9 : 8, borderWidth: 1, borderColor: on ? "transparent" : p.line2, backgroundColor: on ? p.greenSoft : "transparent" }}>
      <Text numberOfLines={1} style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.greenInk : p.body }}>{label}</Text>
    </Pressable>
  );
}

/** .fab (Android): 56px, 16px corners, green, 16px from the right and above the tab bar. */
export function Fab({ label, icon, onPress, testID }: { label: string; icon: IconName; onPress: () => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} android_ripple={{ color: p.greenSoft }}
      style={{ position: "absolute", right: 16, bottom: 16, height: 56, paddingLeft: 16, paddingRight: 20, borderRadius: 16, backgroundColor: p.green, flexDirection: "row", alignItems: "center", gap: 10, elevation: 6, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 6 } }}>
      <Icon name={icon} size={24} color={p.onGreen} />
      <Text style={{ fontFamily: F.s, fontSize: 15, color: p.onGreen }}>{label}</Text>
    </Pressable>
  );
}

/** C11's key under the list: a dot and a word for each state a row can be in. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, marginTop: 14 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: it.color }} />
          <Mini>{it.label}</Mini>
        </View>
      ))}
    </View>
  );
}

/** C7's "Auto-next" chip: an .fc carrying a small switch (the board scales .sw to .6). */
export function SwitchChip({ label, icon, value, onChange, testID }: { label: string; icon?: IconName; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, height: IOS ? 34 : 32, paddingLeft: 13, paddingRight: 10, borderRadius: IOS ? 9 : 8, borderWidth: 1, borderColor: p.line2 }}>
      {icon ? <Icon name={icon} size={16} color={p.body} /> : null}
      <Text style={{ fontFamily: F.m, fontSize: 14, color: p.body }}>{label}</Text>
      <View style={{ width: 31, height: 19, borderRadius: 10, backgroundColor: value ? p.green : p.track, borderWidth: IOS || value ? 0 : 1.2, borderColor: p.muted, justifyContent: "center", paddingHorizontal: 2 }}>
        <View style={{ width: 15, height: 15, borderRadius: 8, alignSelf: value ? "flex-end" : "flex-start", backgroundColor: value ? (IOS ? "#ffffff" : p.onGreen) : IOS ? "#ffffff" : p.muted }} />
      </View>
    </Pressable>
  );
}

/** The board's toast: iOS a pill at the top, Android a snackbar near the bottom. */
export function Snack({ text, bottom = 16 }: { text: string; bottom?: number }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" accessibilityLiveRegion="polite" style={IOS
      ? { position: "absolute", top: insets.top + 14, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: p.elev, borderWidth: 1, borderColor: p.line, borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16 }
      : { position: "absolute", left: 12, right: 12, bottom, backgroundColor: p.snack, borderRadius: 6, paddingVertical: 14, paddingHorizontal: 16 }}>
      {IOS ? <Icon name="checkC" size={18} color={p.green} /> : null}
      <Text style={{ fontFamily: IOS ? F.m : F.r, fontSize: 14.5, color: IOS ? p.ink : p.onSnack }}>{text}</Text>
    </View>
  );
}
