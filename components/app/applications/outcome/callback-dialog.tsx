"use client";

/**
 * "Set a callback" on a requirement (LA-3.18): books a callback in tenant_callbacks, in the client's
 * own timezone, linked back to the requirement — it counts as a chase, shows on Callbacks and the
 * calendar, and a new booking on the lead replaces the one still open.
 */

import { useState, type FormEvent } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { REQUIREMENT_KIND_LABEL } from "@/lib/applications/constants";
import type { RequirementView } from "@/lib/applications/types";
import { notify } from "@/lib/notify";

import { dateTime } from "@/components/app/applications/parts";
import { attemptUrl, request } from "@/components/app/applications/submit/api";
import { Overlay } from "@/components/app/applications/submit/overlay";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { dateInput, DAY_MS } from "./model";

export function CallbackDialog({ open, onOpenChange, requirement, onBooked }: { open: boolean; onOpenChange: (open: boolean) => void; requirement: RequirementView | null; onBooked: () => void }) {
  return open && requirement ? <CallbackForm open={open} onOpenChange={onOpenChange} requirement={requirement} onBooked={onBooked} /> : null;
}

function CallbackForm({ open, onOpenChange, requirement, onBooked }: { open: boolean; onOpenChange: (open: boolean) => void; requirement: RequirementView; onBooked: () => void }) {
  const { attempt, caseView, sample, actions } = useWorkspace();
  const [today] = useState(() => Date.now());
  const [day, setDay] = useState(() => dateInput(today + DAY_MS));
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState(`Chase: ${REQUIREMENT_KIND_LABEL[requirement.kind]}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}$/.test(time) && note.length <= 1000;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    if (sample) { notify.done("Sample data — no callback was booked."); onOpenChange(false); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await request<{ scheduledAtUtc: string | null; timezone: string }>(attemptUrl(attempt.id, `/requirements/${requirement.id}/callback`), { method: "POST", body: { local: `${day}T${time}`, note: note.trim() || null } });
      if (!r.ok) { setError(r.error); return; }
      await actions.refresh();
      onBooked();
      notify.done("Callback booked", { detail: r.data.scheduledAtUtc ? `${dateTime(r.data.scheduledAtUtc, r.data.timezone)} their time — it's on Callbacks and counts as a chase.` : undefined });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay
      open={open}
      onOpenChange={(o) => { if (!saving) onOpenChange(o); }}
      width={720}
      title="Set a callback"
      subtitle={`${REQUIREMENT_KIND_LABEL[requirement.kind]} · ${caseView.clientName}`}
      onSubmit={save}
      footerNote="In the client's own timezone, from their state. Booking a new one replaces the callback still open on this lead."
      actions={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} title={saving ? "Saving…" : undefined}>Cancel</Button>
        <Button type="submit" disabled={!valid || saving} title={!valid ? "Choose a day and time" : saving ? "Saving…" : undefined}>{saving ? "Booking…" : "Book callback"}</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Day" htmlFor="callback-day">
          <input id="callback-day" type="date" className={control} value={day} min={dateInput(today)} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Time (their time)" htmlFor="callback-time">
          <input id="callback-time" type="time" className={control} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Note" htmlFor="callback-note" hint="What to say when you call.">
        <input id="callback-note" className={control} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p>}
    </Overlay>
  );
}
