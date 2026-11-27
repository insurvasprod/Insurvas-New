import { useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "./icon";
import { Rise } from "./motion/rise";
import { SheenRows } from "./motion/sheen";
import { refusalFor, planModule } from "@/lib/api";
import { answerState } from "@/lib/answer-state";
import { offlineLabel, ownsAgency, useBarState } from "@/lib/outbox-state";
import { toneColors, type Tone } from "@/theme/tokens";
import { usePalette } from "@/theme/use-palette";

/**
 * The app's screen kit — a measured port of the mobile board's kit (docs/design/mobile-v1/kit.css and
 * kit.js `K(p)`). Every number below is the board's: an iOS value and an Android (Material 3) value
 * wherever the board draws the two differently. Screens are composed from these and nothing else.
 * The web preview takes the iOS look (the board's left phone).
 */
export const IOS = Platform.OS !== "android";

export const F = {
  r: "Inter_400Regular", m: "Inter_500Medium", s: "Inter_600SemiBold", b: "Inter_700Bold",
  ds: "InterTight_600SemiBold", db: "InterTight_700Bold", mono: "GeistMono_500Medium",
  /** Inter Tight 500: the Android sheet title (.and .sheet .sht h5). */
  dm: "InterTight_500Medium",
} as const;

// ─── text ──────────────────────────────────────────────────────────────────────────────────────
type TextKind = "body" | "small" | "mini" | "large" | "label" | "section" | "title" | "hero" | "mono" | "ink";
/** body 16 (.scr), ink 15 ink, small 13.5 muted (.mt), mini 12.5 muted (.mini), display sizes in Inter Tight. */
export function T({ kind = "body", color, style, children, numberOfLines, selectable, center }: { kind?: TextKind; color?: string; style?: TextStyle; children: ReactNode; numberOfLines?: number; selectable?: boolean; center?: boolean }) {
  const p = usePalette();
  const base: Record<TextKind, TextStyle> = {
    body: { fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.body },
    ink: { fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink },
    small: { fontFamily: F.r, fontSize: 13.5, lineHeight: 19, color: p.muted },
    mini: { fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted },
    large: { fontFamily: F.m, fontSize: 16, lineHeight: 21, color: p.ink },
    label: { fontFamily: F.m, fontSize: 13.5, lineHeight: 18, color: p.muted },
    section: { fontFamily: F.db, fontSize: 20, lineHeight: 25, color: p.ink, letterSpacing: -0.3 },
    title: { fontFamily: F.db, fontSize: 30, lineHeight: 35, color: p.ink, letterSpacing: -0.6 },
    hero: { fontFamily: F.db, fontSize: 32, lineHeight: 35, color: p.ink, letterSpacing: -0.8 },
    mono: { fontFamily: F.mono, fontSize: 13, lineHeight: 18, color: p.ink },
  };
  return <Text selectable={selectable} numberOfLines={numberOfLines} style={[base[kind], color ? { color } : null, center ? { textAlign: "center" } : null, style]}>{children}</Text>;
}

/** .between — a row with the two ends pushed apart. */
export function Between({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, style]}>{children}</View>;
}

// ─── header (.hdr: iOS .nav + .ltitle, Android .mtop + .mtitle) ───────────────────────────────
export type HeaderAction = { icon: IconName; label: string; onPress: () => void; badge?: number } | { node: ReactNode; key: string };

