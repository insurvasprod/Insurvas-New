import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { SheetModal } from "@/components/calls/parts";
import { Button, Card, F } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { checkTicks, mss, waitingLine } from "./model";
import { H4, TickRow } from "./parts";
import type { CallerExtras, InboxItem, Screening } from "./types";

export type WaitingRow = { id: string; customer: string; age?: string | null; productLine: string | null; partnerName: string | null; state: string | null; waitSeconds: number };

/**
 * Board C1b · Transfer details: Details on a waiting caller. Three ticks, as drawn: Do Not Call (GET
 * /api/app/inbound/screening), the consent proof, and the duplicate check naming the earlier lead the
 * server matched (GET /api/app/inbound/caller); then the partner's own note on the lead under "From
 * <partner>", and the link to the lead. Claim here is the same race-safe claim.
 */
export function TransferDetails({ item, wait, readOnly, busy, onClaim, onClose }: { item: WaitingRow; wait: number; readOnly: boolean; busy: boolean; onClaim: () => void; onClose: () => void }) {
  const p = usePalette();
  const { api } = useSession();
  const q = encodeURIComponent(item.id);
  const screening = useLoad(() => api<Screening>(`/api/app/inbound/screening?work_item_id=${q}`), [item.id]);
  const inbox = useLoad(() => api<{ items: InboxItem[] }>("/api/app/inbound?status=unclaimed").then((d) => d.items.find((i) => i.id === item.id) ?? null).catch(() => null), [item.id]);
  const caller = useLoad(() => api<CallerExtras>(`/api/app/inbound/caller?work_item_id=${q}`).catch(() => null), [item.id]);
  const [now] = useState(() => Date.now());

  const row = inbox.data ?? null;
  // The board's three ticks: no existing-client line here (that check is on Caller profile, C3).
  const ticks = checkTicks(screening.data, undefined, now, caller.data ? { consent: caller.data.consent, duplicate: caller.data.duplicate } : null);
  const leadId = row?.leadId ?? caller.data?.leadId ?? null;
  const note = caller.data?.partnerNote ?? null;
  const partner = item.partnerName ?? row?.partnerName ?? null;
  const line = waitingLine({ age: item.age ?? row?.age, state: item.state, productLine: item.productLine });

  return (
    <SheetModal visible title={item.customer} onClose={onClose}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.r, fontSize: 16, color: p.muted }}>{line}</Text>
          <Text style={{ fontFamily: F.db, fontSize: 20, letterSpacing: -0.4, color: p.ink, fontVariant: ["tabular-nums"] }}>{mss(wait)}</Text>
        </View>
        {ticks.length ? (
          <Card style={{ gap: 10 }}>
            {ticks.map((t) => <TickRow key={t.key} tick={t} />)}
          </Card>
        ) : null}
        {note ? (
          <Card>
            <H4>{partner ? `From ${partner}` : "From the partner"}</H4>
            <Text testID="details-partner-note" style={{ marginTop: 6, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink }}>{`“${note}”`}</Text>
          </Card>
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button testID="details-open-lead" kind="outline" label="Open the lead" icon="user" disabled={!leadId} onPress={() => { if (leadId) { onClose(); router.push(`/lead/${leadId}`); } }} style={{ flex: 1 }} />
          {!readOnly ? <Button write testID="details-claim" label="Claim" icon="phoneIn" busy={busy} disabled={busy} onPress={onClaim} style={{ flex: 1 }} /> : null}
        </View>
      </View>
    </SheetModal>
  );
}
