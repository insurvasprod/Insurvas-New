import { useState, type ReactNode } from "react";
import { Text, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { Card as KitCard, F } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

import { money, shortMoney, wholeMoney } from "./logic";

/**
 * Pieces the Money screens draw that the kit does not: the board's bar chart (kit.js `bars`: the last bar full green,
 * the others at 38%), the change line ("↑ $1,208.00 vs October", a rise in gold), the .kv list inside a card, and
 * the card's quiet label (.mini). The money figure itself is book/parts' MoneyFigure.
 */

/** kit.js bars(vals, labels, W, H, hi): bars 6px apart, 3px corners, labels 10px muted under them. */
export function Bars({ values, labels, height = 110, highlight, testID }: { values: number[]; labels: string[]; height?: number; highlight?: number; testID?: string }) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const n = values.length;
  const gap = 6;
  const padB = 18;
  const ih = height - padB - 4;
  const bw = n ? (width - gap * (n - 1)) / n : 0;
  const max = Math.max(...values, 0) || 1;
  const hi = highlight ?? n - 1;
  return (
    <View testID={testID} onLayout={onLayout} style={{ height }} accessible accessibilityLabel={labels.map((l, i) => `${l} ${shortMoney(values[i] ?? 0)}`).join(", ")}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {values.map((v, i) => {
            const h = Math.max(2, (v / max) * ih);
            const x = i * (bw + gap);
            return (
              <Rect key={`b${i}`} x={x} y={4 + ih - h} width={Math.max(0, bw)} height={h} rx={3} fill={p.green} opacity={i === hi ? 1 : 0.38} />
            );
          })}
          {labels.map((l, i) => (
            <SvgText key={`l${i}`} x={i * (bw + gap) + bw / 2} y={height - 3} textAnchor="middle" fontSize={10} fill={p.muted} fontFamily={F.r}>{l}</SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

/** "↑ $1,208.00 vs October": a rise is gold (owner rule), a fall stays muted and says so. */
export function Change({ cents, against, whole = false, testID }: { cents: number | null; against: string; whole?: boolean; testID?: string }) {
  const p = usePalette();
  if (cents === null) return null;
  const up = cents >= 0;
  const figure = whole ? wholeMoney(Math.abs(cents)) : money(Math.abs(cents));
  return (
    <Text testID={testID} style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted, marginTop: 4 }}>
      <Text style={{ fontFamily: F.s, color: up ? p.goldInk : p.muted }}>{`${up ? "↑" : "↓"} ${figure}`}</Text>
      {` vs ${against}`}
    </Text>
  );
}

/** .mini — the card's quiet label (12.5 muted). */
export function Mini({ children, style }: { children: ReactNode; style?: object }) {
  const p = usePalette();
  return <Text style={[{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }, style]}>{children}</Text>;
}

/** .kv — label left (muted), value right (ink), 15px, 8px between rows: the list inside a card. */
export function KeyValues({ rows, testID }: { rows: [string, string][]; testID?: string }) {
  const p = usePalette();
  return (
    <View testID={testID} style={{ gap: 8 }}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 14 }}>
          <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.muted }}>{k}</Text>
          <Text numberOfLines={1} style={{ flexShrink: 1, textAlign: "right", fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink, fontVariant: ["tabular-nums"] }}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/** .hr — a 1px rule with 12px above and below. */
export function Rule() {
  const p = usePalette();
  return <View style={{ height: 1, backgroundColor: p.line, marginVertical: 12 }} />;
}

/** .pad16 — the 16px side gutter around a card. */
export function Pad({ children, gap = 0, top = 0 }: { children: ReactNode; gap?: number; top?: number }) {
  return <View style={{ paddingHorizontal: 16, paddingTop: top, gap }}>{children}</View>;
}

/** The kit's card with a test id (the kit's own takes none); the look is the kit's. */
export function Card({ testID, children, style }: { testID?: string; children: ReactNode; style?: ViewStyle }) {
  return <View testID={testID}><KitCard style={style}>{children}</KitCard></View>;
}