export function Header({ title, back, onBack, large, actions, sub, below, belowFull }: {
  title?: string; back?: string; onBack?: () => void; large?: boolean; actions?: HeaderAction[]; sub?: string; below?: ReactNode; belowFull?: ReactNode;
}) {
  const p = usePalette();
  const isLarge = large ?? !onBack;
  // Board L4 · M6: the bar's own marks come first, on every screen — "Offline · 3 to send" (a small warn chip,
  // never a banner) and "Read only" — read from the session (lib/outbox-state.tsx), so no screen has to add them.
  const bar = useBarState();
  const marks: HeaderAction[] = [];
  if (bar.offline) marks.push({ key: "bar-offline", node: <BarMark icon="wifiOff" label={offlineLabel(bar.toSend)} tone="warn" testID="bar-offline" /> });
  if (bar.readOnly) marks.push({ key: "bar-read-only", node: <BarMark icon="lock" label="Read only" tone="neutral" testID="bar-read-only" /> });
  const acts = [...marks, ...(actions ?? []).filter((a) => !("node" in a && (a.key === "offline" || a.key === "read-only")))].map((a) =>
    "node" in a ? <View key={a.key}>{a.node}</View> : <IconButton key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} badge={a.badge} color={IOS ? p.greenInk : p.ink} />);
  if (IOS) {
    return (
      <View style={{ backgroundColor: p.canvas }}>
        <View style={{ height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 }}>
          <View style={{ minWidth: 60, flexDirection: "row", alignItems: "center" }}>
            {onBack ? (
              <Pressable accessibilityRole="button" accessibilityLabel={back ? `Back to ${back}` : "Back"} onPress={onBack} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -8 }}>
                <Icon name="chevL" size={26} color={p.greenInk} />
                {back ? <Text style={{ fontFamily: F.r, fontSize: 17, color: p.greenInk }}>{back}</Text> : null}
              </Pressable>
            ) : null}
          </View>
          {!isLarge && title ? <Text numberOfLines={1} style={{ position: "absolute", left: 80, right: 80, textAlign: "center", fontFamily: F.s, fontSize: 17, color: p.ink }}>{title}</Text> : null}
          <View style={{ minWidth: 60, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>{acts}</View>
        </View>
        {isLarge && title ? <Text style={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8, fontFamily: F.db, fontSize: 32, lineHeight: 35, letterSpacing: -0.8, color: p.ink }}>{title}</Text> : null}
        {sub ? <Text style={{ paddingHorizontal: 16, paddingBottom: 10, marginTop: -4, fontFamily: F.r, fontSize: 14, color: p.muted }}>{sub}</Text> : null}
        {below ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>{below}</View> : null}
        {belowFull}
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: p.canvas }}>
      <View style={{ height: 64, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4, paddingRight: 6 }}>
        {onBack ? <IconButton icon="arrowL" label={back ? `Back to ${back}` : "Back"} onPress={onBack} color={p.ink} round /> : <View style={{ width: 8 }} />}
        {/* .mtop .tt: the small title (22px, Inter Tight 500) only when the screen has no large one. */}
        <Text numberOfLines={1} style={{ flex: 1, paddingLeft: 8, fontFamily: F.dm, fontSize: 22, letterSpacing: -0.2, color: p.ink }}>{!isLarge && title ? title : ""}</Text>
        <View style={{ flexDirection: "row" }}>{acts}</View>
      </View>
      {/* .mtitle (owner 2026-11-26: follow the board): the large title on its own line under the 64px bar. */}
      {isLarge && title ? <Text accessibilityRole="header" style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, fontFamily: F.ds, fontSize: 30, lineHeight: 34.5, letterSpacing: -0.6, color: p.ink }}>{title}</Text> : null}
      {/* .msub */}
      {sub ? <Text style={{ paddingHorizontal: 16, paddingBottom: 10, marginTop: -6, fontFamily: F.r, fontSize: 14, color: p.muted }}>{sub}</Text> : null}
      {below ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>{below}</View> : null}
      {belowFull}
    </View>
  );
}

/** A bar chip (.chip, 26px): L4's warn "Offline · 3 to send", M6's neutral "Read only". */
export function BarMark({ icon, label, tone, testID }: { icon: IconName; label: string; tone: "warn" | "neutral"; testID?: string }) {
  const p = usePalette();
  const fg = tone === "warn" ? p.warn : p.neutral;
  const bg = tone === "warn" ? p.warnS : p.neutralS;
  return (
    <View testID={testID} accessible accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 9, borderRadius: 7, backgroundColor: bg, marginRight: IOS ? 0 : 6 }}>
      <Icon name={icon} size={14} color={fg} />
      <Text style={{ fontFamily: F.s, fontSize: 12.5, color: fg }}>{label}</Text>
    </View>
  );
}

export function IconButton({ icon, label, onPress, badge, color, round }: { icon: IconName; label: string; onPress: () => void; badge?: number; color?: string; round?: boolean }) {
  const p = usePalette();
  const size = IOS && !round ? 36 : 48;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? p.surf2 : "transparent" })}>
      <Icon name={icon} size={24} color={color ?? p.ink} />
      {badge ? <View style={{ position: "absolute", top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: p.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><Text style={{ fontFamily: F.b, fontSize: 11, color: p.onGold }}>{badge > 99 ? "99+" : String(badge)}</Text></View> : null}
    </Pressable>
  );
}

