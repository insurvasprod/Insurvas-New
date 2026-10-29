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
import { SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
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
const CHIP = (on: boolean) => cn(
  "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]",
);

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
          <td key={c.key} className={cn(st.td, "text-center")} title={e.protected ? "This alert cannot be switched off" : undefined}>
            <span className="inline-flex justify-center">
              <Switch checked={e.delivery[c.key]} disabled={busy || e.protected || !view.available} label={`${e.label}: ${c.label}`}
                onChange={(next) => void save({ event_key: e.key, [c.key]: next }, `${e.label}: ${c.label.toLowerCase()} ${next ? "on" : "off"}`)} />
            </span>
          </td>
        ))}
        <td className={st.td}>
          {e.supportsDigest ? (
            <span role="group" aria-label={`${e.label}: how email arrives`} className="flex flex-wrap gap-1">
              {(Object.keys(DIGEST_LABELS) as DigestCadence[]).map((d) => {
                const current = e.delivery.email ? e.delivery.digest : "off";
                return (
                  <button key={d} type="button" aria-pressed={current === d} disabled={busy || !view.available} className={CHIP(current === d)}
                    onClick={() => current !== d && void save({ event_key: e.key, digest: d, email: d !== "off" }, `${e.label}: ${DIGEST_LABELS[d].toLowerCase()}`)}>
                    {DIGEST_LABELS[d]}
                  </button>
                );
              })}
            </span>
          ) : <span className="text-xs text-[var(--muted)]">{e.delivery.email ? "Each one, as it happens" : "No email"}</span>}
        </td>
      </tr>
    );
  };

  return (
    <SettingsStack>
      {header}
      {!view.available ? <Callout tone="warning" title="Saving notification preferences needs a database update." /> : null}

      <SettingsCard title="Quiet hours" info={`No email or browser alerts between these times${view.timeZone ? ` (${view.timeZone})` : ""}. Held emails go when they end; the alerts marked Always on still come through.`}>
        <div id="notify-quiet-hours" className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={quiet.enabled} disabled={busy || !view.available} label="Quiet hours" onChange={(next) => saveQuiet({ ...quiet, enabled: next })} />
            Quiet hours
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">From
            <input type="time" className={`${control} mt-0 w-auto`} value={quiet.start} disabled={busy || !quiet.enabled} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} onBlur={() => saveQuiet(quiet)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Until
            <input type="time" className={`${control} mt-0 w-auto`} value={quiet.end} disabled={busy || !quiet.enabled} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} onBlur={() => saveQuiet(quiet)} />
          </label>
          <span className="pb-2 text-xs text-[var(--muted)]">Saved as you change it.</span>
        </div>
      </SettingsCard>

      <TableCard
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")} className={CHIP(filter === "all")}>All<span className="tabular-nums opacity-70">{view.events.length}</span></button>
            {groups.map((group) => (
              <button key={group} type="button" aria-pressed={filter === group} onClick={() => setFilter(group)} className={CHIP(filter === group)}>
                {group}<span className="tabular-nums opacity-70">{view.events.filter((e) => e.group === group).length}</span>
              </button>
            ))}
            {locked.length ? (
              <button id="notify-protected" type="button" aria-pressed={filter === "locked"} onClick={() => setFilter("locked")} className={CHIP(filter === "locked")}
                title="Missing one of these causes harm that cannot be undone, so they always reach you — through quiet hours too.">
                <LockIcon />Always on<span className="tabular-nums opacity-70">{locked.length}</span>
              </button>
            ) : null}
            {switchedOff ? <span className="ml-auto text-xs text-[var(--warning-ink)]">{switchedOff} switched off</span> : null}
          </div>
        }
      >
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th className={st.th}>Alert</th>
              {CHANNELS.map((c) => <th key={c.key} className={cn(st.th, "w-[104px] text-center")}>{c.label}</th>)}
              <th className={cn(st.th, "w-[340px]")}>Email as</th>
            </tr>
          </thead>
          <tbody>{shown.map(row)}</tbody>
        </table>
      </TableCard>
    </SettingsStack>
  );
}
