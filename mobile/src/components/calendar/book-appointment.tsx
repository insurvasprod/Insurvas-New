import { useState } from "react";
import { View } from "react-native";

import { Button, Failed, Loading, Row, T } from "@/components/ui";
import { Mini, SlotGrid } from "@/components/calls/parts";
import { addDays, clock, dayLabel, dayKey, deviceZone, stateName, weekday, zoneLong } from "@/components/calls/time";
import { ApiError } from "@/lib/api";
import { firstName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { SelectField } from "./parts";
import { bookableAgents, hoursAhead, openSlots, type BookableContext } from "./slots";

/**
 * Board C8b · Book an appointment, the body of a sheet over the call or the lead. Who (a licensed
 * calendar holder from GET /api/app/appointments) and a slot from their calendar, shown in the
 * customer's time with how the viewer's own clock relates. POST /api/app/appointments books it;
 * `book_appointment` re-checks every rule (window, hours, blocks, caps, the race for the slot) and its
 * refusal comes back in the server's own words.
 *
 * "With" offers the producers licensed in the lead's state ("Ava Kim · licensed in GA"), from the same
 * read with ?lead_id= (the lead's state and each person's licensed states).
 *
 * Not built (2026-11-26): the board's Phone / Video / In person switch, the "Where" field and "Text
 * <customer> a reminder the day before". tenant_appointments has no method, place or reminder-choice
 * column and POST /api/app/appointments takes none, so none of them could be honoured. The customer's
 * reminder is the server's own: an email when the lead has an email address and live consent.
 */
export const SLOT_COUNT = 6;

/**
 * The line over the slots (board: "Ava’s free times · her time = Linda’s (Eastern)"): the slots are in
 * the customer's time, and the viewer's own clock is said beside them (owner rule).
 */
export function zoneLine(agent: string, customer: string, customerZone: string, viewerZone: string, agentZone: string | null, at: Date): string {
  const long = zoneLong(customerZone);
  const agentSame = agentZone ? hoursAhead(customerZone, agentZone, at) === 0 : false;
  const head = agentSame ? `${agent}’s free times · ${agent}’s time = ${customer}’s (${long})` : `${agent}’s free times · in ${customer}’s time (${long})`;
  const mine = hoursAhead(customerZone, viewerZone, at);
  if (mine === 0) return `${head} = yours`;
  return `${head} · yours is ${Math.abs(mine)} h ${mine > 0 ? "ahead" : "behind"}`;
}

/** "Thu 2:00" inside the coming week; past it the date ("3 Dec 2:00"), so two Thursdays never read alike. */
export function slotLabel(iso: string, zone: string, now: number): string {
  const at = new Date(iso);
  const key = dayKey(at, zone);
  const within = key < addDays(dayKey(new Date(now), zone), 7);
  return `${within ? weekday(key) : dayLabel(key).split(" ").slice(1).join(" ")} ${clock(at, zone, false)}`;
}

export function BookAppointment({ leadId, leadName, customerZone, viewerTimezone, onBooked }: { leadId: string; leadName: string; customerZone: string | null; viewerTimezone?: string | null; onBooked: (startsAtUtc: string) => void }) {
  const p = usePalette();
  const { api, me } = useSession();
  const context = useLoad(() => api<BookableContext>(`/api/app/appointments?lead_id=${encodeURIComponent(leadId)}`), [leadId]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  if (context.loading && !context.data) return <Loading rows={2} />;
  if (context.error && !context.data) return <Failed message={context.error} onRetry={context.reload} />;
  const all = context.data?.agents ?? [];
  if (!all.length) return <T kind="small">No one on your team has working hours set, so there’s no calendar to book into yet.</T>;
  const { agents, licensedIn } = bookableAgents(all, context.data?.licensedStates, context.data?.leadState);
  if (!agents.length) return <T kind="small">{`No one who takes appointments is licensed in ${stateName(licensedIn) ?? licensedIn}, so there’s no one to book this customer with.`}</T>;
  const withLine = (name: string) => (licensedIn ? `${name} · licensed in ${licensedIn}` : name);
  const agent = agents.find((a) => a.userId === agentId) ?? agents.find((a) => a.userId === me?.user.id) ?? agents[0];
  const viewerZone = viewerTimezone || deviceZone();
  const zone = customerZone;
  const slots = context.data && zone ? openSlots(context.data, agent.userId, now, { days: 14, limit: SLOT_COUNT }) : [];
  const chosen = slot && slots.includes(slot) ? slot : null;

  async function book() {
    if (!chosen) return;
    setBusy(true); setMessage(null);
    try {
      const answer = await api<{ appointment: { startsAtUtc: string } }>("/api/app/appointments", { method: "POST", body: { lead_id: leadId, agent_user_id: agent.userId, starts_at_utc: chosen } });
      onBooked(answer.appointment.startsAtUtc);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "The appointment wasn’t booked. Try again.");
      // A slot taken meanwhile: show the calendar as it is now.
      if (e instanceof ApiError && e.code === "appointment_slot_taken") { setSlot(null); context.reload(); }
    } finally {
      setBusy(false);
    }
  }

  const label = (iso: string) => slotLabel(iso, zone as string, now);

  return (
    <View style={{ gap: 12, paddingBottom: 8 }} testID="book-appointment">
      <SelectField testID="book-with" label="With" value={withLine(agent.name)} open={choosing} onPress={() => setChoosing((v) => !v)} />
      {choosing ? (
        <View style={{ marginHorizontal: -16 }}>
          {agents.map((a, i) => (
            <Row key={a.userId} testID={`book-agent-${a.userId}`} first={i === 0} title={withLine(a.name)} selected={a.userId === agent.userId} chevron={false}
              onPress={() => { setAgentId(a.userId); setSlot(null); setChoosing(false); }} />
          ))}
        </View>
      ) : null}
      {zone ? (
        <>
          <Mini>{zoneLine(firstName(agent.name), firstName(leadName), zone, viewerZone, agent.timezone, new Date(now))}</Mini>
          {slots.length ? (
            <SlotGrid slots={slots.map((s) => ({ key: s, label: label(s) }))} value={chosen} onPick={(k) => { setMessage(null); setSlot(k); }} />
          ) : (
            <T kind="small">{`No free times on ${firstName(agent.name)}’s calendar in the next two weeks.`}</T>
          )}
        </>
      ) : (
        <T kind="small">This lead has no state, so there’s no time zone to book in. Add the state first.</T>
      )}
      {message ? <T color={p.bad}>{message}</T> : null}
      <Button write testID="book-submit" icon="calendar" busy={busy} disabled={!chosen}
        label={chosen && zone ? `Book ${dayLabel(dayKey(new Date(chosen), zone))}, ${clock(new Date(chosen), zone)}` : "Choose a time"}
        onPress={() => void book()} />
    </View>
  );
}
