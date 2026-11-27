import { Pressable, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";
import type { ItemTone, MonthCell } from "./month";

/**
 * Board pieces the Calendar screens need that the shared kit does not draw, measured from
 * docs/design/mobile-v1/kit.css: the .month grid (C13) and a picker drawn as a .fld (C8b "With").
 */

// ─── .month: 7 columns, 42px days, a 34px green circle on the chosen one, 5px dots under ──────
export function MonthGrid({ cells, value, today, dots, onPick }: { cells: MonthCell[]; value: string; today: string; dots: Map<string, ItemTone[]>; onPick: (cell: MonthCell) => void }) {
  const p = usePalette();
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const dotColor = (t: ItemTone) => (t === "late" ? p.warn : t === "done" ? p.green : p.gold);
  return (
    <View style={{ paddingHorizontal: 10, gap: 4 }} testID="month-grid">
      <View style={{ flexDirection: "row" }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((h, i) => (
          <Text key={`${h}${i}`} style={{ flex: 1, textAlign: "center", paddingVertical: 4, fontFamily: F.r, fontSize: 12, color: p.muted }}>{h}</Text>
        ))}
      </View>
      {weeks.map((w) => (
        <View key={w[0].key} style={{ flexDirection: "row" }}>
          {w.map((c) => {
            const on = c.key === value;
            const d = dots.get(c.key) ?? [];
            return (
              <Pressable key={c.key} testID={`day-${c.key}`} accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={`${c.key}${c.key === today ? ", today" : ""}${d.length ? `, ${d.length} ${d.length === 1 ? "thing" : "things"}` : ""}`}
                onPress={() => onPick(c)} style={{ flex: 1, height: 42, alignItems: "center", justifyContent: "center", gap: 2 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: on ? p.green : "transparent" }}>
                  <Text style={{ fontFamily: F.m, fontSize: 15, color: on ? p.onGreen : c.inMonth ? p.ink : p.faint, fontVariant: ["tabular-nums"] }}>{c.num}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 2, height: 5 }}>
                  {c.inMonth ? d.map((t, i) => <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: dotColor(t) }} />) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── a picker drawn as a .fld (iOS label above, 50px / 12px; Android outlined 56px / 8px) ─────
export function SelectField({ label, value, onPress, leadIcon, open, testID, onSheet = true }: { label: string; value: string; onPress: () => void; leadIcon?: IconName; open?: boolean; testID?: string; onSheet?: boolean }) {
  const p = usePalette();
  const box = (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ expanded: Boolean(open) }} onPress={onPress}
      style={{ height: IOS ? 50 : 56, borderRadius: IOS ? 12 : 8, backgroundColor: IOS ? p.field : "transparent", borderWidth: open ? 2 : 1, borderColor: open ? p.green : p.line2, flexDirection: "row", alignItems: "center", paddingHorizontal: open ? 13 : 14, gap: 10 }}>
      {leadIcon ? <Icon name={leadIcon} size={18} color={p.muted} /> : null}
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.r, fontSize: 16, color: p.ink }}>{value}</Text>
      <Icon name="chevD" size={18} color={p.muted} />
    </Pressable>
  );
  if (IOS) return <View style={{ gap: 6 }}><Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{label}</Text>{box}</View>;
  return (
    <View style={{ marginTop: 8 }}>
      {box}
      <Text style={{ position: "absolute", top: -8, left: 12, paddingHorizontal: 4, backgroundColor: onSheet ? p.sheet : p.canvas, fontFamily: F.m, fontSize: 12, color: open ? p.greenInk : p.muted }}>{label}</Text>
    </View>
  );
}

// ─── C13b's map tile: a 130px street grid (26px squares in --surf2) with the green pin over it ─
export function MapTile() {
  const p = usePalette();
  const lines = Array.from({ length: 24 }, (_, i) => i);
  return (
    <View accessible={false} style={{ height: 130, overflow: "hidden" }}>
      {lines.map((i) => <View key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: i * 26, height: 1, backgroundColor: p.surf2 }} />)}
      {lines.map((i) => <View key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: i * 26, width: 1, backgroundColor: p.surf2 }} />)}
      <View style={{ position: "absolute", left: 0, right: 0, top: 130 * 0.42 - 17, alignItems: "center" }}>
        <Icon name="pin" size={34} color={p.green} />
      </View>
    </View>
  );
}
