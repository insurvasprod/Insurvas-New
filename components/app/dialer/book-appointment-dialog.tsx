"use client";

import { useMemo } from "react";

import { CallbackPicker } from "@/components/app/callbacks/callback-picker";
import { ScheduleDialog } from "@/components/app/dialer/schedule-dialog";
import { viewerTimeZone } from "@/lib/format/dates";
import { zoneShort } from "@/lib/dialerScripts/display";
import { cn } from "@/lib/utils";
import { fieldClass, fieldLabel, slotOptionLabel, small } from "@/components/app/dialer/model";
import type { useDialer } from "@/components/app/dialer/use-dialer";

/** An instant as "YYYY-MM-DDTHH:mm" on the wall clock of `zone`. */
function localIn(iso: string, zone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Book an appointment, from the call (user decision 2026-10-06), in the Dialer's one scheduling
 * pop-up (owner 2026-10-27): the agent, then a day and one of their open times on the calendar, then
 * notes for them. Slot-only (Appointments audit, 2026-09-25): the agent's open slots in the
 * customer's time, with those outside the customer's calling window left out; the server still
 * checks every rule when it books.
 */
export function BookAppointmentDialog({ d, open, onOpenChange }: { d: ReturnType<typeof useDialer>; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { panel, calendar, bookAgent, setBookAgent, bookSlot, setBookSlot, bookNotes, setBookNotes, booking, bookAppointment, bookableSlots, customerZone } = d;
  // The slots on the customer's clock for the calendar, and the way back to the instant the server books.
  const zone = customerZone ?? viewerTimeZone();
  const { locals, toIso } = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of bookableSlots) map.set(localIn(slot, zone), slot);
    return { locals: [...map.keys()], toIso: map };
  }, [bookableSlots, zone]);
  if (!panel || !calendar || calendar.agents.length === 0) return null;
  const leadName = panel.lead.fullName ?? panel.lead.firstName;
  const pickedLocal = bookSlot ? localIn(bookSlot, zone) : "";
  return (
    <ScheduleDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Book an appointment"
      description={<>{leadName ? `For ${leadName}. ` : ""}The agent gets it on their calendar with your notes.</>}
      submitLabel="Book appointment"
      busyLabel="Booking…"
      busy={booking}
      submitDisabled={!bookAgent || !bookSlot}
      submitTitle={!bookSlot ? "Choose one of the open times first" : undefined}
      onSubmit={() => void bookAppointment().then((booked) => { if (booked) onOpenChange(false); })}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="book-agent" className={fieldLabel}>Agent</label>
        <select id="book-agent" className={fieldClass} value={bookAgent} onChange={(event) => { setBookAgent(event.target.value); setBookSlot(""); }}>
          {calendar.agents.map((agent) => <option key={agent.userId} value={agent.userId}>{agent.name}{agent.timezone ? ` · ${agent.timezone}` : ""}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className={cn(fieldLabel, "m-0")}>Open time{customerZone ? <> <span className="font-normal text-[var(--muted)]">· customer&rsquo;s time ({zoneShort(customerZone)})</span></> : ""}</p>
        {bookableSlots.length > 0 ? (
          <>
            <CallbackPicker key={bookAgent} value={pickedLocal} onChange={(local) => setBookSlot(toIso.get(local) ?? "")} zone={zone} disabled={booking} slots={locals} label="Open times" />
            {bookSlot && <p className={cn(small, "m-0 tabular-nums")}>{slotOptionLabel(bookSlot, customerZone)}</p>}
          </>
        ) : (
          <p className={cn(small, "m-0 rounded-md bg-[var(--surface-alt)] px-3 py-2")} role="status">No open times for this agent in the next 7 days{panel.callbackWindow ? " inside the customer's calling window" : ""}. Choose another agent.</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="book-notes" className={fieldLabel}>Notes for the agent <span className="font-normal text-[var(--muted)]">(optional)</span></label>
        <textarea id="book-notes" rows={3} maxLength={2000} className={cn(fieldClass, "h-auto py-2")} value={bookNotes} onChange={(event) => setBookNotes(event.target.value)} placeholder="What was discussed, and what to lead with." />
      </div>
    </ScheduleDialog>
  );
}
