import "server-only";

import { bookableContext } from "@/lib/appointments/booking";
import { appointmentsInRange } from "@/lib/appointments/calendar";
import { blockWhen, openSlots, slotsForDay, wallClock, zonedInstant, type Span } from "@/lib/appointments/calendarMath";
import { listCalendarConnections } from "@/lib/appointments/linkedCalendars";
import { customerClock, faceLabel, startsInLabel } from "@/lib/appointments/appointmentFacts";
import { getAgentSetterScorecard, getRoster, getScorecard } from "@/lib/setters/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TenantRole } from "@/lib/tenantAuth/roles";

import { dayView, repeatsOn, setterVerdict, type DayRow, type SetterVerdict } from "./dayView";

/**
 * Appointments & setters (p-app-setters) for one licensed agent: their day, the setters who book
 * into it, the availability those setters book against, and what reminders actually go out. Every
 * figure is read from the calendar, the scorecard view and the booking policy the rest of the
 * product already uses — this page only puts them side by side.
 */
export type SettersOverview = {
  bookable: boolean;
  zone: string;
  dateLabel: string;
  tiles: {
    bookedToday: number;
    nextAt: string | null;
    /** LA-2 §11 concept: today's appointments already closed out as shown, and as no-shows. */
    shownToday: number;
    noShowToday: number;
    openLeft: number;
    slotsToday: number;
    showedThisMonth: number;
    closedThisMonth: number;
    sold: number;
    showedForSold: number;
    doubleBookingAllowed: boolean;
    doubleBookings: number;
  };
  day: DayRow[];
  setters: Array<{ userId: string; name: string; place: string | null; dials: number; contacts: number; booked: number; showed: number; noShow: number; showRatePct: number | null; sold: number; verdict: SetterVerdict }>;
  /**
   * "calendar": only the setters booking into this agent's calendar (20260925704300, decided
   * 2026-09-25). "agency": the function is not in the database yet, so the agency-wide scorecard
   * the page used before is shown, scoped by permission as it always was.
   */
  scorecardScope: "calendar" | "agency";
  availability: { hours: string; hoursNote: string; lengthMinutes: number; bufferMinutes: number; blocks: string[]; linkedCalendar: boolean };
};

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function clock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** "Mon–Fri 9:00 am – 5:00 pm" — the working week in as few words as it will go. */
function hoursSummary(hours: Span[]) {
  if (!hours.length) return "No working hours set";
  const byRange = new Map<string, number[]>();
  for (const span of hours) {
    const key = `${span.startTime.slice(0, 5)}-${span.endTime.slice(0, 5)}`;
    byRange.set(key, [...(byRange.get(key) ?? []), span.weekday]);
  }
  return [...byRange].map(([range, days]) => {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    const run = sorted.length > 2 && sorted.every((day, i) => i === 0 || day === sorted[i - 1] + 1);
    const label = run ? `${DAY_SHORT[sorted[0]]}–${DAY_SHORT[sorted.at(-1)!]}` : sorted.map((day) => DAY_SHORT[day]).join(", ");
    const [from, to] = range.split("-").map((hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; });
    return `${label} ${clock(from)} – ${clock(to)}`;
  }).join("; ");
}

