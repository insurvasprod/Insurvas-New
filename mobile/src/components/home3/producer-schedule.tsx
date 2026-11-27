import { router } from "expo-router";

import { clock as zoneClock, deviceZone, zoneShort } from "@/components/calls/time";
import { clockShort } from "@/components/home/when";
import { Row } from "@/components/ui";

import { CallbackRow } from "./callback-row";
import type { ScheduleItem } from "./producer-logic";

/**
 * One row of board B1's Schedule. A callback draws as the shared callback row (overdue first, the customer's time
 * and the phone's). An appointment: the calendar icon in the info tone, "Appointment · 1:00 pm CT" in the
 * customer's clock, and the phone's time on the right; it opens the appointment, as the Calendar does.
 */
export function ScheduleRow({ item, first, viewer }: { item: ScheduleItem; first: boolean; viewer: string | undefined }) {
  if (item.kind === "callback") return <CallbackRow cb={item.callback} first={first} viewer={viewer} forOthers={false} />;
  const a = item.appointment;
  const at = new Date(a.startsAtUtc);
  const zone = a.customerTimezone || null;
  const theirs = zone && zone !== deviceZone() ? `${zoneClock(at, zone)} ${zoneShort(zone, at)}` : null;
  const meta = ["Appointment", theirs].filter(Boolean).join(" · ");
  return (
    <Row first={first} icon="calendar" iconTone="info" title={a.customerName} meta={meta} right={clockShort(at)} testID={`home-appointment-${a.appointmentId}`}
      onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: a.appointmentId, at: a.startsAtUtc } } as never)} />
  );
}
