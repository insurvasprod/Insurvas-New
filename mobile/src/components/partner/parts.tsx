import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Avatar, Chip, F, Row } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

import { initials, leadChip, liveMeta } from "./logic";
import type { PartnerLeadRow } from "./types";

/** Two tiles side by side (.tiles: a 2-column grid, 10px apart, 16px in from the edges). */
export function TileRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 10 }}>{children}</View>;
}
export function Cell({ children }: { children?: ReactNode }) {
  return <View style={{ flex: 1, minWidth: 0 }}>{children}</View>;
}

/** "↑ 38 vs October": a rise in gold, a fall plain (colour only for the good news, as the board draws it). */
export function Rise({ by, against }: { by: number; against: string }) {
  const p = usePalette();
  if (by === 0) return <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{`Same as ${against}`}</Text>;
  return (
    <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>
      <Text style={{ fontFamily: F.s, color: by > 0 ? p.goldInk : p.muted }}>{by > 0 ? `↑ ${by.toLocaleString()}` : `↓ ${Math.abs(by).toLocaleString()}`}</Text>
      {` vs ${against}`}
    </Text>
  );
}

/** The signed-in person's initials in the header (.av.sm: 26px, gold). */
export function HeaderAvatar({ name }: { name: string | null | undefined }) {
  return <View style={{ marginRight: 8 }}><Avatar initials={initials(name)} size={26} /></View>;
}

/** A lead the partner sent: name, its live line (liveMeta), and one chip in the partner's own stage words. */
export function LeadRow({ row, first, onPress, where = "pipeline" }: { row: PartnerLeadRow; first?: boolean; onPress: () => void; where?: "home" | "pipeline" }) {
  const chip = leadChip(row);
  return <Row testID={`lead-${row.id}`} first={first} icon="user" iconTone="plain" title={row.customer} meta={liveMeta(row, where)} chip={<Chip tone={chip.tone}>{chip.label}</Chip>} onPress={onPress} chevron={false} />;
}