// ─── screen frame (.bd under the header; tab bar and safe areas are the platform's own) ───────
export function Screen({ header, title, sub, actions, children, onRefresh, refreshing, footer, pad = false, scroll = true }: {
  header?: ReactNode; title?: string; sub?: string; actions?: HeaderAction[]; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; footer?: ReactNode; pad?: boolean; scroll?: boolean;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const head = header ?? (title ? <Header title={title} sub={sub} actions={actions} /> : null);
  // Frame first: the header draws at once; the content rises in (240 ms, 8 px; a fade with reduced motion).
  const body = (
    <Rise style={{ paddingHorizontal: pad ? 16 : 0 }}>{children}</Rise>
  );
  return (
    <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      {head}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: (footer ? 110 : 32) + insets.bottom }}
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={p.green} colors={[p.green]} progressBackgroundColor={p.surf} /> : undefined}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {body}
        </ScrollView>
      ) : <View style={{ flex: 1 }}>{body}</View>}
      {footer ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + insets.bottom, backgroundColor: p.bar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line, gap: 10 }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

// ─── section head (.sh) ────────────────────────────────────────────────────────────────────────
export function SectionHead({ children, link, onLink, action }: { children: ReactNode; link?: string; onLink?: () => void; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: IOS ? 18 : 20, paddingBottom: 8 }}>
      <Text style={IOS ? { fontFamily: F.db, fontSize: 20, letterSpacing: -0.3, color: p.ink } : { fontFamily: F.s, fontSize: 16, color: p.ink }}>{children}</Text>
      {link ? <Pressable accessibilityRole="link" onPress={onLink} hitSlop={8}><Text style={{ fontFamily: IOS ? F.m : F.s, fontSize: IOS ? 15 : 14, color: p.greenInk }}>{link}</Text></Pressable> : action}
    </View>
  );
}

// ─── grouped lists (.grp-t / .grp / .grp-f) ───────────────────────────────────────────────────
export function Group({ title, footer, children, action }: { title?: string; footer?: string; children: ReactNode; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View>
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: IOS ? 20 : 18, paddingBottom: IOS ? 7 : 6, paddingLeft: IOS ? 32 : 16, paddingRight: IOS ? 32 : 16 }}>
          <Text style={IOS ? { fontFamily: F.m, fontSize: 13, color: p.muted } : { fontFamily: F.s, fontSize: 14, color: p.greenInk }}>{title}</Text>
          {action}
        </View>
      ) : <View style={{ height: IOS ? 16 : 8 }} />}
      <View style={IOS ? { marginHorizontal: 16, backgroundColor: p.surf, borderRadius: 14, borderWidth: 1, borderColor: p.line, overflow: "hidden" } : null}>{children}</View>
      {footer ? <Text style={{ paddingTop: IOS ? 7 : 4, paddingHorizontal: IOS ? 32 : 16, fontFamily: F.r, fontSize: 13, color: p.muted }}>{footer}</Text> : null}
    </View>
  );
}

