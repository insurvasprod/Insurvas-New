"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { zoneShort } from "@/lib/dialerScripts/display";
import { cn } from "@/lib/utils";
import { fieldClass, fieldLabel, slotOptionLabel, small } from "@/components/app/dialer/model";
import type { useDialer } from "@/components/app/dialer/use-dialer";

/**
 * Book an appointment, from the call (user decision 2026-10-06): the "Book appointment" button next
 * to Start call opens this pop-up — the agent, one of their open times and notes for them. It was a
 * card in the outcome column before. Slot-only (Appointments audit, 2026-09-25): the agent's open
 * slots in the customer's time, with those outside the customer's calling window left out; the
 * server still checks every rule when it books.
 */
export function BookAppointmentDialog({ d, open, onOpenChange }: { d: ReturnType<typeof useDialer>; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { panel, calendar, bookAgent, setBookAgent, bookSlot, setBookSlot, bookNotes, setBookNotes, booking, bookAppointment, bookableSlots, customerZone } = d;
  if (!panel || !calendar || calendar.agents.length === 0) return null;
  const leadName = panel.lead.fullName ?? panel.lead.firstName;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Book an appointment</DialogTitle>
          <DialogDescription>{leadName ? `For ${leadName}. ` : ""}The agent gets it on their calendar with your notes.</DialogDescription>
        </DialogHeader>
        <form
          id="book-appointment-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => { event.preventDefault(); void bookAppointment().then((booked) => { if (booked) onOpenChange(false); }); }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="book-agent" className={fieldLabel}>Agent</label>
            <select id="book-agent" className={fieldClass} value={bookAgent} onChange={(event) => setBookAgent(event.target.value)}>
              {calendar.agents.map((agent) => <option key={agent.userId} value={agent.userId}>{agent.name}{agent.timezone ? ` · ${agent.timezone}` : ""}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="book-slot" className={fieldLabel}>Open time{customerZone ? <> <span className="font-normal text-[var(--muted)]">· customer&rsquo;s time ({zoneShort(customerZone)})</span></> : ""}</label>
            {bookableSlots.length > 0 ? (
              <select id="book-slot" className={fieldClass} value={bookableSlots.includes(bookSlot) ? bookSlot : ""} onChange={(event) => setBookSlot(event.target.value)}>
                <option value="">Choose a time</option>
                {bookableSlots.map((slot) => <option key={slot} value={slot}>{slotOptionLabel(slot, customerZone)}</option>)}
              </select>
            ) : (
              <p className={cn(small, "m-0 rounded-md bg-[var(--surface-alt)] px-3 py-2")} role="status">No open times for this agent in the next 7 days{panel.callbackWindow ? " inside the customer's calling window" : ""}. Choose another agent.</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="book-notes" className={fieldLabel}>Notes for the agent <span className="font-normal text-[var(--muted)]">(optional)</span></label>
            <textarea id="book-notes" rows={4} maxLength={2000} className={cn(fieldClass, "h-auto py-2")} value={bookNotes} onChange={(event) => setBookNotes(event.target.value)} placeholder="What was discussed, and what to lead with." />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="book-appointment-form" disabled={!bookAgent || !bookSlot || booking} title={!bookSlot ? "Choose one of the open times first" : undefined}>{booking ? "Booking…" : "Book appointment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
