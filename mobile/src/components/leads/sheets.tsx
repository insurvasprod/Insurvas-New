import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { useSheetBottomInset } from "@/lib/sheet-inset";
import { usePalette } from "@/theme/use-palette";
import { ModalCover } from "@/components/states/privacy-cover";

/**
 * Overlays and controls the lead screens draw that the shared kit does not yet, measured from
 * docs/design/mobile-v1/kit.css: the sheet (.sheet), the row-actions menu (k.actions: .acts-ios on
 * iOS, a bottom sheet on Android), the alert (.dlg), fields that sit on a sheet (.on-surf .fld), the
 * toast (.toast), and filter chips that wrap or can be removed (.fchips / .fc.on).
 */

// ─── .sheet — dim, grab, title (iOS 18 bold + round x; Android 22 + a right-hand link), body ────
export function Sheet({ visible, title, onClose, children, right, full, testID, footer }: { visible: boolean; title: string; onClose: () => void; children: ReactNode; right?: ReactNode; full?: boolean; testID?: string; footer?: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const bottom = useSheetBottomInset();
  // Reduced motion: the sheet fades in place instead of sliding up.
  const reduced = useReducedMotion();
  return (
    // Edge to edge on Android: the dim covers the status and navigation bars, and the sheet's own bottom padding
    // (the safe-area inset) keeps its buttons above the gesture bar. Without these the window stopped above the
    // navigation bar, leaving an undimmed strip of the screen below under a double gap.
    <Modal visible={visible} transparent animationType={reduced ? "fade" : "slide"} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* A translucent Modal's window no longer shrinks for the Android keyboard, so the sheet pads itself on both. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={[{ backgroundColor: p.dim }, full ? { height: insets.top + 14 } : { flex: 1 }]} />
        <View testID={testID} style={[{ backgroundColor: p.sheet, borderTopLeftRadius: IOS ? 14 : 28, borderTopRightRadius: IOS ? 14 : 28, paddingTop: 8, paddingBottom: 12 + bottom }, full ? { flex: 1 } : { maxHeight: "88%" }]}>
          <View style={IOS ? { width: 36, height: 5, borderRadius: 3, backgroundColor: p.line2, alignSelf: "center", marginBottom: 8 } : { width: 32, height: 4, borderRadius: 2, backgroundColor: p.muted, opacity: 0.5, alignSelf: "center", marginTop: 6, marginBottom: 14 }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 10 }}>
            <Text accessibilityRole="header" style={[{ flex: 1, color: p.ink }, IOS ? { fontFamily: F.db, fontSize: 18, letterSpacing: -0.2 } : { fontFamily: F.ds, fontSize: 22 }]}>{title}</Text>
            {IOS ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}><Icon name="x" size={16} color={p.muted} /></Pressable>
            ) : right ?? null}
          </View>
          <ScrollView style={full ? { flex: 1 } : null} contentContainerStyle={{ paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
          {footer ? <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
      <ModalCover />
    </Modal>
  );
}

// ─── row actions: iOS action sheet (.acts-ios) / Android bottom-sheet menu (k.actions) ──────────
export type SheetAction = { key: string; label: string; icon: IconName; destructive?: boolean; onPress: () => void };
export function ActionSheet({ visible, title, actions, onClose }: { visible: boolean; title: string; actions: SheetAction[]; onClose: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  // iOS cannot present an alert or another modal while this one is still sliding away.
  const run = (a: SheetAction) => { onClose(); setTimeout(a.onPress, IOS ? 400 : 0); };
  if (!IOS) {
    return (
      <Sheet visible={visible} title={title} onClose={onClose} testID="lead-actions">
        <View style={{ marginHorizontal: -16 }}>
          {actions.map((a) => (
            <Pressable key={a.key} testID={`action-${a.key}`} accessibilityRole="button" accessibilityLabel={a.label} onPress={() => run(a)} android_ripple={{ color: p.surf2 }}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 52 }}>
              <View style={{ width: 40, alignItems: "center" }}><Icon name={a.icon} size={22} color={a.destructive ? p.bad : p.muted} /></View>
              <Text style={{ flex: 1, fontFamily: F.m, fontSize: 16, color: a.destructive ? p.bad : p.ink }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
    );
  }
  const red = "#ff5a5f";
  return (
    <Modal visible={visible} transparent animationType={reduced ? "fade" : "slide"} onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: p.dim }} />
      <View testID="lead-actions" style={{ position: "absolute", left: 8, right: 8, bottom: Math.max(insets.bottom, 8) + 8, gap: 8 }}>
        <View style={{ backgroundColor: p.elev, borderRadius: 14, overflow: "hidden" }}>
          <Text style={{ paddingVertical: 12, paddingHorizontal: 16, textAlign: "center", fontFamily: F.r, fontSize: 13, color: p.muted, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.line2 }}>{title}</Text>
          {actions.map((a, i) => (
            <Pressable key={a.key} testID={`action-${a.key}`} accessibilityRole="button" accessibilityLabel={a.label} onPress={() => run(a)}
              style={({ pressed }) => ({ padding: 16, backgroundColor: pressed ? p.surf2 : "transparent", borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: p.line2 })}>
              <Text style={{ textAlign: "center", fontFamily: F.r, fontSize: 19, color: a.destructive ? red : p.greenInk }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} style={({ pressed }) => ({ backgroundColor: pressed ? p.surf2 : p.elev, borderRadius: 14, padding: 16 })}>
          <Text style={{ textAlign: "center", fontFamily: F.s, fontSize: 19, color: p.greenInk }}>Cancel</Text>
        </Pressable>
      </View>
      <ModalCover />
    </Modal>
  );
}

// ─── .dlg — iOS 280px alert with stacked actions; Android 320px, 28px corners, actions on the right ─
export type DialogAction = { label: string; kind?: "bold" | "destructive"; onPress: () => void; disabled?: boolean; testID?: string };
export function Dialog({ visible, title, children, actions, onClose }: { visible: boolean; title: string; children?: ReactNode; actions: DialogAction[]; onClose: () => void }) {
  const p = usePalette();
  const ordered = IOS ? actions : [...actions].reverse();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.dim, alignItems: "center", justifyContent: "center" }}>
        <View accessibilityRole="alert" style={IOS ? { width: 280, borderRadius: 16, overflow: "hidden", backgroundColor: p.elev } : { width: 320, borderRadius: 28, padding: 24, backgroundColor: p.sheet }}>
          <Text style={IOS ? { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 4, textAlign: "center", fontFamily: F.s, fontSize: 17, color: p.ink } : { fontFamily: F.ds, fontSize: 22, color: p.ink, marginBottom: 12 }}>{title}</Text>
          {children ? <View style={IOS ? { paddingHorizontal: 16, paddingBottom: 16 } : null}>{children}</View> : null}
          <View style={IOS ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line2 } : { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
            {ordered.map((a, i) => (
              <Pressable key={a.label} testID={a.testID} accessibilityRole="button" accessibilityLabel={a.label} accessibilityState={{ disabled: Boolean(a.disabled) }} disabled={a.disabled} onPress={a.onPress}
                style={({ pressed }) => [IOS ? { padding: 12, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: p.line2 } : { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }, { opacity: a.disabled ? 0.4 : 1, backgroundColor: pressed ? p.surf2 : "transparent" }]}>
                <Text style={IOS
                  ? { textAlign: "center", fontFamily: a.kind === "bold" ? F.s : F.r, fontSize: 17, color: a.kind === "destructive" ? "#ff5a5f" : p.greenInk }
                  : { fontFamily: F.s, fontSize: 14.5, color: a.kind === "destructive" ? p.bad : p.greenInk }}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
      <ModalCover />
    </Modal>
  );
}

// ─── .fld on a sheet (.on-surf: Android's floating label sits on the sheet colour) ──────────────
type FieldShell = { label: string; error?: string | null; hint?: string };
function FieldFrame({ label, error, hint, focus, children }: FieldShell & { focus?: boolean; children: ReactNode }) {
  const p = usePalette();
  const border = error ? p.bad : focus ? p.green : p.line2;
  const ring = error || focus ? 2 : 1;
  const box = (
    <View style={{ minHeight: IOS ? 50 : 56, borderRadius: IOS ? 12 : 8, backgroundColor: IOS ? p.field : "transparent", borderWidth: ring, borderColor: border, flexDirection: "row", alignItems: "center", paddingHorizontal: ring === 2 ? 13 : 14, gap: 10 }}>{children}</View>
  );
  const below = error || hint ? <Text style={{ fontFamily: F.r, fontSize: 13, color: error ? p.bad : p.muted, paddingLeft: IOS ? 0 : 16 }}>{error ?? hint}</Text> : null;
  if (IOS) return <View style={{ gap: 6 }}><Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{label}</Text>{box}{below}</View>;
  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      {box}
      <Text style={{ position: "absolute", top: -8, left: 12, paddingHorizontal: 4, backgroundColor: p.sheet, fontFamily: F.m, fontSize: 12, color: focus ? p.greenInk : p.muted }}>{label}</Text>
      {below}
    </View>
  );
}

export function SheetField({ label, error, hint, leadIcon, testID, ...input }: TextInputProps & FieldShell & { leadIcon?: IconName }) {
  const p = usePalette();
  const [focus, setFocus] = useState(false);
  return (
    <FieldFrame label={label} error={error} hint={hint} focus={focus}>
      {leadIcon ? <Icon name={leadIcon} size={18} color={p.muted} /> : null}
      <TextInput testID={testID} placeholderTextColor={p.faint} accessibilityLabel={label} {...input}
        onFocus={(e) => { setFocus(true); input.onFocus?.(e); }} onBlur={(e) => { setFocus(false); input.onBlur?.(e); }}
        style={[{ flex: 1, minHeight: IOS ? 48 : 54, fontFamily: F.r, fontSize: 16, color: p.ink, paddingVertical: input.multiline ? 12 : 0 }, input.style]} />
    </FieldFrame>
  );
}

/** A field that opens a picker: the value, then a chevron (or the icon the board draws). */
export function SelectField({ label, value, placeholder, onPress, trail = "chevD", error, testID, disabled }: FieldShell & { value: string | null; placeholder?: string; onPress: () => void; trail?: IconName; testID?: string; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? placeholder ?? "not chosen"}`} disabled={disabled} onPress={onPress}>
      <FieldFrame label={label} error={error}>
        <Text numberOfLines={2} style={{ flex: 1, paddingVertical: 10, fontFamily: F.r, fontSize: 16, color: value ? p.ink : p.faint }}>{value ?? placeholder ?? "Choose…"}</Text>
        {disabled ? null : <Icon name={trail} size={18} color={p.muted} />}
      </FieldFrame>
    </Pressable>
  );
}

// ─── .toast — iOS a pill under the status bar; Android a snackbar above the tab bar ─────────────
export function Toast({ text, onHide, bottom = 16 }: { text: string | null; onHide: () => void; bottom?: number }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const hide = useEffectEvent(onHide);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => hide(), 3500);
    return () => clearTimeout(t);
  }, [text]);
  if (!text) return null;
  if (IOS) {
    return (
      <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: "absolute", top: insets.top + 14, left: 0, right: 0, alignItems: "center", zIndex: 45 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: p.elev, borderWidth: 1, borderColor: p.line, borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16, maxWidth: "92%", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 15, shadowOffset: { width: 0, height: 10 } }}>
          <Icon name="checkC" size={18} color={p.green} />
          <Text numberOfLines={2} style={{ fontFamily: F.m, fontSize: 14.5, color: p.ink, flexShrink: 1 }}>{text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: "absolute", left: 12, right: 12, bottom, zIndex: 45, backgroundColor: p.snack, borderRadius: 6, paddingVertical: 14, paddingHorizontal: 16 }}>
      <Text style={{ fontFamily: F.r, fontSize: 14.5, color: p.onSnack }}>{text}</Text>
    </View>
  );
}

// ─── .seg on both platforms (the board draws List / Board as a segmented control on Android too) ─
export function SegControl({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (key: string) => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", height: 34, backgroundColor: p.surf2, borderRadius: 10, padding: 2 }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} testID={`seg-${it.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(it.key)}
            style={[{ flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 8 }, on ? { backgroundColor: p.elev, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null]}>
            <Text numberOfLines={1} style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.ink : p.body }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── .fab — Android only: 56px, 16px corners, green; with a label, or square ────────────────────
export function Fab({ label, icon, onPress, testID }: { label?: string; icon: IconName; onPress: () => void; testID?: string }) {
  const p = usePalette();
  if (IOS) return null;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label ?? "Add lead"} onPress={onPress}
      style={({ pressed }) => ({ position: "absolute", right: 16, bottom: 16, zIndex: 21, flexDirection: "row", alignItems: "center", gap: 10, height: 56, borderRadius: 16, backgroundColor: p.green, opacity: pressed ? 0.9 : 1,
        ...(label ? { paddingLeft: 16, paddingRight: 20 } : { width: 56, justifyContent: "center" }), elevation: 6, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 6 } })}>
      <Icon name={icon} size={24} color={p.onGreen} />
      {label ? <Text style={{ fontFamily: F.s, fontSize: 15, color: p.onGreen }}>{label}</Text> : null}
    </Pressable>
  );
}

// ─── removable filter chips (.fc.on with an x), under the stages ────────────────────────────────
export function ActiveChips({ items, onRemove }: { items: { key: string; label: string }[]; onRemove: (key: string) => void }) {
  const p = usePalette();
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingTop: 8 }}>
      {items.map((it) => (
        <Pressable key={it.key} testID={`filter-chip-${it.key}`} accessibilityRole="button" accessibilityLabel={`Remove filter ${it.label}`} onPress={() => onRemove(it.key)}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, height: IOS ? 34 : 32, paddingHorizontal: 13, borderRadius: IOS ? 9 : 8, backgroundColor: p.greenSoft }}>
          <Text style={{ fontFamily: F.s, fontSize: 14, color: p.greenInk }}>{it.label}</Text>
          <Icon name="x" size={14} color={p.greenInk} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ─── wrapping chips (.fchips with flex-wrap), one choice, tap again to clear ────────────────────
export function ChoiceChips({ items, value, onChange, testID }: { items: { key: string; label: string }[]; value: string | null; onChange: (key: string | null) => void; testID?: string }) {
  const p = usePalette();
  return (
    <View testID={testID} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={it.label} onPress={() => onChange(on ? null : it.key)}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, height: IOS ? 34 : 32, paddingHorizontal: 13, borderRadius: IOS ? 9 : 8, borderWidth: 1, borderColor: on ? "transparent" : p.line2, backgroundColor: on ? p.greenSoft : "transparent" }}>
            {on && !IOS ? <Icon name="check" size={16} color={p.greenInk} /> : null}
            <Text style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.greenInk : p.body }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