// ─── rows (.row) ───────────────────────────────────────────────────────────────────────────────
export type IconTone = Tone | "plain";
/** Two lines: the name (16 medium ink), then one muted fact (13.5). Colour only in the one chip. */
/** `highlight`: the part of the title a search matched, drawn bold (board B4: "Maria <b>Alva</b>rez"). */
export function Row({ icon, iconTone, avatar, lead, title, meta, right, chip, chevron, onPress, first, selected, testID, highlight }: {
  icon?: IconName; iconTone?: IconTone; avatar?: string; lead?: ReactNode; title: string; meta?: string | null; right?: ReactNode; chip?: ReactNode; chevron?: boolean; onPress?: () => void; first?: boolean; selected?: boolean; testID?: string; highlight?: string;
}) {
  const p = usePalette();
  const tone = iconTone === "plain" ? { fg: p.muted, bg: "transparent" } : iconTone === "brand" || !iconTone ? { fg: p.greenInk, bg: p.surf2 } : toneColors(p, iconTone);
  const hasLead = Boolean(icon || avatar || lead);
  const box = IOS ? 30 : 40;
  const showChev = IOS && (chevron ?? Boolean(onPress));
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: IOS ? 11 : 10, minHeight: IOS ? 52 : 56, backgroundColor: selected ? p.greenSoft : "transparent" }}>
      {!first ? <View style={IOS ? { position: "absolute", top: 0, left: hasLead ? 58 : 16, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: p.line2 } : { position: "absolute", top: 0, left: 16, right: 16, height: 1, backgroundColor: p.line }} /> : null}
      {lead ?? (avatar ? <Avatar initials={avatar} /> : icon ? (
        <View style={{ width: box, height: box, borderRadius: IOS ? 8 : 12, backgroundColor: tone.bg, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={IOS ? 18 : 20} color={tone.fg} /></View>
      ) : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.m, fontSize: 16, color: p.ink }}>{highlighted(title, highlight)}</Text>
        {meta ? <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 13.5, color: p.muted, marginTop: 1 }}>{meta}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, maxWidth: "50%" }}>
        {chip}
        {right != null ? (typeof right === "string" ? <Text style={{ fontFamily: F.r, fontSize: 15, color: p.body, fontVariant: ["tabular-nums"] }}>{right}</Text> : right) : null}
        {showChev ? <Icon name="chevR" size={18} color={p.faint} /> : null}
      </View>
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} android_ripple={{ color: p.surf2 }} style={({ pressed }) => (pressed && IOS ? { backgroundColor: p.surf2 } : null)}>{body}</Pressable>;
}

/** The title with the first match of `part` in bold (case-insensitive); the plain title otherwise. */
function highlighted(title: string, part: string | undefined): ReactNode {
  const at = part ? title.toLowerCase().indexOf(part.toLowerCase()) : -1;
  if (!part || at < 0) return title;
  return <>{title.slice(0, at)}<Text style={{ fontFamily: F.b }}>{title.slice(at, at + part.length)}</Text>{title.slice(at + part.length)}</>;
}

/** .av — staff people are gold initials; never a client avatar. */
export function Avatar({ initials, size = 34 }: { initials: string; size?: number }) {
  const p = usePalette();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.gold, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily: F.b, fontSize: Math.round(size * 0.38), color: p.onGold }}>{initials}</Text></View>;
}

// ─── status: a dot plus words (.chip) ──────────────────────────────────────────────────────────
export function Chip({ tone = "neutral", children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  const p = usePalette();
  const c = toneColors(p, tone);
  return (
    // Capped so a long stage name never squeezes the row's name; the full words stay in the label.
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingHorizontal: 9, borderRadius: 7, backgroundColor: c.bg, maxWidth: 150, flexShrink: 1 }}>
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.fg }} /> : null}
      <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 12.5, color: c.fg, flexShrink: 1 }}>{children}</Text>
    </View>
  );
}

// ─── buttons (.btn: iOS 50px / 12px corners / 16px; Android 48px / 10px / 15px; .sm 38px) ─────
export type ButtonKind = "primary" | "gold" | "tonal" | "outline" | "plain" | "danger";
/**
 * `write`: the button changes something on the server. While the agency is read-only (board M6) a write button
 * stays visible but can't be pressed, drawn as the board draws "Start calling" (its own colour at half
 * strength). The gold button is the one start-work action on a screen (Start calling, Serve next lead, Take the
 * next caller, Send a lead), so it counts as a write unless it says `write={false}`.
 */
