import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { CallbackPicker } from "./callback-picker";
import { Mini, SheetModal, Timeline } from "./parts";
import { afterBooking } from "./reminder";
import { addDays, clock, dayKey, dayLabel, lateLabel, zonedLocalToUtc, zoneLong, zoneShort } from "./time";
import { Button, Card, Chip, F } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { callbackOpen, codeLabel, firstName } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { CallbackView } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board C12 · Callback detail, a sheet over Calls. Complete is the primary outcome, Reschedule is
 * outline (the C9 picker, checked against the calling window by the server), Cancel is a quiet red
 * link that asks first. Call goes through the dialer's checks (the call sheet), never a tel: link.
 * Everything here is PATCH /api/app/callbacks {action, callback_id, callback_local?}.
 */
type HistoryRow = { id: string; action: string; createdAt: string; actorName: string; note: string | null };
/** GET /api/app/callbacks?callback_id=&include_history=true `leadHistory` (2026-11-26, additive). */
type LeadHistory = { city: string | null; arrivedAt: string | null; vendorName: string | null; calls: { id: string; at: string; disposition: string | null; outcome: string | null; byYou: boolean }[] };
type Detail = { callbacks: (CallbackView & { history?: HistoryRow[] })[]; leadHistory?: LeadHistory };
type Event = { key: string; at: number; title: string; detail: string };

/**
 * Board C12's History: the callback's own events, the lead's calls with their outcome, and the lead's
 * arrival, newest first. A call carries no length: there is no phone provider to time it.
 */
export function callbackTimeline(history: HistoryRow[], lead: LeadHistory | undefined, viewerZone: string, viewerName: string | null): Event[] {
  const day = (iso: string) => dayLabel(dayKey(new Date(iso), viewerZone));
  const out: Event[] = history.map((h) => ({
    key: `h-${h.id}`, at: Date.parse(h.createdAt),
    title: `${ACTIONS[h.action] ?? codeLabel(h.action) ?? h.action}${h.actorName && h.actorName !== "System" ? ` by ${viewerName && h.actorName === viewerName ? "you" : h.actorName}` : ""}`,
    detail: `${day(h.createdAt)}${h.note ? ` · “${h.note}”` : ""}`,
  }));
  for (const c of lead?.calls ?? []) {
    if (!Number.isFinite(Date.parse(c.at))) continue;
    out.push({ key: `c-${c.id}`, at: Date.parse(c.at), title: c.byYou ? "Call by you" : "Call", detail: [day(c.at), c.outcome ?? codeLabel(c.disposition)].filter(Boolean).join(" · ") });
  }
  if (lead?.arrivedAt && Number.isFinite(Date.parse(lead.arrivedAt))) {
    out.push({ key: "arrived", at: Date.parse(lead.arrivedAt), title: lead.vendorName ? `Lead arrived from ${lead.vendorName}` : "Lead arrived", detail: day(lead.arrivedAt) });
  }
  return out.sort((a, b) => b.at - a.at);
}

const ACTIONS: Record<string, string> = {
  created: "Callback set", booked: "Callback set", scheduled: "Callback set", rescheduled: "Rescheduled", completed: "Completed",
  cancelled: "Cancelled", canceled: "Cancelled", missed: "Missed", reassigned: "Handed over", handed_over: "Handed over", released: "Released to the team", reopened: "Reopened",
};

