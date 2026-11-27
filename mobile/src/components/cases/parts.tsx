import { Image, Pressable, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { Button, Card, Chip, F, Group, IOS, Row } from "@/components/ui";
import { CardTitle } from "@/components/leads/parts";
import { usePalette } from "@/theme/use-palette";

import { KIND_TITLE, requirementMeta, takesDocument, waitingChip, type CaseRequirement, type CaseRowModel } from "./model";

/**
 * The parts the case screens draw that the shared kit does not: the case list rows, the requirement
 * card with its fastest fix (E6), and a scanned page (E6b). Measured from the board's kit.css.
 */

/** A grouped list of cases: the action icon in its tone, name, one fact, one chip. */
export function CaseRows({ rows, onOpen }: { rows: CaseRowModel[]; onOpen: (caseId: string, requirementId?: string) => void }) {
  return (
    <Group>
      {rows.map((r, i) => (
        <Row key={r.key} testID={`case-row-${r.key}`} first={i === 0} icon={r.icon} iconTone={r.tone} title={r.title} meta={r.meta}
          chip={<Chip tone={r.tone}>{r.chip}</Chip>} onPress={() => onOpen(r.caseId, r.requirementId)} />
      ))}
    </Group>
  );
}

/**
 * One thing the carrier is waiting for (.card.p): what it is, who it waits on, when it was asked, and the
 * fastest fix. A page the carrier wants gets the camera; a requirement on the client gets a call.
 */
export function RequirementCard({ r, highlighted, onScan, onCall, callLabel }: {
  r: CaseRequirement; highlighted?: boolean; onScan: () => void; onCall?: () => void; callLabel?: string;
}) {
  const p = usePalette();
  const chip = waitingChip(r);
  const scan = takesDocument(r.kind) && r.waitingOn !== "carrier";
  const call = r.waitingOn === "client" && onCall;
  const meta = requirementMeta(r);
  return (
    <Card style={highlighted ? { borderColor: p.line2 } : undefined}>
      <View testID={`requirement-${r.id}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1 }}><CardTitle>{KIND_TITLE[r.kind] ?? "Carrier request"}</CardTitle></View>
        <Chip tone={chip.tone}>{chip.text}</Chip>
      </View>
      {/* What the carrier wants in the body size, then when it was asked and how long ago, quieter. */}
      {r.description.trim() ? <Text style={{ marginTop: 4, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink }}>{r.description.trim()}</Text> : null}
      <Text style={{ marginTop: 2, fontFamily: F.r, fontSize: 13, lineHeight: 18, color: meta.includes("past the carrier") ? p.bad : p.muted }}>{meta}</Text>
      {scan || call ? (
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          {scan ? <Button small kind="primary" icon="camera" label="Scan a document" onPress={onScan} style={{ flex: 1, alignSelf: "stretch" }} testID={`scan-${r.id}`} /> : null}
          {call ? <Button small kind="outline" icon="phone" label={callLabel ?? "Call the client"} onPress={onCall} style={{ flex: 1, alignSelf: "stretch" }} testID={`call-${r.id}`} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

/** A scanned page: the photo at 110×150 with its place in the order in the corner. */
export function PageThumb({ uri, n, onPress }: { uri: string; n: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Page ${n}`} onPress={onPress} testID={`page-${n}`}
      style={{ width: 110, height: 150, borderRadius: 10, overflow: "hidden", backgroundColor: "#e9ece6" }}>
      <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      <View style={{ position: "absolute", right: 6, bottom: 6, backgroundColor: "#0d4037", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
        <Text style={{ fontFamily: F.s, fontSize: 10, color: "#ffffff" }}>{n}</Text>
      </View>
    </Pressable>
  );
}

/**
 * .fld that opens a picker, on the screen's own background (the leads SelectField sits on a sheet, so its
 * Android floating label would paint the sheet colour over the canvas). The value may wrap to two lines.
 */
export function CanvasSelect({ label, value, onPress, testID }: { label: string; value: string; onPress: () => void; testID?: string }) {
  const p = usePalette();
  const box = (
    <View style={{ minHeight: IOS ? 50 : 56, borderRadius: IOS ? 12 : 8, backgroundColor: IOS ? p.field : "transparent", borderWidth: 1, borderColor: p.line2, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 }}>
      <Text numberOfLines={2} style={{ flex: 1, paddingVertical: 10, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.ink }}>{value}</Text>
      <Icon name="chevD" size={18} color={p.muted} />
    </View>
  );
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress}>
      {IOS ? <View style={{ gap: 6 }}><Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{label}</Text>{box}</View> : (
        <View style={{ marginTop: 8 }}>
          {box}
          <Text style={{ position: "absolute", top: -8, left: 12, paddingHorizontal: 4, backgroundColor: p.canvas, fontFamily: F.m, fontSize: 12, color: p.muted }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** The dashed tile after the pages: one more page. */
export function AddPage({ onPress }: { onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Add a page" onPress={onPress} testID="add-page"
      style={{ width: 110, height: 150, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", borderColor: p.line2, alignItems: "center", justifyContent: "center" }}>
      <Icon name="plus" size={24} color={p.muted} />
    </Pressable>
  );
}