export function Button({ label, kind = "primary", icon, onPress, busy, disabled: disabledProp, small, style, testID, write }: { label: string; kind?: ButtonKind; icon?: IconName; onPress: () => void; busy?: boolean; disabled?: boolean; small?: boolean; style?: ViewStyle; testID?: string; write?: boolean }) {
  const p = usePalette();
  const { readOnly } = useBarState();
  const locked = Boolean(readOnly) && (write ?? kind === "gold");
  const disabled = disabledProp || locked;
  const look: Record<ButtonKind, { bg: string; fg: string; border?: string }> = {
    primary: { bg: p.green, fg: p.onGreen },
    gold: { bg: p.gold, fg: p.onGold },
    tonal: { bg: p.greenSoft, fg: p.greenInk },
    outline: { bg: "transparent", fg: p.ink, border: p.line2 },
    plain: { bg: "transparent", fg: p.greenInk },
    danger: { bg: "#e5484d", fg: "#ffffff" },
  };
  // A filled button that can't be pressed yet is drawn neutral (Material 3 / iOS: a quiet container and
  // muted label), not as the brand colour at half strength, which reads as a muddy, half-broken green.
  // A busy button keeps its colour so the spinner reads as "working".
  const filled = kind === "primary" || kind === "gold" || kind === "tonal" || kind === "danger";
  const l = disabled && !busy && filled && !locked ? { bg: p.surf2, fg: p.faint, border: undefined } : look[kind];
  const off = disabled || busy;
  const h = small ? 38 : IOS ? 50 : 48;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off, busy }} disabled={off}
      // Board index.html 169: haptics only on Claim, Call and Save outcome (and a buzz when dialing is blocked); those
      // screens fire their own, so a button press is silent.
      onPress={onPress}
      style={({ pressed }) => [{ height: h, paddingHorizontal: small ? 14 : 18, borderRadius: small ? 10 : IOS ? 12 : 10, backgroundColor: l.bg, borderWidth: 1, borderColor: l.border ?? "transparent", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: busy ? 0.75 : locked ? 0.5 : disabled ? (filled ? 1 : 0.45) : pressed ? 0.85 : 1, alignSelf: small ? "flex-start" : "stretch" }, style]}>
      {busy ? <ActivityIndicator color={l.fg} /> : icon ? <Icon name={icon} size={20} color={l.fg} /> : null}
      <Text style={{ fontFamily: F.s, fontSize: small ? 14 : IOS ? 16 : 15, letterSpacing: IOS ? 0 : 0.15, color: l.fg }}>{label}</Text>
    </Pressable>
  );
}

/** A green text link line (.cent.gr, 15px semibold). */
export function TextLink({ label, onPress, center = true }: { label: string; onPress: () => void; center?: boolean }) {
  const p = usePalette();
  return <Pressable accessibilityRole="link" onPress={onPress} hitSlop={8} style={center ? { alignSelf: "center" } : null}><Text style={{ fontFamily: F.s, fontSize: 15, color: p.greenInk, textAlign: center ? "center" : "left" }}>{label}</Text></Pressable>;
}

// ─── fields (.fld: iOS label above, 50px / 12px; Android outlined 56px / 8px, floating label) ──
export function Field({ label, error, hint, leadIcon, trailIcon, onTrail, trailLabel, ...input }: TextInputProps & { label: string; error?: string | null; hint?: string; leadIcon?: IconName; trailIcon?: IconName; onTrail?: () => void; trailLabel?: string }) {
  const p = usePalette();
  const [focus, setFocus] = useState(false);
  const border = error ? p.bad : focus ? p.green : p.line2;
  const ring = error || focus ? 2 : 1;
  const box = (
    <View style={{ height: IOS ? 50 : 56, borderRadius: IOS ? 12 : 8, backgroundColor: IOS ? p.field : "transparent", borderWidth: ring, borderColor: border, flexDirection: "row", alignItems: "center", paddingHorizontal: ring === 2 ? 13 : 14, gap: 10 }}>
      {leadIcon ? <Icon name={leadIcon} size={18} color={p.muted} /> : null}
      <TextInput placeholderTextColor={p.faint} accessibilityLabel={label} {...input}
        onFocus={(e) => { setFocus(true); input.onFocus?.(e); }} onBlur={(e) => { setFocus(false); input.onBlur?.(e); }}
        style={[{ flex: 1, height: "100%", fontFamily: F.r, fontSize: 16, color: p.ink, paddingVertical: 0 }, input.style]} />
      {trailIcon ? <Pressable accessibilityRole="button" accessibilityLabel={trailLabel ?? label} onPress={onTrail} hitSlop={10}><Icon name={trailIcon} size={18} color={p.muted} /></Pressable> : null}
    </View>
  );
  const below = error || hint ? <Text style={{ fontFamily: F.r, fontSize: 13, color: error ? p.bad : p.muted, paddingLeft: IOS ? 0 : 16 }}>{error ?? hint}</Text> : null;
  if (IOS) {
    return <View style={{ gap: 6 }}><Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{label}</Text>{box}{below}</View>;
  }
  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      {box}
      <Text style={{ position: "absolute", top: -8, left: 12, paddingHorizontal: 4, backgroundColor: p.canvas, fontFamily: F.m, fontSize: 12, color: focus ? p.greenInk : p.muted }}>{label}</Text>
      {below}
    </View>
  );
}

