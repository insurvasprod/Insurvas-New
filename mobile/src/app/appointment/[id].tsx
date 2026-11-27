import { useState } from "react";
import { Alert, Linking, Platform, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { addressLines, appointmentWhen, directionsUrl, setterLine } from "@/components/calendar/appointment";
import type { CalendarAppointment } from "@/components/calendar/month";
import { MapTile } from "@/components/calendar/parts";
import { Mini } from "@/components/calls/parts";
import { deviceZone } from "@/components/calls/time";
import { Button, Card, Empty, F, Failed, Header, Loading, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board C13b · Appointment: when (the customer's time and yours), who, who set it and what they
 * learned. Read from GET /api/app/calendar around the appointment's start (there is no one-appointment
 * read). The address is the customer's own, from the lead (an appointment has no place of its own);
 * Directions hands it to the phone's maps app. Start application is the web dialer's: the lead's work
 * item (GET /api/app/leads/:id) → POST /api/app/outbound/application, then the lead. The ⋯ menu opens
 * the lead and confirms a booked appointment (PATCH /api/app/appointments {action: "confirm"}).
 * The sub-line names the booker's role ("set by Lena Park (setter)", GET /api/app/calendar's
 * bookedByRole).
 *
 * Not here, because the server has none of it (2026-11-26): Running late (no route sends the customer
 * a note through the agency's number), the meeting method in the sub-line (an appointment stores no
 * method) and the drive time (no location or routing service).
 */
const STARTERS = ["owner", "producer"];

export default function AppointmentScreen() {
  const p = usePalette();
  const { api, me } = useSession();
  const { id, at } = useLocalSearchParams<{ id: string; at?: string }>();
  const zone = deviceZone();
  const [now] = useState(() => Date.now());
  const centre = at && Number.isFinite(Date.parse(at)) ? Date.parse(at) : now;
  const range = `from=${encodeURIComponent(new Date(centre - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(centre + 86_400_000).toISOString())}`;
  const load = useLoad(() => api<{ appointments: CalendarAppointment[] }>(`/api/app/calendar?${range}`), [range]);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const a = load.data?.appointments.find((x) => x.appointmentId === id) ?? null;

  async function confirm() {
    if (!a) return;
    setBusy(true);
    try {
      await api("/api/app/appointments", { method: "PATCH", body: { action: "confirm", appointment_id: a.appointmentId } });
      load.reload();
    } catch (e) {
      Alert.alert("Not confirmed", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startApplication() {
    if (!a?.leadId) return;
    setStarting(true);
    try {
      const lead = await api<{ queue: { id: string } | null; lead?: { product_line?: string | null } }>(`/api/app/leads/${a.leadId}`);
      if (!lead.queue?.id) throw new ApiError(409, { error: "This lead isn’t in the calling queue, so an application can’t be started from here. Open the lead." });
      await api("/api/app/outbound/application", { method: "POST", body: { work_item_id: lead.queue.id, ...(lead.lead?.product_line ? { product_line: lead.lead.product_line } : {}) } });
      router.push(`/lead/${a.leadId}` as never);
    } catch (e) {
      Alert.alert("Not started", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setStarting(false);
    }
  }

  function menu() {
    if (!a) return;
    const options: { text: string; onPress?: () => void; style?: "cancel" }[] = [];
    if (a.leadId) options.push({ text: "Open the lead", onPress: () => router.push(`/lead/${a.leadId}` as never) });
    if (a.status === "booked" && Date.parse(a.startsAtUtc) > now) options.push({ text: "Mark as confirmed", onPress: () => void confirm() });
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(a.customerName, undefined, options);
  }

  const header = (
    <Header back="Calendar" onBack={() => (router.canGoBack() ? router.back() : router.replace("/calendar" as never))} large={false}
      actions={a && !busy ? [{ icon: "moreH", label: "More", onPress: menu }] : []} />
  );

  if (load.loading && !load.data) return <Screen header={header}><Loading rows={3} /></Screen>;
  if (load.error && !load.data) return <Screen header={header}><Failed message={load.error} onRetry={load.reload} /></Screen>;
  if (!a) return <Screen header={header}><Empty icon="calendar" title="This appointment isn’t on your calendar" body="It may have been moved or cancelled." /></Screen>;

  const who = setterLine(a, me?.user.id ?? null);
  const address = addressLines(a.customerAddress ?? null);
  const setBySomeoneElse = Boolean(a.bookedByUserId && a.bookedByUserId !== a.agentUserId && a.bookedByName);
  const canStart = Boolean(a.leadId) && STARTERS.includes(me?.role ?? "");
  return (
    <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>
      <View style={{ paddingHorizontal: 16, gap: 14 }} testID="appointment">
        <View>
          <Mini>{appointmentWhen(a, zone)}</Mini>
          <Text style={{ fontFamily: F.db, fontSize: 28, lineHeight: 34, letterSpacing: -0.56, color: p.ink }}>{a.customerName}</Text>
          {who ? <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 20, color: p.muted }}>{who}</Text> : null}
        </View>
        {address ? (
          <Card pad={false} style={{ overflow: "hidden" }}>
            <MapTile />
            <View style={{ paddingVertical: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{address.first}</Text>
                {address.second ? <Mini>{address.second}</Mini> : null}
              </View>
              <Button testID="appointment-directions" small kind="tonal" label="Directions" icon="nav"
                onPress={() => { void Linking.openURL(directionsUrl(address.query, Platform.OS)).catch(() => Alert.alert("No maps app", "Install a maps app to get directions.")); }} />
            </View>
          </Card>
        ) : null}
        {a.notes ? (
          <Card>
            <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{setBySomeoneElse ? "From the setter" : "Notes"}</Text>
            <Text selectable style={{ marginTop: 6, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>{`“${a.notes}”`}</Text>
          </Card>
        ) : null}
        {canStart ? <Button write testID="appointment-start-application" label="Start application" icon="filePen" busy={starting} onPress={() => void startApplication()} /> : null}
      </View>
    </Screen>
  );
}
