import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { MoneyFigure } from "@/components/book/parts";
import { Icon, type IconName } from "@/components/icon";
import { Card, F } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

import { dollars } from "./logic";

/**
 * Board B6's pieces the shared kit does not draw: a strip tile (.strip .tile, 150px) whose figure is money in the
 * kit's money style (small muted "$"), and the "Cash this month" card — kit.js `bars(vals, labels, 330, 100, 5)`
 * with the last bar full green, then "Deposited" and the month's total at 22px.
 */

const LABEL = { fontFamily: F.m, fontSize: 13, lineHeight: 17 } as const;

/** .strip .tile with a money figure; null cents draws "—" (the read failed: the tile stays, the figure is unknown). */
export function MoneyStripTile({ label, cents, detail, icon, onPress, testID }: { label: string; cents: number | null; detail?: ReactNode; icon?: IconName; onPress?: () => void; testID?: string }) {
  const p = usePalette();
  const body = (
    <>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
        {icon ? <View style={{ marginTop: 1 }}><Icon name={icon} size={15} color={p.muted} /></View> : null}
        <Text numberOfLines={2} style={{ ...LABEL, flex: 1, color: p.muted }}>{label}</Text>
      </View>
      <View style={{ marginTop: 2 }}>
        {cents === null ? <Text style={{ fontFamily: F.db, fontSize: 26, lineHeight: 30, color: p.ink }}>—</Text> : <MoneyFigure cents={Math.round(cents / 100) * 100} size={26} dropZero />}
      </View>
      {detail ? <View style={{ marginTop: 3, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{typeof detail === "string" ? <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{detail}</Text> : detail}</View> : null}
    </>
  );
  const box = { width: 150, minWidth: 0, backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 } as const;
  const said = `${label}: ${cents === null ? "unknown" : dollars(cents)}`;
  if (!onPress) return <View testID={testID} accessible accessibilityLabel={said} style={box}>{body}</View>;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={said} onPress={onPress} style={({ pressed }) => [box, pressed ? { backgroundColor: p.surf2 } : null]}>{body}</Pressable>;
}

/** kit.js bars(vals, labels, 330, 100, hi): bars 6px apart, 3px corners, the highlighted one full green, the rest at 38%. */
export function CashBars({ values, labels, describe, width = 330, height = 100 }: { values: number[]; labels: string[]; describe: string[]; width?: number; height?: number }) {
  const p = usePalette();
  const n = values.length;
  const gap = 6;
  const padB = labels.some(Boolean) ? 18 : 2;
  const ih = height - padB - 4;
  const bw = n ? (width - gap * (n - 1)) / n : 0;
  const max = Math.max(...values, 0) || 1;
  const hi = n - 1;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={describe.join(", ")} testID="books-cash-bars">
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {values.map((v, i) => {
          const h = Math.max(2, (v / max) * ih);
          const x = i * (bw + gap);
          return <Rect key={`b${i}`} x={x} y={4 + ih - h} width={Math.max(0, bw)} height={h} rx={3} fill={p.green} opacity={i === hi ? 1 : 0.38} />;
        })}
        {labels.map((l, i) => (l ? <SvgText key={`l${i}`} x={i * (bw + gap) + bw / 2} y={height - 3} textAnchor="middle" fontSize={10} fill={p.muted} fontFamily={F.r}>{l}</SvgText> : null))}
      </Svg>
    </View>
  );
}

/** The card: the bars, then "Deposited" (muted) and the total (22px, money style) on one line (.between). */
export function CashCard({ bars, totalCents, onPress }: { bars: ReactNode; totalCents: number | null; onPress?: () => void }) {
  const p = usePalette();
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Card onPress={onPress}>
        {bars}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: bars ? 8 : 0 }}>
          <Text style={{ fontFamily: F.r, fontSize: 15, color: p.muted }}>Deposited</Text>
          {totalCents === null
            ? <Text style={{ fontFamily: F.db, fontSize: 22, lineHeight: 25, color: p.ink }}>—</Text>
            : <MoneyFigure testID="books-deposited" cents={Math.round(totalCents / 100) * 100} size={22} dropZero />}
        </View>
      </Card>
    </View>
  );
}