/**
 * .sw — the switch in the brand green. iOS is the platform's own; Android is drawn to the board's
 * Material 3 switch (.and .sw: 52×32 track with a 2px outline, a 16px muted thumb off, a 24px
 * on-green thumb on), which the platform widget does not draw.
 */
export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const p = usePalette();
  if (IOS) return <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: p.green, false: p.track }} thumbColor="#ffffff" ios_backgroundColor={p.track} />;
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onChange(!value)} hitSlop={8}
      style={{ width: 52, height: 32, borderRadius: 16, borderWidth: 2, borderColor: value ? p.green : p.muted, backgroundColor: value ? p.green : p.track, opacity: disabled ? 0.5 : 1 }}>
      <View style={value ? { position: "absolute", top: 2, left: 22, width: 24, height: 24, borderRadius: 12, backgroundColor: p.onGreen } : { position: "absolute", top: 6, left: 6, width: 16, height: 16, borderRadius: 8, backgroundColor: p.muted }} />
    </Pressable>
  );
}

// ─── segmented (.seg, iOS) / underline tabs (.utabs, Android) ─────────────────────────────────
export function Segments({ items, value, onChange }: { items: { key: string; label: string; count?: number }[]; value: string; onChange: (key: string) => void }) {
  const p = usePalette();
  if (!IOS) {
    return (
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: p.line }}>
        {items.map((it) => {
          const on = it.key === value;
          return (
            <Pressable key={it.key} testID={`seg-${it.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(it.key)} style={{ flexGrow: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 14 }}>
              <Text style={{ fontFamily: F.s, fontSize: 14.5, color: on ? p.greenInk : p.muted }}>{it.label}{it.count ? <Text style={{ fontFamily: F.m, opacity: 0.8 }}>{`  ${it.count}`}</Text> : null}</Text>
              {on ? <View style={{ position: "absolute", left: 12, right: 12, bottom: -1, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: p.green }} /> : null}
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", height: 34, backgroundColor: p.surf2, borderRadius: 10, padding: 2 }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} testID={`seg-${it.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(it.key)}
            style={[{ flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 8 }, on ? { backgroundColor: p.elev, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null]}>
            <Text numberOfLines={1} style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.ink : p.body }}>{it.label}{it.count ? ` ${it.count}` : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── filter chips (.fchips / .fc) ──────────────────────────────────────────────────────────────
/**
 * A row of chips. An item may carry its own `on` (a chip that is a menu, always lit, or a second, independent
 * filter) and `chevron` (it opens a picker: board I1's "Issued premium ▾").
 */
export function FilterChips({ items, value, onChange }: { items: { key: string; label: string; count?: number; icon?: IconName; on?: boolean; chevron?: boolean; testID?: string }[]; value: string | null; onChange: (key: string) => void }) {
  const p = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
      {items.map((it) => {
        const on = it.on ?? it.key === value;
        return (
          <Pressable key={it.key} testID={it.testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(it.key)}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, height: IOS ? 34 : 32, paddingHorizontal: 13, borderRadius: IOS ? 9 : 8, borderWidth: 1, borderColor: on ? "transparent" : p.line2, backgroundColor: on ? p.greenSoft : "transparent" }}>
            {on && !IOS ? <Icon name="check" size={16} color={p.greenInk} /> : null}
            {it.icon ? <Icon name={it.icon} size={16} color={on ? p.greenInk : p.body} /> : null}
            <Text style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.greenInk : p.body }}>{it.label}</Text>
            {it.count != null ? <Text style={{ fontFamily: F.r, fontSize: 12.5, color: on ? p.greenInk : p.muted, fontVariant: ["tabular-nums"] }}>{it.count.toLocaleString()}</Text> : null}
            {it.chevron ? <Icon name="chevD" size={16} color={on ? p.greenInk : p.body} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ─── search (.srch: iOS 38px / 11px; Android 52px pill) ────────────────────────────────────────
export function SearchBox({ value, onChangeText, placeholder = "Search", onPress, autoFocus, testID }: { value?: string; onChangeText?: (t: string) => void; placeholder?: string; onPress?: () => void; autoFocus?: boolean; testID?: string }) {
  const p = usePalette();
  const style: ViewStyle = { flexDirection: "row", alignItems: "center", gap: IOS ? 8 : 14, height: IOS ? 38 : 52, borderRadius: IOS ? 11 : 26, backgroundColor: p.surf2, paddingHorizontal: IOS ? 10 : 18 };
  const icon = <Icon name="search" size={IOS ? 18 : 22} color={p.muted} />;
  if (onPress) {
    return <Pressable testID={testID} accessibilityRole="search" onPress={onPress} style={style}>{icon}<Text style={{ fontFamily: F.r, fontSize: 16, color: p.muted }}>{placeholder}</Text></Pressable>;
  }
  return (
    <View style={style}>
      {icon}
      <TextInput testID={testID} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={p.muted} autoFocus={autoFocus} returnKeyType="search" autoCapitalize="none" autoCorrect={false} accessibilityLabel={placeholder}
        style={{ flex: 1, height: "100%", fontFamily: F.r, fontSize: 16, color: p.ink, paddingVertical: 0 }} />
    </View>
  );
}

// ─── cards and tiles (.card / .tile / .strip) ──────────────────────────────────────────────────
export function Card({ children, style, onPress, pad = true }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; pad?: boolean }) {
  const p = usePalette();
  const s: ViewStyle = { backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 16, ...(pad ? { paddingVertical: 14, paddingHorizontal: 16 } : null) };
  if (onPress) return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s, pressed ? { backgroundColor: p.surf2 } : null, style]}>{children}</Pressable>;
  return <View style={[s, style]}>{children}</View>;
}

export function Tile({ label, value, detail, icon, onPress, width, testID }: { label: string; value: string; detail?: ReactNode; icon?: IconName; onPress?: () => void; width?: number; testID?: string }) {
  const p = usePalette();
  const inner = (
    <>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
        {icon ? <View style={{ marginTop: 1 }}><Icon name={icon} size={15} color={p.muted} /></View> : null}
        <Text numberOfLines={2} style={{ flex: 1, fontFamily: F.m, fontSize: 13, lineHeight: 17, color: p.muted }}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={{ fontFamily: F.db, fontSize: 26, lineHeight: 30, letterSpacing: -0.5, color: p.ink, marginTop: 2, fontVariant: ["tabular-nums"] }}>{value}</Text>
      {detail ? <View style={{ marginTop: 3, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{typeof detail === "string" ? <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{detail}</Text> : detail}</View> : null}
    </>
  );
  const s: ViewStyle = { backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, minWidth: 0, ...(width ? { width } : null) };
  if (onPress) return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [s, pressed ? { backgroundColor: p.surf2 } : null]}>{inner}</Pressable>;
  return <View testID={testID} style={s}>{inner}</View>;
}

/** .fab — Android only (iOS puts the action in the bar): 56px, 16px corners, green; with a label, or square. */
export function FloatingButton({ label, icon, onPress, testID }: { label: string; icon: IconName; onPress: () => void; testID?: string }) {
  const p = usePalette();
  if (IOS) return null;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ position: "absolute", right: 16, bottom: 16, zIndex: 21, width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: p.green, opacity: pressed ? 0.9 : 1, elevation: 6, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 6 } })}>
      <Icon name={icon} size={24} color={p.onGreen} />
    </Pressable>
  );
}

/** .strip — tiles 150px wide that scroll sideways. */
export function Strip({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>{children}</ScrollView>;
}

// ─── states (board M1–M3): drawn once so every screen behaves the same ─────────────────────────
/**
 * Board M1 · .skrow skeleton rows in a group: a 30px tile, a 55% / 12px line over an 80% / 10px line, and
 * a 56×22 pill. Nothing shows for the first 180ms (frame-first rule), then a sheen crosses them while they wait
 * (components/motion/sheen.tsx).
 */
export function Loading({ rows = 6 }: { rows?: number }) {
  return <Group><SheenRows rows={rows} /></Group>;
}

/** Board M2 · .empty — 64px icon tile, 20px Inter Tight title, 15px muted line, the next move 220px wide. */
export function Empty({ icon = "check", title, body, action, tone }: { icon?: IconName; title: string; body?: string; action?: ReactNode; tone?: "bad" }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 30, paddingTop: 60, paddingBottom: 24, gap: 10 }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: tone === "bad" ? p.badS : p.surf2, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={30} color={tone === "bad" ? p.bad : p.greenInk} /></View>
      <Text accessibilityRole="header" style={{ marginTop: 6, fontFamily: F.db, fontSize: 20, lineHeight: 25, color: p.ink, textAlign: "center" }}>{title}</Text>
      {body ? <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.muted, textAlign: "center" }}>{body}</Text> : null}
      {action ? <View style={{ width: 220, marginTop: 10, alignItems: "stretch" }}>{action}</View> : null}
    </View>
  );
}

