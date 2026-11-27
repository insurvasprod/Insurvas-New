import { Text, View } from "react-native";

import { Chip, F, IOS, Row } from "@/components/ui";
import { displayName } from "@/lib/format";
import { usePalette } from "@/theme/use-palette";

import { premium, statusWords } from "./logic";
import type { ApplicationRow } from "./types";

/** .btn.sm.tonal at 32px, drawn as the row's chip (the whole row is the button). */
function ResumePill() {
  const p = usePalette();
  return (
    <View style={{ height: 32, paddingHorizontal: 14, borderRadius: 10, backgroundColor: p.greenSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: F.s, fontSize: 14, letterSpacing: IOS ? 0 : 0.15, color: p.greenInk }}>Resume</Text>
    </View>
  );
}

/**
 * Board E0 · one application. A draft resumes where it stopped ("American Amicable · step 5 of 10 ·
 * Health", the tonal Resume); one marked ready waits on the client's signature (warn, Sign: the phone
 * signs on the glass); a submitted one shows where it stands and its premium. `step` is the draft's
 * place, read from its case; until it arrives the row says the carrier alone.
 */
export function ApplicationListRow({ row, first, step, onPress }: { row: ApplicationRow; first: boolean; step?: string | null; onPress: () => void }) {
  const carrier = row.carrierName ?? row.productLabel ?? "No carrier yet";
  const name = row.insuredRole === "spouse" ? `${displayName(row.clientName)} (spouse)` : displayName(row.clientName);
  if (row.status === "draft") {
    return <Row testID={`app-row-${row.applicationId}`} first={first} icon="filePen" title={name} meta={[carrier, step ?? null, row.attemptNo > 1 ? `attempt ${row.attemptNo}` : null].filter(Boolean).join(" · ")} chip={<ResumePill />} chevron={false} onPress={onPress} />;
  }
  if (row.status === "ready") {
    return <Row testID={`app-row-${row.applicationId}`} first={first} icon="pencil" iconTone="warn" title={name} meta={`${carrier} · ready to sign`} chip={<Chip tone="warn">Sign</Chip>} chevron={false} onPress={onPress} />;
  }
  const where = [row.carrierName ?? "No carrier yet", row.productLabel].filter(Boolean).join(" · ");
  return <Row testID={`app-row-${row.applicationId}`} first={first} icon="fileCheck" title={name} meta={`${where} · ${statusWords(row.status)}`} right={premium(row.monthlyPremiumCents)} onPress={onPress} />;
}
