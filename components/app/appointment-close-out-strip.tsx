"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, CircleAlert, UserRound, UserX, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { TableCard } from "@/components/ui/table-card";
import { SectionLoading } from "@/components/ui/page-states";

type Appointment = {
  appointmentId: string;
  leadId: string;
  startsAtLocal: string;
  customerTimezone: string;
  customerName: string;
  note: string | null;
};

const outcomes = [
  { value: "showed", label: "Showed", icon: Check },
  { value: "no_show", label: "No-show", icon: UserX },
  { value: "cancelled", label: "Cancelled", icon: X },
] as const;

/**
 * `hideWhenEmpty` is for the dashboard. Decision 12 describes this as something that "appears in a
 * short strip at the top of his dashboard the next morning" — it appears when there is something to
 * close out, and on the mornings there is nothing it should take no space at all. On Activity &
 * scorecard the opposite is true: that is a reporting screen, and "no appointments need close-out"
 * is a fact worth stating there.
 */
export function AppointmentCloseOutStrip({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean } = {}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/app/appointments/close-out", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load appointment close-outs");
      setAppointments(Array.isArray(body?.appointments) ? body.appointments : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load appointment close-outs");
    } finally {
      setLoading(false);
    }
  }, []);

  // This card is a server snapshot and must load after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function record(appointment: Appointment, outcome: typeof outcomes[number]["value"]) {
    const label = outcomes.find((item) => item.value === outcome)?.label ?? outcome;
    if (!window.confirm(`Record ${label.toLowerCase()} for ${appointment.customerName}?`)) return;
    setSaving(appointment.appointmentId);
    setError("");
    try {
      const response = await fetch("/api/app/appointments/close-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointment_id: appointment.appointmentId, outcome }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not record appointment outcome");
      setAppointments((current) => current.filter((item) => item.appointmentId !== appointment.appointmentId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record appointment outcome");
    } finally {
      setSaving(null);
    }
  }

  // Nothing to close out, and nothing to say about it here. Rendered before the loading check too,
  // so the dashboard does not flash a card that is about to disappear on most mornings.
  if (hideWhenEmpty && !error && appointments.length === 0) return null;

  return <TableCard title="Appointment close-out" description="Ended recently and still need an outcome." action={<RefreshButton onClick={() => void load()} refreshing={loading} />}>
    {error && <div role="alert" className="flex items-center gap-2 border-t border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><CircleAlert className="size-4 shrink-0" />{error}<Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>Retry</Button></div>}
    {loading ? <SectionLoading rows={2} columns={3} label="Loading close-outs" /> : appointments.length === 0 ? <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">No appointments need close-out right now.</p> : <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">{appointments.map((appointment) => <li key={appointment.appointmentId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="flex items-center gap-2 text-sm font-medium"><UserRound className="size-4 shrink-0 text-muted-foreground" />{appointment.customerName}</p><p className="mt-1 text-xs text-muted-foreground">{appointment.startsAtLocal} ({appointment.customerTimezone}) · {appointment.note || "No setter note"} · <Link href={`/app/leads/${appointment.leadId}`} className="text-primary underline underline-offset-2">Open lead</Link></p></div><div className="flex flex-wrap gap-2">{outcomes.map(({ value, label, icon: Icon }) => <Button key={value} type="button" size="sm" variant={value === "showed" ? "default" : "outline"} disabled={saving === appointment.appointmentId} onClick={() => void record(appointment, value)}><Icon className="size-4" />{saving === appointment.appointmentId ? "Saving…" : label}</Button>)}</div></li>)}</ul>}
  </TableCard>;
}
