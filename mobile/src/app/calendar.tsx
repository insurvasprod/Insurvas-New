import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { CallSheet } from "@/components/call-sheet";
import { CallbackDetail } from "@/components/calls/callback-detail";
import { Mini, Snack } from "@/components/calls/parts";
import { ScheduleCallback } from "@/components/calls/schedule-callback";
import { dayKey, deviceZone } from "@/components/calls/time";
import { CalendarDay } from "@/components/calendar/day";
import { calendarItems, dotsByDay, longDay, monthGrid, monthRange, monthTitle, type CalendarAppointment, type CalItem } from "@/components/calendar/month";
import { MonthGrid } from "@/components/calendar/parts";
import { Empty, Failed, Header, IOS, Loading, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { currentTabs, reachable } from "@/lib/links";
import { callsPartsFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import type { CallbacksAnswer, CallbackView } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board C13 · Calendar: the month on top, the chosen day below, callbacks and appointments together
 * (the web Calendar). Appointments are GET /api/app/calendar (31 days at most, so one month at a time);
 * callbacks are GET /api/app/callbacks with the same range, for the roles that have them (a setter
 * does not, so their calendar is appointments only). A day outside the month opens that month.
 */
type CallbacksData = CallbacksAnswer & { viewerTimezone?: string | null };

export default function CalendarScreen() {
  const p = usePalette();
  const { api, me } = useSession();
  // The agent's own saved zone once the callbacks read says it (as Calls › Callbacks and every picker use it),
  // so a callback reads the same time here as on the list; the phone's zone until then or with none saved.
  const [savedZone, setSavedZone] = useState<string | null>(null);
  const zone = savedZone || deviceZone();
  const [now] = useState(() => Date.now());
  const today = dayKey(new Date(now), zone);
  const [pickedRaw, setPicked] = useState<string | null>(null);
  const picked = pickedRaw ?? today;
  const year = Number(picked.slice(0, 4));
  const month = Number(picked.slice(5, 7));
  const { from, to } = monthRange(year, month, zone);
  const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const withCallbacks = callsPartsFor(me?.memberRole ?? me?.role, me?.plan?.features).includes("callbacks");

  const appointments = useLoad(() => api<{ appointments: CalendarAppointment[] }>(`/api/app/calendar?${range}`), [range]);
  const callbacks = useLoad(() => (withCallbacks
    ? api<CallbacksData>(`/api/app/callbacks?${range}`).catch((e: unknown) => {
      // A role the callbacks calendar is not for (the server's gate) sees appointments only.
      if (e instanceof ApiError && e.status === 403) return null;
      throw e;
    })
    : Promise.resolve(null)), [range, withCallbacks]);
  const viewerTimezone = callbacks.data?.viewerTimezone ?? null;
  // Taken during render (React's "adjust state when a prop changes"); the range then reads once more in that zone.
  if (viewerTimezone && viewerTimezone !== savedZone) setSavedZone(viewerTimezone);
  const [open, setOpen] = useState<CallbackView | null>(null);
  const [calling, setCalling] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);
  // Board C13's bar: search (B4, the web's search) and + (C9, a callback for any lead) for the roles that book them.
  const canSchedule = withCallbacks && ["owner", "producer", "assistant"].includes(me?.role ?? "");

  const items = calendarItems(callbacks.data?.callbacks ?? [], appointments.data?.appointments ?? [], zone, now);
  const dots = dotsByDay(items);
  const day = items.filter((it) => it.day === picked);
  const viewer = me?.user.id ?? null;
  const loading = (appointments.loading && !appointments.data) || (callbacks.loading && !callbacks.data && !callbacks.error);
  const failed = (appointments.error && !appointments.data) ? appointments : (callbacks.error && !callbacks.data) ? callbacks : null;

  function openItem(it: CalItem) {
    if (it.callback) setOpen(it.callback);
    else if (it.appointment) router.push({ pathname: "/appointment/[id]", params: { id: it.id, at: it.appointment.startsAtUtc } } as never);
  }

  const header = (
    <Header title={monthTitle(year, month)} back="Calls" onBack={() => (router.canGoBack() ? router.back() : router.replace(reachable("/calls?part=callbacks", currentTabs()) as never))} large
      actions={[{ icon: "search", label: "Search", onPress: () => router.push("/search" as never) }, ...(canSchedule ? [{ icon: "plus" as const, label: "Schedule a callback", onPress: () => setScheduling(true) }] : [])]} />
  );

  if (appointments.errorCode?.status === 403 && !appointments.data) {
    return <Screen header={header}><Empty icon="lock" title="The calendar isn’t on for you" body="Your agency’s plan or your role doesn’t include the calendar." /></Screen>;
  }

  return (
    <View style={{ flex: 1 }}>
    <Screen header={header} onRefresh={() => { appointments.refresh(); callbacks.reload(); }} refreshing={appointments.refreshing}>
      <View style={{ marginTop: IOS ? 0 : 4 }}>
        <MonthGrid cells={monthGrid(year, month)} value={picked} today={today} dots={dots} onPick={(c) => setPicked(c.key)} />
      </View>
      <View style={{ height: 1, backgroundColor: p.line, marginVertical: 14, marginHorizontal: 16 }} />
      {loading ? <Loading rows={3} /> : failed ? <Failed message={failed.error ?? "Couldn’t load the calendar."} onRetry={failed.reload} /> : (
        <>
          <Mini style={{ paddingHorizontal: 16, marginBottom: 6 }}>{`${longDay(picked)} · ${day.length ? `${day.length} ${day.length === 1 ? "thing" : "things"}` : "nothing booked"}`}</Mini>
          <CalendarDay items={day} zone={zone} viewerId={viewer} onOpen={openItem} />
        </>
      )}
      {open ? (
        <CallbackDetail callback={open} viewerZone={callbacks.data?.viewerTimezone || zone} canDial={callsPartsFor(me?.role, me?.plan?.features).includes("dialer")} onClose={() => setOpen(null)}
          onChanged={() => callbacks.reload()} onCall={(leadId) => { setOpen(null); setCalling(leadId); }} />
      ) : null}
      {scheduling ? <ScheduleCallback onClose={() => setScheduling(false)} onSaved={(m) => { setToast(m); callbacks.reload(); }} /> : null}
      {calling ? <CallSheet leadId={calling} visible backLabel="Calendar" onClose={() => setCalling(null)} onSaved={() => { callbacks.reload(); appointments.reload(); }} /> : null}
    </Screen>
    {toast ? <Snack text={toast} /> : null}
    </View>
  );
}
