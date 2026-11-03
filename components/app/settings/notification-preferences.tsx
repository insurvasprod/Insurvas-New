"use client";

/**
 * Settings › My profile › Notifications (LA-8.4, Notion sprint; redesign 2026-10-27, owner pick A):
 * per event, per channel, a digest for the high-volume ones, quiet hours — and four alerts that
 * cannot be switched off, shown locked with the reason rather than hidden, because someone who
 * cannot find why an email keeps arriving assumes the setting is broken.
 *
 * One table: an alert per row, a switch per channel, and "Email as" chips where a digest is offered;
 * quiet hours sit above it and a group filter (plus "Always on") narrows it. Each change saves.
 *
 * Draws whatever the registry (lib/notifications/events.ts) holds; a new event needs no change here.
 */

import { useEffect, useState } from "react";

import { Callout, control, LockIcon, SettingsCard, SettingsSectionHeader, SettingsStack, st, Switch } from "@/components/app/settings/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { NOTIFICATION_GROUPS, type DigestCadence } from "@/lib/notifications/events";

type Channel = "in_app" | "email" | "push";
type EventView = {
  key: string; label: string; description: string; group: (typeof NOTIFICATION_GROUPS)[number];
  supportsDigest: boolean; protected: boolean; protectedReason: string | null;
  delivery: { in_app: boolean; email: boolean; push: boolean; digest: DigestCadence; protected: boolean };
};
type View = { available: boolean; timeZone: string | null; quiet: { enabled: boolean; start: string; end: string }; events: EventView[] };
type Filter = "all" | "locked" | (typeof NOTIFICATION_GROUPS)[number];

const CHANNELS: { key: Channel; label: string }[] = [
  { key: "in_app", label: "In the app" },
  { key: "email", label: "Email" },
  { key: "push", label: "Browser" },
];
const DIGEST_LABELS: Record<DigestCadence, string> = { immediate: "Each one", daily: "Daily digest", weekly: "Weekly digest", off: "No email" };
/** Under the sticky chip bar (44px), so the column names stay in view too. */
const STICKY_TH = "sticky top-11 z-10 bg-[var(--surface)]";
/** The email choices once email is on; turning email off is the switch. */
const DIGEST_CHOICES: DigestCadence[] = ["immediate", "daily", "weekly"];

