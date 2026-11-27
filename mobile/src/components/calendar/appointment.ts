import { clock, dayKey, dayLabel, zoneShort } from "@/components/calls/time";
import { setByWords, type CalendarAppointment } from "./month";

/** "2:00 – 3:00 pm", or "11:30 am – 12:30 pm" across noon. */
function span(start: Date, end: Date, zone: string): string {
  const a = clock(start, zone);
  const b = clock(end, zone);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

/**
 * Board C13b's line over the name: "Thu 26 Nov · 2:00 – 3:00 pm", in the customer's time with the
 * viewer's beside it when the two clocks differ ("· 1:00 – 2:00 pm yours").
 */
export function appointmentWhen(a: Pick<CalendarAppointment, "startsAtUtc" | "durationMinutes" | "customerTimezone">, viewerZone: string): string {
  const start = new Date(a.startsAtUtc);
  const end = new Date(start.getTime() + a.durationMinutes * 60_000);
  const cz = a.customerTimezone || viewerZone;
  const theirs = span(start, end, cz);
  const mine = span(start, end, viewerZone);
  const head = `${dayLabel(dayKey(start, cz))} · ${theirs}`;
  if (theirs === mine) return head;
  const sameDay = dayKey(start, cz) === dayKey(start, viewerZone);
  return `${head} ${zoneShort(cz, start)} · ${sameDay ? "" : `${dayLabel(dayKey(start, viewerZone))} `}${mine} yours`;
}

/** "Final expense · with Ava Kim · set by Lena Park (setter)": what it is for, whose diary, who booked it. */
export function setterLine(a: Pick<CalendarAppointment, "product" | "agentUserId" | "agentName" | "bookedByUserId" | "bookedByName" | "bookedByRole">, viewerId: string | null): string {
  const withWhom = viewerId && a.agentUserId !== viewerId ? `with ${a.agentName}` : null;
  return [a.product, withWhom, setByWords(a, viewerId)].filter(Boolean).join(" · ");
}

/** C11's row under an appointment: "Appointment · 10:00 am ET · set by Lena Park". */
export function appointmentMeta(a: Pick<CalendarAppointment, "startsAtUtc" | "customerTimezone" | "agentUserId" | "agentName" | "bookedByUserId" | "bookedByName" | "bookedByRole">, viewerId: string | null): string {
  const at = new Date(a.startsAtUtc);
  const zone = a.customerTimezone || null;
  return ["Appointment", zone ? `${clock(at, zone)} ${zoneShort(zone, at)}` : null, setterLine({ ...a, product: null }, viewerId) || null].filter(Boolean).join(" · ");
}

/** The customer's address as two lines (board C13b: "22 Abercorn St" / "Savannah, GA"), or null. */
export function addressLines(addr: CalendarAppointment["customerAddress"]): { first: string; second: string | null; query: string } | null {
  if (!addr || !(addr.street || addr.city)) return null;
  const place = [addr.city, [addr.state, addr.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const first = addr.street || place;
  const second = addr.street ? place || null : null;
  return { first, second, query: [addr.street, place].filter(Boolean).join(", ") };
}

/** The phone's own maps app with the address as the destination: any maps app on Android (geo:), Apple Maps on iOS. */
export function directionsUrl(query: string, os: string): string {
  const q = encodeURIComponent(query);
  return os === "android" ? `geo:0,0?q=${q}` : `http://maps.apple.com/?daddr=${q}`;
}
