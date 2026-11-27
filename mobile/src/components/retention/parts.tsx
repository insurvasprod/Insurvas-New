import { Pressable, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/icon";
import { F } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * Board pieces the Retention screens draw that the shared kit does not, measured from kit.css: the outcome
 * grid (.outc: two to a row, 54px, 12px corners, an odd last tile spanning both, the .w2 of F3d and F5) and the
 * steps card (F4: a tick for a done step, a clock for one still to do, 15px, 10px apart).
 */
export function ChoiceTiles({ items, value, onPick, disabled, testID }: { items: { key: string; label: string; icon: IconName }[]; value: string | null; onPick: (key: string) => void; disabled?: boolean; testID?: string }) {
  const p = usePalette();
  const tile = (o: { key: string; label: string; icon: IconName }) => {
    const on = o.key === value;
    return (
      <Pressable key={o.key} testID={testID ? `${testID}-${o.key}` : undefined} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={() => onPick(o.key)}
        style={({ pressed }) => ({ flex: 1, height: 54, borderRadius: 12, borderWidth: 1, borderColor: on ? p.green : p.line, backgroundColor: on ? p.greenSoft : pressed ? p.surf2 : p.surf, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 })}>
        <Icon name={o.icon} size={20} color={p.greenInk} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.s, fontSize: 15, color: p.ink }}>{o.label}</Text>
      </Pressable>
    );
  };
  const rows: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return <View style={{ gap: 8 }}>{rows.map((r) => <View key={r[0].key} style={{ flexDirection: "row", gap: 8 }}>{r.map(tile)}</View>)}</View>;
}

export function StepsList({ steps }: { steps: { key: string; title: string; done: boolean; sub?: string }[] }) {
  const p = usePalette();
  return (
    <View style={{ gap: 10, marginTop: 10 }}>
      {steps.map((s) => (
        <View key={s.key} testID={`step-${s.key}`} accessibilityLabel={`${s.title}${s.done ? ", done" : ""}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <View style={{ marginTop: 1 }}><Icon name={s.done ? "checkC" : "clock"} size={18} color={s.done ? p.ok : p.faint} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: s.done ? p.ink : p.body }}>{s.title}</Text>
            {s.sub ? <Text style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{s.sub}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}
