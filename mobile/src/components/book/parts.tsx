import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/icon";
import { Sheet } from "@/components/leads/sheets";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

import { moneyParts } from "./format";

/**
 * Pieces the Book screens draw that the shared kit does not: the board's money figure (.money: a small muted "$"
 * and cents beside a big whole), a tile whose figure is that money or a date (.tile with a node value), a policy
 * row whose fact line sets the policy number in mono (board F1), and the ⓘ that says where a value came from.
 */

/** .money — "$" and cents at half size, muted and raised; the whole in the figure's own size. */
export function MoneyFigure({ cents, size = 26, dropZero = false, testID }: { cents: number; size?: number; dropZero?: boolean; testID?: string }) {
  const p = usePalette();
  const parts = moneyParts(cents, dropZero);
  const small = { fontFamily: F.s, fontSize: Math.round(size / 2), color: p.muted, marginTop: Math.round(size * 0.12) } as const;
  return (
    <View testID={testID} accessible accessibilityLabel={`${parts.sign}$${parts.whole}${parts.cents ? `.${parts.cents}` : ""}`} style={{ flexDirection: "row", alignItems: "flex-start" }}>
      {parts.sign ? <Text style={{ fontFamily: F.db, fontSize: size, lineHeight: size * 1.15, color: p.ink }}>{parts.sign}</Text> : null}
      <Text style={small}>$</Text>
      <Text style={{ fontFamily: F.db, fontSize: size, lineHeight: size * 1.15, letterSpacing: -0.02 * size, color: p.ink, fontVariant: ["tabular-nums"] }}>{parts.whole}</Text>
      {parts.cents ? <Text style={small}>{`.${parts.cents}`}</Text> : null}
    </View>
  );
}

/** .tile — label, figure (money, a date at 22px, or "—"), and one muted line; pressing it can say where the figure came from. */
export function FigureTile({ label, children, detail, onPress, testID }: { label: string; children: ReactNode; detail?: string | null; onPress?: () => void; testID?: string }) {
  const p = usePalette();
  const body = (
    <>
      <Text numberOfLines={1} style={{ fontFamily: F.m, fontSize: 13, lineHeight: 17, color: p.muted }}>{label}</Text>
      <View style={{ marginTop: 2 }}>{typeof children === "string" ? <FigureText>{children}</FigureText> : children}</View>
      {detail ? <Text style={{ marginTop: 3, fontFamily: F.r, fontSize: 12.5, lineHeight: 16, color: p.muted }}>{detail}</Text> : null}
    </>
  );
  const box = { flex: 1, minWidth: 0, backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 } as const;
  if (!onPress) return <View testID={testID} style={box}>{body}</View>;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityHint="Says where this figure came from" onPress={onPress} style={({ pressed }) => [box, pressed ? { backgroundColor: p.surf2 } : null]}>{body}</Pressable>;
}

/** A tile's figure in words or a date: Inter Tight 700, 22px (the board draws dates smaller than money). */
export function FigureText({ children, size = 22 }: { children: string; size?: number }) {
  const p = usePalette();
  return <Text numberOfLines={1} style={{ fontFamily: F.db, fontSize: size, lineHeight: size * 1.2, letterSpacing: -0.02 * size, color: p.ink, fontVariant: ["tabular-nums"] }}>{children}</Text>;
}

/** .tiles — two a row, 10px apart. */
export function TilePair({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>;
}

/** Board F1's row: a plain book icon, the client, then "<mono>policy</mono> · carrier · premium", one chip on the right. */
export function PolicyRow({ title, policyNumber, facts, chip, onPress, first, testID, icon = "book" }: {
  title: string; policyNumber: string; facts: string[]; chip?: ReactNode; onPress?: () => void; first?: boolean; testID?: string; icon?: IconName;
}) {
  const p = usePalette();
  const box = IOS ? 30 : 40;
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: IOS ? 11 : 10, minHeight: IOS ? 52 : 56 }}>
      {!first ? <View style={IOS ? { position: "absolute", top: 0, left: 58, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: p.line2 } : { position: "absolute", top: 0, left: 16, right: 16, height: 1, backgroundColor: p.line }} /> : null}
      <View style={{ width: box, height: box, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={IOS ? 18 : 20} color={p.muted} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.m, fontSize: 16, color: p.ink }}>{title}</Text>
        <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 13.5, color: p.muted, marginTop: 1 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 13 }}>{policyNumber}</Text>
          {facts.map((f) => ` · ${f}`).join("")}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, maxWidth: "50%" }}>
        {chip}
        {IOS && onPress ? <Icon name="chevR" size={18} color={p.faint} /> : null}
      </View>
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${title}, policy ${policyNumber}`} onPress={onPress} android_ripple={{ color: p.surf2 }} style={({ pressed }) => (pressed && IOS ? { backgroundColor: p.surf2 } : null)}>{body}</Pressable>;
}

/** A value with its ⓘ beside it (board F2 "Status from … ⓘ"): tapping says where the value came from. */
export function Sourced({ text, onInfo, label }: { text: string; onInfo: (() => void) | null; label: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.r, fontSize: 15, lineHeight: 20, color: p.ink, fontVariant: ["tabular-nums"] }}>{text}</Text>
      {onInfo ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Where ${label.toLowerCase()} comes from`} onPress={onInfo} hitSlop={10}>
          <Icon name="alert" size={14} color={p.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The ⓘ sheet: the web's own sentence about where a value was read, and the file it came from. */
export function SourceSheet({ open, onClose }: { open: { title: string; text: string; file?: string | null } | null; onClose: () => void }) {
  const p = usePalette();
  return (
    <Sheet visible={Boolean(open)} title={open?.title ?? ""} onClose={onClose} testID="book-source-sheet">
      <View style={{ gap: 10, paddingBottom: 8 }}>
        <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink }}>{open?.text ?? ""}</Text>
        {open?.file ? <Text style={{ fontFamily: F.r, fontSize: 13, lineHeight: 18, color: p.muted }}>{open.file}</Text> : null}
        <Text style={{ fontFamily: F.r, fontSize: 13, lineHeight: 18, color: p.muted }}>Carrier data is read-only. The row as the carrier sent it opens on the computer.</Text>
      </View>
    </Sheet>
  );
}
