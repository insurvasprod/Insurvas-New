import { View } from "react-native";

import { clock } from "@/components/calls/time";
import { Chip, IOS, Row } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";
import { itemMeta, type CalItem } from "./month";

/**
 * Board C13 · the chosen day's list: one row per callback or appointment, "9:30 · Maria Alvarez" in
 * the viewer's clock, the customer's clock in the meta line, and one chip when something is late.
 * A grouped list under the day's .mini line (k.group with no title).
 */
export function CalendarDay({ items, zone, viewerId, onOpen }: { items: CalItem[]; zone: string; viewerId: string | null; onOpen: (it: CalItem) => void }) {
  const p = usePalette();
  if (!items.length) return null;
  return (
    <View testID="calendar-day" style={IOS ? { marginHorizontal: 16, backgroundColor: p.surf, borderRadius: 14, borderWidth: 1, borderColor: p.line, overflow: "hidden" } : null}>
      {items.map((it, i) => (
        <Row key={`${it.kind}-${it.id}`} testID={`calendar-row-${it.id}`} first={i === 0}
          icon={it.kind === "callback" ? "calCheck" : "calendar"}
          iconTone={it.tone === "late" ? "warn" : it.tone === "done" ? "ok" : it.kind === "appointment" ? "info" : "brand"}
          title={`${clock(it.at, zone, false)} · ${it.customerName}`}
          meta={itemMeta(it, zone, viewerId)}
          chip={it.chip ? <Chip tone="warn">{it.chip}</Chip> : undefined}
          onPress={() => onOpen(it)} />
      ))}
    </View>
  );
}
