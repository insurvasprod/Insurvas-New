import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/icon";
import { Button, Card, Chip, F } from "@/components/ui";
import { Mini } from "@/components/calls/parts";
import { clock, deviceZone, zoneShort } from "@/components/calls/time";
import { codeLabel, phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { toneColors } from "@/theme/tokens";
import { complianceChecks, headTicks, windowChip, type CheckPanel, type Tick } from "./checks";

/**
 * Board C7 · the current lead, opened in place at the head of the list. Everything on it is read:
 * the queue row (name, state, attempts, campaign, phone) and, for this one lead, the dialer panel
 * (GET /api/app/dialer/panel — read-only, it serves and locks nothing): age, city, product, vendor,
 * the calling window and the checks the five ticks fold. Call still goes through the server's pick,
 * attempt and click; the ticks never decide a dial.
 */
export type QueueRow = {
  workItemId: string; leadId: string; tier: number; tierName: string; name: string | null; state: string | null; attemptsMade: number;
  localTime: string | null; campaignName: string | null; phone: string | null; timezone?: string | null; productLine?: string | null;
  /** GET /api/app/dialer/queue (2026-11-26, additive): the row's High / Medium / Low, by the filter's own tiers. */
  priority?: string | null;
  /** The campaign's lead type ("list" | "realtime" | "aged"), a recycle pass, and the open callback's time (UTC). */
  leadType?: string | null; recycled?: boolean; callbackAt?: string | null;
};

/** Board C7's chip on a row: a due callback is "Callback" (info); otherwise the server's priority (brand). */
export function rowChip(r: QueueRow): { tone: "info" | "brand"; label: string } | null {
  if (r.tierName === "callback") return { tone: "info", label: "Callback" };
  const label = r.priority ?? (r.tierName ? r.tierName.charAt(0).toUpperCase() + r.tierName.slice(1) : null);
  return label ? { tone: "brand", label } : null;
}

export type HeadPanel = CheckPanel & {
  lead: CheckPanel["lead"] & { id: string; fullName: string; phone: string | null; productCode: string | null; age?: string | number | null; workItemId?: string | null };
  campaign?: { name: string | null; vendorName: string | null; leadType: string | null } | null;
  viewerTimezone?: string | null;
};

/** "64 yrs · Houston, TX · Term life" — only what the lead holds. */
export function headLine(panel: HeadPanel | null, row: QueueRow): string {
  const age = panel?.lead.age != null && String(panel.lead.age).trim() ? `${String(panel.lead.age).trim()} yrs` : null;
  const state = panel?.lead.state ?? row.state;
  const place = [panel?.lead.city || null, state].filter(Boolean).join(", ") || null;
  const product = codeLabel(panel?.lead.productCode ?? row.productLine ?? null);
  return [age, place, product].filter(Boolean).join(" · ");
}

export function TickChip({ tick }: { tick: Tick }) {
  const p = usePalette();
  const c = toneColors(p, tick.state === "ok" ? "ok" : tick.state === "bad" ? "bad" : "neutral");
  return (
    <View accessible accessibilityLabel={tick.label} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 9, borderRadius: 7, backgroundColor: c.bg }}>
      <Icon name={tick.state === "ok" ? "check" : tick.state === "bad" ? "x" : "clock"} size={14} color={c.fg} />
      <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 12.5, color: c.fg }}>{tick.label}</Text>
    </View>
  );
}

export function HeadCard({ row, position, total, busy, onSkip, onCall, onDetails }: {
  row: QueueRow; position: number; total: number; busy: boolean; onSkip: () => void; onCall: () => void;
  /** C7b: the checks sheet for this lead, from the same panel. */
  onDetails: (panel: HeadPanel) => void;
}) {
  const p = usePalette();
  const { api } = useSession();
  const loaded = useLoad(() => api<HeadPanel>(`/api/app/dialer/panel?lead_id=${row.leadId}`), [row.leadId]);
  // The last lead's panel stays in the hook while this one loads; never show it on this lead.
  const panel = loaded.data && loaded.data.lead.id === row.leadId ? loaded.data : null;
  const [now] = useState(() => Date.now());
  const at = new Date(now);
  const zone = panel?.window?.zone ?? panel?.eligibility?.timezone ?? row.timezone ?? null;
  const chip = panel ? windowChip(panel.window, zone ? zoneShort(zone, at) : null) : null;
  const shown = chip ?? rowChip(row);
  const ticks = panel ? headTicks(complianceChecks(panel, at, panel.viewerTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")) : [];
  const line = headLine(panel, row);
  const phone = phoneLabel(panel?.lead.phone ?? row.phone) ?? row.phone;
  const facts: [string | null, IconName][] = [
    [panel?.campaign?.vendorName ?? null, "package"],
    [panel?.campaign?.name ?? row.campaignName, "target"],
    [`Attempt ${(panel?.lead.attemptsMade ?? row.attemptsMade) + 1}`, "history"],
    [zone ? `${clock(at, zone)} their time` : null, "clock"],
  ];

  return (
    <Card style={{ borderColor: p.green }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Mini>{`Now · lead ${position.toLocaleString()} of ${total.toLocaleString()}`}</Mini>
          <Text numberOfLines={1} style={{ fontFamily: F.db, fontSize: 24, lineHeight: 29, letterSpacing: -0.48, color: p.ink }}>{panel?.lead.fullName || row.name || "Unnamed lead"}</Text>
          {line ? <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>{line}</Text> : null}
        </View>
        {shown ? <Chip tone={shown.tone}>{shown.label}</Chip> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 10, rowGap: 6, columnGap: 14 }}>
        {facts.filter(([t]) => t).map(([t, icon]) => (
          <View key={icon} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={icon} size={15} color={p.muted} />
            <Text style={{ fontFamily: F.r, fontSize: 13, color: p.muted }}>{t}</Text>
          </View>
        ))}
      </View>
      {ticks.length ? (
        <View testID="dialer-ticks" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {ticks.map((t) => <TickChip key={t.key} tick={t} />)}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
        <Mini style={{ flex: 1 }}>Server checks again just before dialing.</Mini>
        {panel ? (
          <Pressable testID="dialer-details" accessibilityRole="button" accessibilityLabel="Details" onPress={() => onDetails(panel)} hitSlop={8}>
            <Text style={{ fontFamily: F.s, fontSize: 14, color: p.greenInk }}>Details</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Button testID="dialer-skip" small kind="outline" label="Skip" icon="skip" onPress={onSkip} disabled={busy} style={{ flex: 1, alignSelf: "stretch", height: 44 }} />
        <Button testID="dialer-call" label={phone ? `Call ${phone}` : "Call"} icon="phone" onPress={onCall} busy={busy} disabled={busy} style={{ flex: 2.2, height: 44 }} />
      </View>
    </Card>
  );
}

/**
 * "Final expense · GA · attempt 1" (board C7's Up next): only what the queue row carries. A due callback
 * names its time instead, on the customer's clock ("Final expense · OH · callback 3:00").
 */
export function queueMeta(r: QueueRow): string {
  const at = r.tierName === "callback" && r.callbackAt ? new Date(r.callbackAt) : null;
  const tail = at && Number.isFinite(at.getTime()) ? `callback ${clock(at, r.timezone || deviceZone(), false)}` : `attempt ${r.attemptsMade + 1}`;
  return [codeLabel(r.productLine ?? null), r.state, tail].filter(Boolean).join(" · ");
}
