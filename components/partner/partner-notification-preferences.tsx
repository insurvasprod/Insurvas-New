"use client";

import { useCallback, useEffect, useState } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { SectionLoading } from "@/components/ui/page-states";
import { cn } from "@/lib/utils";
import type { PartnerAlertEvent, PartnerAlertSettings } from "@/lib/partnerAlerts/presentation";

/**
 * The preferences half of "Profile & notifications", as p-par-settings draws it: three things a
 * partner can be told about, the timezone their dates are read in, and one Save.
 *
 * "Account changes" and do-not-disturb are not on the board; both stay reachable in the partner
 * alert controls, and a save here sends the stored settings back unchanged for them.
 */
const BOARD_EVENTS: Array<[PartnerAlertEvent, string]> = [
  ["lead_status_changed", "Lead status updates"],
  ["partner_message", "New messages"],
  ["team_access_changed", "Team invitation activity"],
];

/** US zones first, the way the agency's own settings list them; the stored zone is always offered. */
const TIMEZONES: Array<[string, string]> = [
  ["America/New_York", "Eastern Time (ET)"],
  ["America/Chicago", "Central Time (CT)"],
  ["America/Denver", "Mountain Time (MT)"],
  ["America/Phoenix", "Arizona (MST)"],
  ["America/Los_Angeles", "Pacific Time (PT)"],
  ["America/Anchorage", "Alaska Time (AKT)"],
  ["Pacific/Honolulu", "Hawaii Time (HT)"],
  ["UTC", "Coordinated Universal Time (UTC)"],
];

export function PartnerNotificationPreferences({
  timezone,
  canEditTimezone,
  onTimezoneSaved,
}: {
  timezone: string;
  canEditTimezone: boolean;
  onTimezoneSaved?: (timezone: string) => void;
}) {
  const [stored, setStored] = useState<PartnerAlertSettings | null>(null);
  const [draft, setDraft] = useState<PartnerAlertSettings | null>(null);
  // Null until the person picks one, so the stored zone (which arrives after mount) shows through.
  const [zoneDraft, setZoneDraft] = useState<string | null>(null);
  const zone = zoneDraft ?? timezone;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/partner/notifications", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { settings?: PartnerAlertSettings; error?: string } | null;
      if (!response.ok || !body?.settings) throw new Error(body?.error ?? "Notification preferences could not be loaded.");
      setStored(body.settings);
      setDraft(body.settings);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Notification preferences could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const zoneChanged = canEditTimezone && zone !== timezone;
  const eventsChanged = Boolean(draft && stored && BOARD_EVENTS.some(([event]) => draft.enabled_events[event] !== stored.enabled_events[event]));

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      if (eventsChanged) {
        const response = await fetch("/api/partner/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
        const body = await response.json().catch(() => null) as { settings?: PartnerAlertSettings; error?: string } | null;
        if (!response.ok || !body?.settings) throw new Error(body?.error ?? "Notification preferences could not be saved.");
        setStored(body.settings);
        setDraft(body.settings);
      }
      if (zoneChanged) {
        const response = await fetch("/api/partner/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: zone }) });
        const body = await response.json().catch(() => null) as { timezone?: string; error?: string } | null;
        if (!response.ok || !body?.timezone) throw new Error(body?.error ?? "The timezone could not be saved.");
        onTimezoneSaved?.(body.timezone);
        setZoneDraft(null);
      }
      notify.done("Notification preferences saved");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Notification preferences could not be saved.";
      setError(message);
      notify.fail(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <SectionLoading rows={3} columns={1} label="Loading notification preferences" />;
  if (!draft) return <p className="text-sm text-[var(--error-ink)]" role="alert">{error ?? "Notification preferences are unavailable."}</p>;

  const zones = TIMEZONES.some(([value]) => value === zone) ? TIMEZONES : [[zone, zone] as [string, string], ...TIMEZONES];

  return <div className="flex flex-col items-start gap-4">
    <div className="flex flex-col gap-2.5">
      {BOARD_EVENTS.map(([event, label]) => <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--body)]" key={event}>
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.enabled_events[event]} disabled={saving} onChange={(input) => setDraft({ ...draft, enabled_events: { ...draft.enabled_events, [event]: input.target.checked } })} />
        {label}
      </label>)}
    </div>
    <label className="flex w-full flex-col gap-1.5">
      <span className="text-sm font-semibold text-[var(--body)]">Timezone</span>
      <select className={cn(toolbarControl, "w-full")} value={zone} disabled={!canEditTimezone || saving} onChange={(event) => setZoneDraft(event.target.value)}>
        {zones.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {!canEditTimezone && <small className="text-xs text-muted-foreground">Your partner admin sets the timezone your submission dates are read in.</small>}
    </label>
    {error && <p className="text-sm text-[var(--error-ink)]" role="alert">{error}</p>}
    <Button type="button" onClick={() => void save()} disabled={saving || (!eventsChanged && !zoneChanged)}>{saving ? "Saving…" : "Save notification preferences"}</Button>
  </div>;
}
