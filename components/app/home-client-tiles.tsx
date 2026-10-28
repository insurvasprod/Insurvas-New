"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DashTile, type TileRow } from "@/components/ui/dash-tile";
import { LaunchEmpty } from "@/components/ui/launchpad";
import { expiryCountdown, type PendingSummary } from "@/lib/applications/listRules";

/**
 * The two home tiles that load in the browser, as their cards did: pending cases (LA-3.15 / 3.18 /
 * 3.26) and the appointment close-out (LA-2 decision 12). Same routes, same scoping on the server
 * (/api/app/pending/summary and /api/app/appointments/close-out both call scopeFor).
 */

/** Awaiting a policy number, waiting on the client, counteroffers about to expire. */
export function PendingTile() {
  const [summary, setSummary] = useState<PendingSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden">("loading");

  useEffect(() => {
    let live = true;
    fetch("/api/app/pending/summary", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json().catch(() => null)) as { summary?: PendingSummary } | null)?.summary ?? null : null))
      .then((body) => { if (live) { setSummary(body); setState(body ? "ready" : "hidden"); } })
      .catch(() => { if (live) setState("hidden"); });
    return () => { live = false; };
  }, []);

  if (state === "hidden") return <LaunchEmpty />;
  if (!summary) return <DashTile title="Pending cases" icon={<ClipboardList />} href="/app/pending" rows={[{ label: "Counting your pending cases" }]} />;
  // eslint-disable-next-line react-hooks/purity -- a countdown is as of this render.
  const soonest = expiryCountdown(summary.counteroffersExpiring.soonestExpiresAt, Date.now());
  const total = summary.awaitingPolicyNumber.count + summary.waitingOnClient.count + summary.counteroffersExpiring.count;
  const rows: TileRow[] = [
    { label: "Awaiting policy number", value: String(summary.awaitingPolicyNumber.count), tone: summary.awaitingPolicyNumber.count ? "danger" : "default", href: "/app/pending?tab=awaiting" },
    { label: summary.waitingOnClient.overdue ? `Waiting on the client · ${summary.waitingOnClient.overdue} overdue` : "Waiting on the client", value: String(summary.waitingOnClient.count), tone: summary.waitingOnClient.overdue ? "danger" : summary.waitingOnClient.count ? "warning" : "default", href: "/app/pending" },
    { label: soonest ? `Counteroffers expiring · first ${soonest.label}` : "Counteroffers expiring", value: String(summary.counteroffersExpiring.count), tone: summary.counteroffersExpiring.count ? "warning" : "default", href: "/app/pending?tab=counteroffers" },
  ];
  return <DashTile title="Pending cases" icon={<ClipboardList />} href="/app/pending" big={String(total)} unit="open" tone={summary.awaitingPolicyNumber.count || summary.waitingOnClient.overdue ? "warning" : "default"} rows={rows} />;
}

type Appointment = { appointmentId: string; leadId: string; startsAtLocal: string; customerTimezone: string; customerName: string; note: string | null };
const OUTCOMES = [
  { value: "showed", label: "Showed" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled", label: "Cancelled" },
] as const;

/**
 * Appointments that ended and still need an outcome: three a morning, three buttons each, "ten
 * seconds" (decision 12). Nothing to close out and the tile leaves the grid, as the strip did.
 */
export function CloseOutTile({ href }: { href: string }) {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/app/appointments/close-out", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load close-outs");
      setAppointments(Array.isArray(body?.appointments) ? body.appointments : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load close-outs");
      setAppointments([]);
    }
  }, []);

  // Loads after hydration, as the strip did.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function record(appointment: Appointment, outcome: (typeof OUTCOMES)[number]["value"]) {
    const label = OUTCOMES.find((item) => item.value === outcome)?.label ?? outcome;
    if (!(await confirmAction({ title: `Record ${label.toLowerCase()} for ${appointment.customerName}?`, description: "This closes the appointment with that outcome.", confirmLabel: `Record ${label.toLowerCase()}`, cancelLabel: "Not yet", destructive: false }))) return;
    setSaving(appointment.appointmentId);
    setError("");
    try {
      const response = await fetch("/api/app/appointments/close-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointment_id: appointment.appointmentId, outcome }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not record the outcome");
      setAppointments((current) => (current ?? []).filter((item) => item.appointmentId !== appointment.appointmentId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the outcome");
    } finally {
      setSaving(null);
    }
  }

  if (appointments !== null && appointments.length === 0 && !error) return <LaunchEmpty />;
  return (
    <DashTile title="Appointment close-out" icon={<ListChecks />} href={href} big={appointments ? String(appointments.length) : undefined} unit="need an outcome" tone="warning">
      {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {(appointments ?? []).slice(0, 3).map((appointment) => (
          <li key={appointment.appointmentId} className="flex flex-col gap-1.5">
            <span className="truncate text-sm leading-normal text-foreground">{appointment.customerName} <span className="text-xs text-muted-foreground">· {appointment.startsAtLocal}</span></span>
            <span className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((outcome) => (
                <Button key={outcome.value} type="button" size="sm" variant={outcome.value === "showed" ? "default" : "outline"} disabled={saving === appointment.appointmentId} onClick={() => void record(appointment, outcome.value)}>
                  {outcome.label}
                </Button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </DashTile>
  );
}
