import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";

import { MoneyFigure } from "@/components/book/parts";
import { Avatar, F, PausedBlock } from "@/components/ui";
import { useSession } from "@/lib/session";
import { appHrefFor } from "@/lib/links";
import { currentTabs } from "@/lib/nav";
import { usePalette } from "@/theme/use-palette";

import { chartLabels, chartMax } from "./logic";

/**
 * Pieces the owner, bookkeeper and manager homes draw that the kit does not: the month's two-line chart (kit.js
 * `lines`), the producers' leader rows (.leader), the setup progress bar (.prog), two tiles a row (.tiles), and the
 * one way a web path opens from here.
 */

/** A web path opens its phone screen when there is one, else the "works best on a computer" sheet. */
export function openWeb(webPath: string, title: string) {
  const here = appHrefFor(webPath, currentTabs());
  if (here) router.push(here as never);
  else router.push(`/computer?path=${encodeURIComponent(webPath)}&title=${encodeURIComponent(title)}` as never);
}

/**
 * Board M6 on every Home: while the agency is paused or read-only (`readOnly`: a refused write's words, or the
 * plan's read-only access from /me), the Home opens with the lock, the reason and who can fix it; the rest stays
 * readable below, and the write buttons are dimmed by the kit's Button. Nothing when the agency is open.
 */
export function HomePaused() {
  const { readOnly, me } = useSession();
  if (!readOnly) return null;
  return <View testID="home-paused"><PausedBlock code={readOnly.code} message={readOnly.message} role={me?.memberRole ?? me?.role ?? null} /></View>;
}

/** .tiles — two a row, 10px apart, 16px in. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={{ paddingHorizontal: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{children}</View>;
}

/** One cell of .tiles: half the row less the gap. */
export function Half({ children }: { children: ReactNode }) {
  return <View style={{ flexBasis: "45%", flexGrow: 1, minWidth: 0 }}>{children}</View>;
}

/**
 * kit.js `lines(a, b, labels, 330, 130)`: a faint grid at 0, half and the top in $ thousands, this month's running
 * total in green with its area and an end dot, last month's same days as the gold dashed line.
 */
export function MonthChart({ series, before, width = 330, height = 130 }: { series: number[]; before: number[]; width?: number; height?: number }) {
  const p = usePalette();
  // A single day has no line to draw; it starts from nothing on the 1st.
  const a = (series.length > 1 ? series : [0, ...series]).map((c) => c / 100_000);
  const b = (before.length > 1 ? before : [0, ...before]).map((c) => c / 100_000);
  const labels = chartLabels(a.length);
  const W = width, H = height, padL = 30, padB = 20, padT = 8, iw = W - padL - 6, ih = H - padB - padT;
  const max = chartMax(series, before);
  const x = (i: number, n: number) => padL + (i * iw) / Math.max(1, n - 1);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const path = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${x(i, arr.length).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = a[a.length - 1] ?? 0;
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel="Submitted premium this month against last month">
      {[0, max / 2, max].map((t) => (
        <G key={t}>
          <Line x1={padL} x2={W - 6} y1={y(t)} y2={y(t)} stroke={p.line} strokeWidth={1} />
          <SvgText x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={p.muted} fontFamily={F.r}>{String(t)}</SvgText>
        </G>
      ))}
      {labels.map((l, i) => (l ? <SvgText key={`d${i}`} x={x(i, labels.length)} y={H - 4} textAnchor="middle" fontSize={10} fill={p.muted} fontFamily={F.r}>{l}</SvgText> : null))}
      <Path d={`${path(a)} L${x(a.length - 1, a.length)} ${y(0)} L${padL} ${y(0)}Z`} fill={p.green} opacity={0.1} />
      <Path d={path(b)} fill="none" stroke={p.gold} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
      <Path d={path(a)} fill="none" stroke={p.green} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={x(a.length - 1, a.length)} cy={y(last)} r={3.5} fill={p.green} />
    </Svg>
  );
}