export async function getSettersOverview(input: { tenantId: string; userId: string; role: TenantRole; now?: number }): Promise<SettersOverview> {
  const now = input.now ?? Date.now();
  const context = await bookableContext(input.tenantId);
  const hoursRows = context.availability.filter((row) => row.userId === input.userId);
  const zone = hoursRows[0]?.timezone ?? context.agents.find((agent) => agent.userId === input.userId)?.timezone ?? "UTC";
  const today = wallClock(new Date(now).toISOString(), zone);
  const dayStart = zonedInstant(today.year, today.month, today.day, 0, zone);
  const dayEnd = dayStart + 86_400_000;
  const monthStart = zonedInstant(today.year, today.month, 1, 0, zone);

  const [appointments, agentScorecard, roster, connections] = await Promise.all([
    appointmentsInRange(input.tenantId, new Date(monthStart).toISOString(), new Date(dayEnd).toISOString()),
    getAgentSetterScorecard(input.tenantId, input.userId, 30).catch(() => null),
    getRoster(input.tenantId).catch(() => []),
    listCalendarConnections(input.tenantId).catch(() => ({ available: false, connections: [] })),
  ]);

  const mine = appointments.filter((row) => row.agentUserId === input.userId);
  const live = (status: string) => status !== "cancelled" && status !== "rescheduled";
  const todays = mine.filter((row) => { const at = Date.parse(row.startsAtUtc); return at >= dayStart && at < dayEnd && live(row.status); }).sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc));
  const month = mine.filter((row) => Date.parse(row.startsAtUtc) >= monthStart);
  const showed = month.filter((row) => row.status === "showed").length;
  const noShow = month.filter((row) => row.status === "no_show").length;

  // The row's middle column: who, where, what — from the lead, since an appointment carries none of it.
  const leadIds = [...new Set(todays.map((row) => row.leadId))];
  const db = getSupabaseServiceClient() as unknown as {
    from(t: string): { select(c: string): { eq(c: string, v: string): { in(c: string, v: string[]): PromiseLike<{ data: Array<{ id: string; values: Record<string, unknown> | null; product_line: string | null; campaign_id: string | null }> | null }> } } };
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const leads = leadIds.length
    ? await db.from("agent_leads").select("id, values, product_line, campaign_id").eq("tenant_id", input.tenantId).in("id", leadIds)
    : { data: [] };
  const leadById = new Map((leads.data ?? []).map((row) => [row.id, row]));
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const initialed = (name: string | null) => {
    if (!name) return null;
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0][0]}. ${parts.at(-1)}` : parts[0];
  };

  // "Call her now" on a no-show, subject to the calling window (decided 2026-09-25): asked of the
  // same function every dial path asks, at this moment. The dialer still checks again when it dials.
  const callableNow = new Map<string, boolean | null>();
  await Promise.all(todays.filter((row) => row.status === "no_show").map(async (row) => {
    const lead = leadById.get(row.leadId);
    const state = text(lead?.values?.state) || text(lead?.values?.state_code);
    if (!state) { callableNow.set(row.appointmentId, false); return; }
    const decided = await db.rpc("tenant_can_dial_now", { p_tenant_id: input.tenantId, p_state: state.toUpperCase(), p_campaign_id: lead?.campaign_id ?? null, p_at: new Date(now).toISOString() });
    callableNow.set(row.appointmentId, decided.error ? null : decided.data === true);
  }));

  const policy = context.policy.find((row) => row.userId === input.userId);
  const length = policy?.appointmentMinutes ?? 30;
  const buffer = policy?.bufferMinutes ?? 0;
  const hours: Span[] = hoursRows.map((row) => ({ weekday: row.weekday, startTime: row.startTime, endTime: row.endTime }));
  const myBlocks = context.blocks.filter((row) => row.userId === input.userId);
  const localMinute = (iso: string) => { const at = wallClock(iso, zone); return at.minutes; };
  const blocksToday = myBlocks.flatMap((block) => {
    const first = wallClock(block.startsAt, zone);
    const duration = Math.max(0, (Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000);
    if (block.repeats !== "none") return repeatsOn(block.repeats, first.weekday, today.weekday) ? [{ from: first.minutes, to: first.minutes + duration, reason: block.reason }] : [];
    const start = Date.parse(block.startsAt);
    const end = Date.parse(block.endsAt);
    if (end <= dayStart || start >= dayEnd) return [];
    return [{ from: start <= dayStart ? 0 : localMinute(block.startsAt), to: end >= dayEnd ? 1440 : localMinute(block.endsAt), reason: block.reason }];
  });
  const busyToday = context.busy.filter((row) => row.userId === input.userId && Date.parse(row.endsAt) > dayStart && Date.parse(row.startsAt) < dayEnd)
    .map((row) => ({ from: Date.parse(row.startsAt) <= dayStart ? 0 : localMinute(row.startsAt), to: Date.parse(row.endsAt) >= dayEnd ? 1440 : localMinute(row.endsAt) }));

  const day = dayView({
    hours, weekday: today.weekday, length, buffer, blocks: blocksToday, busy: busyToday, nowMinute: today.minutes,
    appointments: todays.map((row) => {
      const lead = leadById.get(row.leadId);
      const values = lead?.values ?? {};
      const place = [text(values.city) || text(values.address_city), text(values.state) || text(values.state_code)].filter(Boolean).join(" ");
      const product = (lead?.product_line ?? text(values.product_line)).replace(/_/g, " ");
      return {
        id: row.appointmentId, minute: localMinute(row.startsAtUtc), duration: row.durationMinutes, label: [row.customerName, place, product].filter(Boolean).join(" · "), setter: initialed(row.bookedByName),
        detail: {
          appointmentId: row.appointmentId,
          leadId: row.leadId,
          agentUserId: row.agentUserId,
          customerName: row.customerName,
          status: row.status,
          customerTime: customerClock(row.startsAtUtc, row.customerTimezone, zone),
          startsIn: row.status === "booked" || row.status === "confirmed" ? startsInLabel(Date.parse(row.startsAtUtc), now) : null,
          note: row.notes,
          product: row.product,
          face: faceLabel(row.faceAmountCents),
          reminderSent: Boolean(row.reminderSentAt),
          rebookable: row.status === "no_show" && !row.rebookedAs,
          rebooked: row.status === "no_show" && Boolean(row.rebookedAs),
          callable: row.status === "no_show" ? callableNow.get(row.appointmentId) ?? null : null,
        },
      };
    }),
  });

  // Overlapping live appointments for this agent this month: 0 unless double booking is allowed,
  // because the database refuses a second seat otherwise.
  const overlapping = (() => {
    const spans = month.filter((row) => row.status === "booked" || row.status === "confirmed").map((row) => ({ start: Date.parse(row.startsAtUtc), end: Date.parse(row.startsAtUtc) + row.durationMinutes * 60_000 })).sort((a, b) => a.start - b.start);
    let count = 0;
    for (let i = 1; i < spans.length; i += 1) if (spans[i].start < spans[i - 1].end) count += 1;
    return count;
  })();

  const open = openSlots(context, input.userId, now, { days: 0, limit: 200 }).filter((iso) => Date.parse(iso) < dayEnd);
  const future = todays.filter((row) => Date.parse(row.startsAtUtc) > now);

  // The scorecard: the setters booking into THIS calendar (20260925704300). Before that function is
  // applied, the agency-wide view the page always read, which is per setter per day.
  const bySetter = new Map<string, { name: string; dials: number; contacts: number; booked: number; showed: number; noShow: number; sold: number }>();
  const scorecard = agentScorecard
    ? { rows: agentScorecard }
    : await getScorecard(input.tenantId, input.userId, input.role, 30).catch(() => ({ rows: [], scope: "own" as const }));
  for (const row of scorecard.rows) {
    const entry = bySetter.get(row.userId) ?? { name: row.name, dials: 0, contacts: 0, booked: 0, showed: 0, noShow: 0, sold: 0 };
    entry.dials += row.dials; entry.contacts += row.contacts; entry.booked += row.booked; entry.showed += row.showed; entry.noShow += row.noShow; entry.sold += row.sold;
    bySetter.set(row.userId, entry);
  }
  // Where the setter works, as the board reads it ("Manila"): the city of their timezone.
  const cityOf = (zone: string | null | undefined) => (zone && zone.includes("/") ? zone.split("/").at(-1)!.replace(/_/g, " ") : null);
  const place = new Map(roster.map((row) => [row.userId, cityOf(row.timezone)]));
  const setters = [...bySetter].map(([userId, entry]) => ({
    userId, ...entry, place: place.get(userId) ?? null,
    showRatePct: entry.showed + entry.noShow ? (entry.showed / (entry.showed + entry.noShow)) * 100 : null,
    verdict: setterVerdict(entry.showed, entry.noShow),
  // Ranked by shown, decided 2026-09-25: booked is not the number that matters.
  })).sort((a, b) => b.showed - a.showed || b.sold - a.sold || a.name.localeCompare(b.name));
  const teamShowed = setters.reduce((sum, row) => sum + row.showed, 0);
  const teamSold = setters.reduce((sum, row) => sum + row.sold, 0);

  const repeating = myBlocks.filter((block) => block.repeats !== "none");
  return {
    bookable: hoursRows.length > 0 || Boolean(policy),
    zone,
    dateLabel: `${DAY_LONG[today.weekday]} ${today.day} ${MONTH_LONG[today.month - 1]}`,
    tiles: {
      bookedToday: todays.length,
      nextAt: future[0] ? clock(localMinute(future[0].startsAtUtc)) : null,
      shownToday: todays.filter((row) => row.status === "showed").length,
      noShowToday: todays.filter((row) => row.status === "no_show").length,
      openLeft: open.length,
      slotsToday: slotsForDay(hours, today.weekday, length, buffer),
      showedThisMonth: showed,
      closedThisMonth: showed + noShow,
      sold: teamSold,
      showedForSold: teamShowed,
      doubleBookingAllowed: Boolean(policy?.allowDoubleBooking),
      doubleBookings: overlapping,
    },
    day,
    setters,
    scorecardScope: agentScorecard ? "calendar" : "agency",
    availability: {
      hours: hoursSummary(hours),
      hoursNote: "your local time",
      lengthMinutes: length,
      bufferMinutes: buffer,
      blocks: repeating.slice(0, 3).map((block) => `${block.reason ? `${block.reason[0].toUpperCase()}${block.reason.slice(1)} ` : ""}${blockWhen(block, zone)}${block.repeats === "weekdays" ? " weekdays" : block.repeats === "daily" ? " daily" : ""}`),
      linkedCalendar: connections.connections.some((row) => row.userId === input.userId && row.status === "connected"),
    },
  };
}