/** `embedded`: drawn inside My profile, whose header names the section. */
export function NotificationPreferences({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quiet, setQuiet] = useState<View["quiet"] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

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

  // One alert's switch or email choice: it moves at once and the table stays live (2026-10-29: every
  // click greyed the whole table until the server answered, and each one raised a toast). A save
  // that fails puts the row back and says so.
  async function saveEvent(key: string, delivery: Partial<EventView["delivery"]>, body: Record<string, unknown>) {
    const before = view;
    setView((current) => current && { ...current, events: current.events.map((e) => (e.key === key ? { ...e, delivery: { ...e.delivery, ...delivery } } : e)) });
    const res = await fetch("/api/app/notification-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_key: key, ...body }) }).catch(() => null);
    const result = await res?.json().catch(() => null);
    if (!res?.ok) { setView(before); notify.fail(result?.error ?? "That could not be saved"); }
  }

  const header = embedded ? null : <SettingsSectionHeader />;
  if (error) return <SettingsStack>{header}<Callout tone="error" title={error} /></SettingsStack>;
  if (!view || !quiet) return <SettingsStack>{header}<SettingsCard><SectionLoading rows={6} columns={4} label="Loading your notification preferences" /></SettingsCard></SettingsStack>;

  const locked = view.events.filter((e) => e.protected);
  const groups = NOTIFICATION_GROUPS.filter((group) => view.events.some((e) => e.group === group));
  const shown = filter === "all" ? view.events : filter === "locked" ? locked : view.events.filter((e) => e.group === filter);
  // Quiet hours save as they change, like every alert below (settings redesign R4: one save model per
  // tab). The switch saves on click; a time saves when you leave its field, once it differs.
  const saveQuiet = (next: View["quiet"]) => {
    setQuiet(next);
    const changed = next.enabled !== view.quiet.enabled || next.start !== view.quiet.start || next.end !== view.quiet.end;
    if (changed && view.available) void save({ quiet: next }, "Quiet hours saved");
  };
  const switchedOff = view.events.filter((e) => !e.protected && !e.delivery.in_app && !e.delivery.email && !e.delivery.push).length;

  const row = (e: EventView) => {
    const off = !e.protected && !e.delivery.in_app && !e.delivery.email && !e.delivery.push;
    return (
      <tr key={e.key} id={`notify-${e.key}`}>
        <td className={st.td}>
          <span className="flex flex-wrap items-center gap-1.5 font-semibold text-[var(--ink)]">
            {e.label}
            {e.protected ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-alt)] px-2 text-xs font-semibold text-[var(--muted)]"><LockIcon />Always on</span> : null}
          </span>
          <span className={st.sub}>{e.protected && e.protectedReason ? `Cannot be switched off. ${e.protectedReason}` : e.description}</span>
          {off ? <span className="block text-xs text-[var(--warning-ink)]">Off: you will not hear about this.</span> : null}
        </td>
        {CHANNELS.map((c) => (
          <td key={c.key} className={cn(st.td, c.key === "email" ? "text-left" : "text-center")} title={e.protected ? "This alert cannot be switched off" : undefined}>
            <span className={cn("inline-flex items-center gap-2", c.key !== "email" && "justify-center")}>
              <Switch checked={e.delivery[c.key]} disabled={e.protected || !view.available} label={`${e.label}: ${c.label}`}
                onChange={(next) => void saveEvent(e.key, { [c.key]: next }, { [c.key]: next })} />
              {/* How email arrives sits beside its own switch, only while email is on. */}
              {c.key === "email" && e.supportsDigest && e.delivery.email ? (
                <select
                  aria-label={`${e.label}: how email arrives`}
                  disabled={!view.available}
                  value={e.delivery.digest === "off" ? "immediate" : e.delivery.digest}
                  onChange={(event) => { const digest = event.target.value as DigestCadence; void saveEvent(e.key, { digest, email: true }, { digest, email: true }); }}
                  className="h-7 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-xs font-medium text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] disabled:opacity-50"
                >
                  {DIGEST_CHOICES.map((d) => <option key={d} value={d}>{DIGEST_LABELS[d]}</option>)}
                </select>
              ) : null}
            </span>
          </td>
        ))}
      </tr>
    );
  };

  return (
    <SettingsStack>
      {header}
      {!view.available ? <Callout tone="warning" title="Saving notification preferences needs a database update." /> : null}

      {/* Quiet hours: one line. The times appear only while it is on; the switch and each time save as they change. */}
      <div id="notify-quiet-hours" className="m-glass flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border border-[var(--border)] px-4 py-2">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
          <Switch checked={quiet.enabled} disabled={busy || !view.available} label="Quiet hours" onChange={(next) => saveQuiet({ ...quiet, enabled: next })} />
          Quiet hours
        </label>
        {quiet.enabled ? (
          <>
            <label className="flex items-center gap-2 text-sm text-[var(--body)]">From
              <input type="time" className={`${control} mt-0 h-8 w-auto`} value={quiet.start} disabled={busy} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} onBlur={() => saveQuiet(quiet)} />
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--body)]">Until
              <input type="time" className={`${control} mt-0 h-8 w-auto`} value={quiet.end} disabled={busy} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} onBlur={() => saveQuiet(quiet)} />
            </label>
          </>
        ) : (
          <span className="text-sm text-[var(--muted)]">Off. Turn it on to hold email and browser alerts overnight.</span>
        )}
        <span className="ml-auto inline-flex items-center">
          <InfoTip label="About quiet hours">{`No email or browser alerts between these times${view.timeZone ? ` (${view.timeZone})` : ""}. Held emails go when they end; the alerts marked Always on still come through.`}</InfoTip>
        </span>
      </div>

      {/* The filter chips stay in view while the table scrolls under them. */}
      <div className="sticky top-0 z-20 flex min-h-9 items-center gap-2 bg-[var(--canvas)]">
        <div role="radiogroup" aria-label="Which alerts" className="flex flex-wrap items-center gap-2">
          <ToggleChip role="radio" selected={filter === "all"} count={view.events.length} onClick={() => setFilter("all")}>All</ToggleChip>
          {groups.map((group) => (
            <ToggleChip key={group} role="radio" selected={filter === group} count={view.events.filter((e) => e.group === group).length} onClick={() => setFilter(group)}>
              {group}
            </ToggleChip>
          ))}
          {locked.length ? (
            <span id="notify-protected" className="inline-flex" title="Missing one of these causes harm that cannot be undone, so they always reach you — through quiet hours too.">
              <ToggleChip role="radio" selected={filter === "locked"} count={locked.length} onClick={() => setFilter("locked")}>
                <LockIcon />Always on
              </ToggleChip>
            </span>
          ) : null}
        </div>
        {switchedOff ? <span className="ml-auto text-xs text-[var(--warning-ink)]">{switchedOff} switched off</span> : null}
      </div>

      {/* The card's body would scroll sideways and so break a sticky header; four columns never need it. */}
      <TableCard bodyClassName="overflow-x-visible">
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th className={cn(st.th, STICKY_TH)}>Alert</th>
              {CHANNELS.map((c) => <th key={c.key} className={cn(st.th, STICKY_TH, c.key === "email" ? "w-[230px] text-left" : "w-[104px] text-center")}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>{shown.map(row)}</tbody>
        </table>
      </TableCard>
    </SettingsStack>
  );
}