/** The chart's key: a green line for this month, a gold dash for the month before (.row2.mini). */
export function ChartKey({ now, before }: { now: string; before: string }) {
  const p = usePalette();
  const word = { fontFamily: F.r, fontSize: 12.5, color: p.muted } as const;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
      <View style={{ width: 14, height: 2, backgroundColor: p.green }} />
      <Text style={word}>{now}</Text>
      <View style={{ width: 14, borderTopWidth: 2, borderStyle: "dashed", borderColor: p.gold, marginLeft: 10 }} />
      <Text style={word}>{before}</Text>
    </View>
  );
}

/** .leader — rank (gold for the first), the producer's initials, name and figure, a bar against the leader. */
export function LeaderRow({ rank, initials, name, value, share, onPress, first }: { rank: number; initials: string; name: string; value: string; share: number; onPress?: () => void; first?: boolean }) {
  const p = usePalette();
  const top = rank === 1;
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: p.line }}>
      <Text style={{ width: 22, textAlign: "center", fontFamily: F.mono, fontSize: 14, color: top ? p.goldInk : p.muted }}>{String(rank)}</Text>
      <Avatar initials={initials} size={26} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.m, fontSize: 15, color: p.ink }}>{name}</Text>
          <Text style={{ fontFamily: F.r, fontSize: 15, color: p.ink, fontVariant: ["tabular-nums"] }}>{value}</Text>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: p.track, marginTop: 6, overflow: "hidden" }}>
          <View style={{ width: `${Math.max(0, Math.min(100, share))}%`, height: "100%", backgroundColor: top ? p.gold : p.green }} />
        </View>
      </View>
    </View>
  );
  if (!onPress) return body;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${rank}. ${name}, ${value}`} onPress={onPress} android_ripple={{ color: p.surf2 }}>{body}</Pressable>;
}

/** .tile with a money figure (the board's small "$" beside the whole) and a detail that can be a chip. */
export function MoneyTile({ label, cents, detail, onPress, testID }: { label: string; cents: number | null; detail?: ReactNode; onPress?: () => void; testID?: string }) {
  const p = usePalette();
  const body = (
    <>
      <Text numberOfLines={1} style={{ fontFamily: F.m, fontSize: 13, lineHeight: 17, color: p.muted }}>{label}</Text>
      <View style={{ marginTop: 2 }}>{cents === null ? <Text style={{ fontFamily: F.db, fontSize: 26, lineHeight: 30, color: p.ink }}>—</Text> : <MoneyFigure cents={Math.round(cents / 100) * 100} size={26} dropZero />}</View>
      {detail ? <View style={{ marginTop: 3, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{typeof detail === "string" ? <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{detail}</Text> : detail}</View> : null}
    </>
  );
  const box = { flex: 1, minWidth: 0, backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 } as const;
  if (!onPress) return <View testID={testID} style={box}>{body}</View>;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${cents === null ? "unknown" : dollarsLabel(cents)}`} onPress={onPress} style={({ pressed }) => [box, pressed ? { backgroundColor: p.surf2 } : null]}>{body}</Pressable>;
}

const dollarsLabel = (cents: number) => `$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;

/** .prog — a 6px track with the share done in green. */
export function Progress({ share, label }: { share: number; label: string }) {
  const p = usePalette();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ height: 6, borderRadius: 3, backgroundColor: p.track, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(100, share))}%`, height: "100%", borderRadius: 3, backgroundColor: p.green }} />
    </View>
  );
}

/** A tile's detail with a bold rise or fall first ("<b>↑ 3</b> vs last Tue"); gold only for good news. */
export function Delta({ strong, rest, good }: { strong: string; rest: string; good: boolean }) {
  const p = usePalette();
  return (
    <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>
      <Text style={{ fontFamily: F.b, color: good ? p.goldInk : p.muted }}>{strong}</Text>
      {` ${rest}`}
    </Text>
  );
}