/**
 * Board M4 · Not in your plan: what is missing ("Retention isn’t in your agency’s plan"), who can add it, and what
 * stays open. No prices and no buy button (store rules). The board's "Tell Dana" button needs the owner's name
 * and a route that notifies the owner; the server has neither yet, so the owner is named by role.
 */
export function PlanBlock({ feature, role }: { feature: string | null; role: string | null }) {
  const module = planModule(feature);
  const who = ownsAgency(role) ? "You can add it from Plan and billing on the web." : "Your agency owner can add it from Plan and billing on the web.";
  return <Empty icon="lock" title={module ? `${module.name} isn’t in your agency’s plan` : "This isn’t in your agency’s plan"} body={[who, module?.keeps].filter(Boolean).join(" ")} />;
}

/**
 * Board M6 · Account paused: the reason in the server's words and who can fix it. Reading goes on where the
 * server still answers; the bar says "Read only" and write buttons are disabled (Header, Button).
 */
export function PausedBlock({ code, message, role }: { code: string | null; message: string; role: string | null }) {
  const maintenance = code === "maintenance_read_only" || code === "maintenance_locked";
  const title = maintenance ? "Insurvas is in maintenance" : code === "partner_paused" ? "Your partner account is paused" : "Your agency’s account is paused";
  // read_only is the agency's subscription (payment, pause, end): the owner fixes it. A suspended agency's words
  // already say who (support); maintenance and a partner pause are fixed by no one in the agency.
  const who = code === "read_only" ? (ownsAgency(role) ? "You can fix it from Plan and billing on the web." : "Your agency owner can fix it on the web.") : null;
  return <Empty icon="lock" title={title} body={[message, who].filter(Boolean).join(" ")} />;
}

