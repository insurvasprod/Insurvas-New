"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Callout } from "@/components/app/settings/primitives";
import { ChoiceList } from "@/components/app/book/needs-you/choice-list";
import { notify } from "@/lib/notify";

/** One appointment waiting for an outcome, as GET /api/app/appointments/close-out sends it. */
export type CloseOutRow = {
  appointmentId: string;
  leadId: string;
  startsAtLocal: string;
  customerTimezone: string;
  customerName: string;
  note: string | null;
};
type Appointment = CloseOutRow;

/** The appointment's day in the client's own time ("2026-11-10"), read from `startsAtLocal`; "" when it has none. */
export function closeOutDay(appointment: Pick<CloseOutRow, "startsAtLocal">) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(appointment.startsAtLocal ?? "");
  return match ? match[1] : "";
}

/** "Mon 10 Nov" for a "2026-11-10" day. */
export function closeOutDayLabel(day: string) {
  const at = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(at)) return day;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(at);
}

type Outcome = "showed" | "no_show" | "cancelled";
const OUTCOMES: ReadonlyArray<{ key: Outcome; label: string; hint: string; done: string }> = [
  { key: "showed", label: "Showed", hint: "The client was on the call.", done: "showed" },
  { key: "no_show", label: "No-show", hint: "Nobody answered at the time.", done: "no-show" },
  { key: "cancelled", label: "Cancelled", hint: "The client called it off.", done: "cancelled" },
];

/**
 * Team activity › Close out (Reports round 7, owner pick 2·6, 2026-11-11): the appointments that ended and still need
 * an outcome, one line each, with "Close out ›". The decision left the row: Close out › opens "How did it go?" with
 * the three outcomes, and "Save and open the next" walks the list without leaving the dialog. It is work, so it is its
 * table, and it opens on it (owner 2026-11-12: the Table · Chart switch is on every Reports sub-page, work tabs too).
 * `onCount` keeps the tab's count in step as rows close. `?day=` (a day's bar on the chart) narrows the rows to the
 * appointments on that day; the dialog's walk is unchanged.
 */
export function AppointmentCloseOutStrip({ onCount }: { onCount?: (count: number) => void } = {}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Appointment | null>(null);
  const [choice, setChoice] = useState<Outcome | null>(null);
  const [saving, setSaving] = useState(false);
  const query = useSearchParams();
  const pathname = usePathname();
  const day = query.get("day") ?? "";
  const shown = day ? appointments.filter((item) => closeOutDay(item) === day) : appointments;
  const allHref = (() => { const params = new URLSearchParams(query.toString()); params.delete("day"); const rest = params.toString(); return rest ? `${pathname}?${rest}` : pathname; })();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/app/appointments/close-out", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load appointment close-outs");
      const list: Appointment[] = Array.isArray(body?.appointments) ? body.appointments : [];
      setAppointments(list);
      onCount?.(list.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load appointment close-outs");
    } finally {
      setLoading(false);
    }
  }, [onCount]);

  // A server snapshot, read after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const openRow = (appointment: Appointment) => { setChoice(null); setOpen(appointment); };

  async function save() {
    if (!open || !choice) return;
    const outcome = OUTCOMES.find((item) => item.key === choice)!;
    setSaving(true);
    try {
      const response = await fetch("/api/app/appointments/close-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointment_id: open.appointmentId, outcome: choice }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not record the appointment's outcome");
      const rest = appointments.filter((item) => item.appointmentId !== open.appointmentId);
      setAppointments(rest);
      onCount?.(rest.length);
      notify.done(`${open.customerName}: ${outcome.done}`, { detail: `Close out now shows ${rest.length.toLocaleString()}` });
      // The next one waiting, in the list's order, opens in the same dialog.
      const at = appointments.findIndex((item) => item.appointmentId === open.appointmentId);
      const next = rest[at] ?? rest[0] ?? null;
      setChoice(null);
      setOpen(next);
    } catch (cause) {
      notify.fail("The outcome was not saved", { detail: cause instanceof Error ? cause.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  const more = open ? appointments.length > 1 : false;

  return (
    <>
      <TableCard
        className="min-w-0"
        toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} />} />}
        footer={<span>{loading ? "…" : day
          ? <>{`${shown.length.toLocaleString()} of ${appointments.length.toLocaleString()} waiting for an outcome · on ${closeOutDayLabel(day)} · soonest first · `}<Link href={allHref} className="font-medium text-[var(--accent-ink)] hover:underline">Show every day</Link></>
          : `${appointments.length.toLocaleString()} ${appointments.length === 1 ? "appointment" : "appointments"} waiting for an outcome · soonest first`}</span>}
      >
        {error && <Callout tone="error" title="Close-outs did not load">{error}</Callout>}
        {loading && !appointments.length ? <SectionLoading rows={3} columns={5} label="Loading close-outs" />
          : appointments.length === 0 ? <EmptyState title="No appointments to close out" hint="Appointments that ended and still need an outcome show here." />
          : shown.length === 0 ? <EmptyState title={`Nothing to close out on ${closeOutDayLabel(day)}`} hint="Every appointment that day has an outcome." action={<Button variant="outline" asChild><Link href={allHref}>Show every day</Link></Button>} />
          : (
            <table className="portal-activity-table w-full min-w-[640px] text-left text-sm">
              <thead><tr><th>Client</th><th>Appointment</th><th>Setter note</th><th>Status</th><th>Next step</th></tr></thead>
              <tbody className="m-seq">
                {shown.map((appointment) => (
                  <tr key={appointment.appointmentId} className="m-row cursor-pointer" onClick={() => openRow(appointment)}>
                    <td className="max-w-[220px] truncate font-medium"><Link href={`/app/leads/${appointment.leadId}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>{appointment.customerName}</Link></td>
                    <td className="whitespace-nowrap tabular-nums" title={appointment.customerTimezone || undefined}>{appointment.startsAtLocal}</td>
                    <td className="max-w-[280px] truncate" title={appointment.note ?? undefined}>{appointment.note ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap"><StatusChip tone="warning">Needs an outcome</StatusChip></td>
                    <td className="whitespace-nowrap"><Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={(event) => { event.stopPropagation(); openRow(appointment); }}>Close out ›</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </TableCard>
      <ConfirmDialog
        open={open !== null}
        onOpenChange={(next) => { if (!next) setOpen(null); }}
        onConfirm={() => void save()}
        busy={saving}
        destructive={false}
        title="How did it go?"
        description={open ? `${open.customerName} · ${open.startsAtLocal}${open.customerTimezone ? ` (${open.customerTimezone})` : ""}` : undefined}
        confirmLabel={saving ? "Saving…" : more ? "Save and open the next" : "Save"}
        confirmDisabled={!choice}
        fields={<ChoiceList name="close-out-outcome" label="The appointment's outcome" choices={OUTCOMES.map(({ key, label, hint }) => ({ key, label, hint }))} value={choice} onChange={setChoice} disabled={saving} />}
      />
    </>
  );
}