export function CallbackDetail({ callback, viewerZone, canDial, onClose, onChanged, onCall }: {
  callback: CallbackView; viewerZone: string; canDial: boolean; onClose: () => void; onChanged: () => void; onCall: (leadId: string) => void;
}) {
  const p = usePalette();
  const { api, me } = useSession();
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const detail = useLoad(() => api<Detail>(`/api/app/callbacks?callback_id=${callback.id}&include_history=true`), [callback.id]);
  const leadHistory = detail.data?.leadHistory;
  const events = callbackTimeline(detail.data?.callbacks[0]?.history ?? [], leadHistory, viewerZone, me?.user.name ?? null);
  // "Final expense · Miami, FL": the product, then the city when the lead has one, and the state.
  const place = [leadHistory?.city, callback.state].filter(Boolean).join(", ");

  const at = new Date(callback.scheduledAtUtc);
  const zone = callback.customerTimezone;
  const late = callback.isOverdue || callback.status === "missed";
  const open = callbackOpen(callback.status);
  const today = dayKey(new Date(now), zone ?? viewerZone);
  const day = dayKey(at, zone ?? viewerZone);
  const dayWord = day === today ? "today" : day === addDays(today, 1) ? "tomorrow" : dayLabel(day);
  const when = zone ? `${dayWord} ${clock(at, zone)} their time (${zoneLong(zone)})` : callback.customerTime ?? "";
  const line = late ? `Was ${when}` : when.charAt(0).toUpperCase() + when.slice(1);

  async function act(action: "complete" | "cancel" | "reschedule", local?: string, team = false, remind = false) {
    setBusy(action);
    try {
      await api("/api/app/callbacks", { method: "PATCH", body: local ? { action, callback_id: callback.id, callback_local: local } : { action, callback_id: callback.id } });
    } catch (e) {
      Alert.alert(action === "reschedule" ? "Not rescheduled" : action === "cancel" ? "Not cancelled" : "Not completed", e instanceof ApiError ? e.message : "Try again.");
      setBusy(null);
      return;
    }
    // The callback moved. The two switches come after (afterBooking never throws), and a failure there never says
    // it didn't move: it is rescheduled, with what didn't happen.
    const next = local && zone ? zonedLocalToUtc(local, zone) : null;
    const missed = next && zone
      ? await afterBooking(api, { leadId: callback.leadId, callbackId: callback.id, team, remind, at: next, customerName: callback.customerName, theirTime: `${clock(next, zone)} their time (${zoneShort(zone, next)})` })
      : [];
    setBusy(null);
    onChanged();
    onClose();
    if (missed.length) Alert.alert("Rescheduled", `The new time is saved: ${missed.join(" · ")}.`);
  }

  function confirmCancel() {
    Alert.alert("Cancel this callback?", `${callback.customerName} won’t be called back unless you book a new one.`, [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel callback", style: "destructive", onPress: () => void act("cancel") },
    ]);
  }

  if (mode === "reschedule" && zone) {
    return (
      <SheetModal visible title={`Call ${firstName(callback.customerName)} back`} onClose={() => setMode("view")}>
        <CallbackPicker zone={zone} state={callback.state} agentZone={viewerZone} busy={busy === "reschedule"} teamOption remindOption onSave={(local, o) => void act("reschedule", local, o.team, o.remind)} />
      </SheetModal>
    );
  }

  return (
    <SheetModal visible onClose={onClose}>
      <View style={{ gap: 14, paddingTop: 6 }}>
        <View>
          <Text style={{ fontFamily: F.db, fontSize: 26, lineHeight: 31, letterSpacing: -0.52, color: p.ink }}>{callback.customerName}</Text>
          {callback.productName || place ? <Text style={{ fontFamily: F.r, fontSize: 16, color: p.muted }}>{[callback.productName, place].filter(Boolean).join(" · ")}</Text> : null}
        </View>

        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>Callback</Text>
            {late ? <Chip tone="warn">{lateLabel(now - at.getTime()).replace(/late$/, "overdue")}</Chip>
              : callback.status === "completed" ? <Chip tone="ok">Completed</Chip>
              : callback.status === "cancelled" ? <Chip>Cancelled</Chip>
              : callback.isDueToday ? <Chip tone="info">Today</Chip> : <Chip tone="info">Scheduled</Chip>}
          </View>
          <Text style={{ fontFamily: F.r, fontSize: 16, color: p.ink, marginTop: 4 }}>{line}</Text>
          <Mini>{`${clock(at, viewerZone)} your time (${zoneLong(viewerZone)})`}</Mini>
        </Card>

        <View style={{ flexDirection: "row", gap: 10 }}>
          {canDial && open ? <Button testID="callback-call" label="Call" icon="phone" onPress={() => { onClose(); setTimeout(() => onCall(callback.leadId), 350); /* after this sheet has gone: iOS presents one modal at a time */ }} style={{ flex: 1 }} /> : null}
          <Button testID="callback-lead" kind="outline" label="Lead" icon="user" onPress={() => { onClose(); router.push(`/lead/${callback.leadId}`); }} style={{ flex: 1 }} />
        </View>

        {events.length ? (
          <Card>
            <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>History</Text>
            <View style={{ marginTop: 10 }}>
              <Timeline events={events} />
            </View>
          </Card>
        ) : null}

        {open ? (
          <>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {zone ? <Button testID="callback-reschedule" kind="outline" label="Reschedule" icon="calendar" disabled={Boolean(busy)} onPress={() => setMode("reschedule")} style={{ flex: 1 }} /> : null}
              <Button write testID="callback-complete" label="Complete" icon="check" busy={busy === "complete"} disabled={Boolean(busy)} onPress={() => void act("complete")} style={{ flex: 1 }} />
            </View>
            <Pressable testID="callback-cancel" accessibilityRole="button" onPress={confirmCancel} disabled={Boolean(busy)} hitSlop={8} style={{ alignSelf: "center", padding: 4 }}>
              <Text style={{ fontFamily: F.s, fontSize: 15, color: p.bad }}>Cancel this callback</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </SheetModal>
  );
}