/** Board M3 · what failed (the bad-tone refresh tile), what still holds, and a 200px Try again. */
const OFFLINE_HOLDS = "Notes, call outcomes and answers you save here wait on this phone and send when you’re back online.";

/**
 * Board M3 (and M4 / M6 when the refusal is one of those): the state is read from the server's code — passed as
 * `errorCode`, or looked up from the request that produced `message` (lib/api.ts refusalFor) — never from the words.
 */
export function Failed({ message, onRetry, what = "this", errorCode }: { message: string; onRetry: () => void; what?: string; errorCode?: { status: number; code: string | null } | null }) {
  const bar = useBarState();
  const known = refusalFor(message);
  const refusal = errorCode ? { ...errorCode, feature: known?.feature ?? null } : known;
  const state = refusal ? answerState(refusal) : "failed";
  if (state === "plan") return <PlanBlock feature={refusal?.feature ?? null} role={bar.role} />;
  if (state === "paused") return <PausedBlock code={refusal?.code ?? null} message={message} role={bar.role} />;
  if (state === "role") {
    return <Empty icon="lock" title={refusal?.code === "feature_disabled_for_tenant" ? message : `This isn’t open to your role`} body={refusal?.code === "feature_disabled_for_tenant" ? undefined : message} />;
  }
  // No answer at all: say so, and what still holds while the phone is offline (L4).
  const body = state === "offline" ? `The connection dropped while loading. ${OFFLINE_HOLDS}` : message;
  return <Empty icon="refresh" tone="bad" title={`We couldn’t load ${what}`} body={body} action={<Button testID="state-retry" label="Try again" icon="refresh" onPress={onRetry} style={{ width: 200, alignSelf: "center" }} />} />;
}

/** .kv — label left (muted), value right (ink), 15px. */
export function Fact({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 14, paddingHorizontal: 16, paddingVertical: 11, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: p.line2 }}>
      <Text style={{ fontFamily: F.r, fontSize: 15, color: p.muted }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 15, color: p.ink, flexShrink: 1, textAlign: "right", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}
