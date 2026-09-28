"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { clockLabel, openSlots, wallClock, type PickerContext } from "@/lib/appointments/calendarMath";

/**
 * "Rebook" on a no-show (LA-2 §11, decided 2026-09-25). A new appointment through the same rules as
 * any booking — only slots the calendar offers, and `rebook_appointment` still refuses anything
 * wrong and says why. The no-show stays a no-show; whoever rebooks it is `booked_by`.
 */
type Context = PickerContext & { agents: Array<{ userId: string; name: string; timezone: string | null }> };

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function RebookButton({ appointmentId, agentUserId, customerName, onRebooked, size = "sm" }: {
  appointmentId: string;
  agentUserId: string;
  customerName: string;
  onRebooked?: () => void;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)}>Rebook</Button>
      {open && <RebookDialog appointmentId={appointmentId} agentUserId={agentUserId} customerName={customerName} onClose={() => setOpen(false)} onRebooked={() => { setOpen(false); onRebooked?.(); }} />}
    </>
  );
}

function RebookDialog({ appointmentId, agentUserId, customerName, onClose, onRebooked }: {
  appointmentId: string;
  agentUserId: string;
  customerName: string;
  onClose: () => void;
  onRebooked: () => void;
}) {
  const router = useRouter();
  const [context, setContext] = useState<Context | null>(null);
  const [loadError, setLoadError] = useState("");
  const [agent, setAgent] = useState(agentUserId);
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nowAt, setNowAt] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch("/api/app/appointments", { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!active) return;
      if (!response.ok) { setLoadError(body?.error ?? "Could not load the calendar"); return; }
      setContext(body as Context);
      setNowAt(Date.now());
    }).catch(() => { if (active) setLoadError("Could not reach Insurvas. Check your connection and try again."); });
    return () => { active = false; };
  }, []);

  const bookable = useMemo(() => (context?.agents ?? []).filter((row) => context?.availability.some((hours) => hours.userId === row.userId)), [context]);
  const zone = context?.availability.find((row) => row.userId === agent)?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const slots = useMemo(() => (context && nowAt ? openSlots(context, agent, nowAt, { days: 21, limit: 60 }) : []), [context, agent, nowAt]);
  const label = (iso: string) => {
    const clock = wallClock(iso, zone);
    return `${WEEKDAY[clock.weekday]} ${clock.day} ${MONTH[clock.month - 1]} · ${clockLabel(clock.minutes)}`;
  };

  async function rebook() {
    if (!slot || busy) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/app/appointments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rebook", appointment_id: appointmentId, starts_at_utc: slot, agent_user_id: agent }),
    }).catch(() => null);
    setBusy(false);
    if (!response) { setError("Could not reach Insurvas. Check your connection and try again."); return; }
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "That slot could not be booked"); return; }
    router.refresh();
    onRebooked();
  }

  const field = "mt-1.5 block h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground";
  const labelClass = "block text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Rebook {customerName}</DialogTitle>
          <DialogDescription>A new appointment; the no-show stays on the record. Times are in {zone}.</DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{loadError}</p>
        ) : !context ? (
          <SectionLoading rows={2} columns={2} label="Loading availability" />
        ) : (
          <div className="grid gap-4">
            <label htmlFor="rebook-agent" className={labelClass}>
              With
              <select id="rebook-agent" value={agent} onChange={(event) => { setAgent(event.target.value); setSlot(""); }} className={field}>
                {!bookable.some((row) => row.userId === agent) && <option value={agent}>The original agent (no working hours)</option>}
                {bookable.map((row) => <option key={row.userId} value={row.userId}>{row.name}</option>)}
              </select>
            </label>
            <label htmlFor="rebook-slot" className={labelClass}>
              Slot
              <select id="rebook-slot" value={slot} onChange={(event) => setSlot(event.target.value)} className={field}>
                <option value="">{slots.length ? "Choose a slot" : "No open slots in the next three weeks"}</option>
                {slots.map((iso) => <option key={iso} value={iso}>{label(iso)}</option>)}
              </select>
            </label>
            {error && <p role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!slot || busy} onClick={() => void rebook()}>{busy ? "Rebooking…" : "Rebook appointment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
