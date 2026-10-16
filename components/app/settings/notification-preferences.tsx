"use client";

/**
 * Settings › Notifications (LA-8.4, Notion sprint): per event, per channel, a digest for the
 * high-volume ones, quiet hours — and four alerts that cannot be switched off, shown locked with the
 * reason rather than hidden, because someone who cannot find why an email keeps arriving assumes the
 * setting is broken.
 *
 * Draws whatever the registry (lib/notifications/events.ts) holds; a new event needs no change here.
 */

import { useEffect, useState } from "react";

import { Callout, control, LockIcon, SettingsCard, SettingsSectionHeader, SettingsStack, Switch } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { notify } from "@/lib/notify";
import { NOTIFICATION_GROUPS, type DigestCadence } from "@/lib/notifications/events";

type Channel = "in_app" | "email" | "push";
type EventView = {
  key: string; label: string; description: string; group: (typeof NOTIFICATION_GROUPS)[number];
  supportsDigest: boolean; protected: boolean; protectedReason: string | null;
  delivery: { in_app: boolean; email: boolean; push: boolean; digest: DigestCadence; protected: boolean };
};
type View = { available: boolean; timeZone: string | null; quiet: { enabled: boolean; start: string; end: string }; events: EventView[] };

const CHANNELS: { key: Channel; label: string }[] = [
  { key: "in_app", label: "In the app" },
  { key: "email", label: "Email" },
  { key: "push", label: "Browser" },
];
const DIGEST_LABELS: Record<DigestCadence, string> = { immediate: "Each one", daily: "Daily digest", weekly: "Weekly digest", off: "No email" };

export function NotificationPreferences() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quiet, setQuiet] = useState<View["quiet"] | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/notification-preferences", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) { setError(body?.error ?? "Your notification preferences could not be read."); return; }
      setView(body);
      setQuiet(body.quiet);
    });
    return () => { live = false; };
  }, []);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/app/notification-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => null);
      if (!res.ok) { notify.fail(result?.error ?? "That could not be saved"); return; }
      setView(result);
      setQuiet(result.quiet);
      notify.done(done);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <SettingsStack><SettingsSectionHeader /><Callout tone="error" title={error} /></SettingsStack>;
  if (!view || !quiet) return <SettingsStack><SettingsSectionHeader /><SettingsCard><SectionLoading rows={6} columns={4} label="Loading your notification preferences" /></SettingsCard></SettingsStack>;

  const open = view.events.filter((e) => !e.protected);
  const locked = view.events.filter((e) => e.protected);
  const quietDirty = quiet.enabled !== view.quiet.enabled || quiet.start !== view.quiet.start || quiet.end !== view.quiet.end;
  const row = (e: EventView) => (
    <li key={e.key} id={`notify-${e.key}`} className="grid gap-3 border-t border-[var(--border)] py-3 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
          {e.protected ? <span className="inline-flex text-[var(--muted)]" aria-hidden="true"><LockIcon /></span> : null}
          {e.label}
        </div>
        <div className="text-xs text-[var(--muted)]">{e.protected && e.protectedReason ? `Cannot be switched off. ${e.protectedReason}` : e.description}</div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {CHANNELS.map((c) => (
          <label key={c.key} className="flex items-center gap-2 text-xs text-[var(--body)]" title={e.protected ? "This alert cannot be switched off" : undefined}>
            <Switch checked={e.delivery[c.key]} disabled={busy || e.protected || !view.available} label={`${e.label}: ${c.label}`}
              onChange={(next) => void save({ event_key: e.key, [c.key]: next }, `${e.label}: ${c.label.toLowerCase()} ${next ? "on" : "off"}`)} />
            {c.label}
          </label>
        ))}
        {e.supportsDigest ? (
          <select aria-label={`${e.label}: how email arrives`} className={`${control} mt-0 w-auto`} disabled={busy || !view.available || !e.delivery.email && e.delivery.digest !== "off"}
            value={e.delivery.email ? e.delivery.digest : "off"} onChange={(ev) => void save({ event_key: e.key, digest: ev.target.value, email: ev.target.value !== "off" }, `${e.label}: ${DIGEST_LABELS[ev.target.value as DigestCadence].toLowerCase()}`)}>
            {(Object.keys(DIGEST_LABELS) as DigestCadence[]).map((d) => <option key={d} value={d}>{DIGEST_LABELS[d]}</option>)}
          </select>
        ) : null}
      </div>
    </li>
  );

  return (
    <SettingsStack>
      <SettingsSectionHeader />
      {!view.available ? <Callout tone="warning" title="Saving notification preferences needs a database update." /> : null}

      {NOTIFICATION_GROUPS.map((group) => {
        const events = open.filter((e) => e.group === group);
        if (!events.length) return null;
        return (
          <SettingsCard key={group} title={group}>
            <ul className="m-0 mt-3 flex list-none flex-col p-0">{events.map(row)}</ul>
          </SettingsCard>
        );
      })}

      {locked.length ? (
        <SettingsCard title="Cannot be switched off" sub="Missing one of these causes harm that cannot be undone, so they always reach you — through quiet hours too.">
          <ul id="notify-protected" className="m-0 mt-3 flex list-none flex-col p-0">{locked.map(row)}</ul>
        </SettingsCard>
      ) : null}

      <SettingsCard title="Quiet hours" sub={`No email or browser alerts between these times${view.timeZone ? ` (${view.timeZone})` : ""}. Held emails go when they end; the alerts above still come through.`}>
        <div id="notify-quiet-hours" className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={quiet.enabled} disabled={busy || !view.available} label="Quiet hours" onChange={(next) => setQuiet({ ...quiet, enabled: next })} />
            Quiet hours
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">From
            <input type="time" className={`${control} mt-0 w-auto`} value={quiet.start} disabled={busy || !quiet.enabled} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Until
            <input type="time" className={`${control} mt-0 w-auto`} value={quiet.end} disabled={busy || !quiet.enabled} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} />
          </label>
          <Button type="button" disabled={busy || !quietDirty || !view.available} onClick={() => void save({ quiet }, "Quiet hours saved")}>Save</Button>
        </div>
      </SettingsCard>
    </SettingsStack>
  );
}
