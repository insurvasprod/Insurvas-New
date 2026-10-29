"use client";

/**
 * Settings › My profile › Notifications (LA-8.4, Notion sprint; redesign 2026-10-27, owner pick A):
 * per event, per channel, a digest for the high-volume ones, quiet hours — and four alerts that
 * cannot be switched off, shown locked with the reason rather than hidden, because someone who
 * cannot find why an email keeps arriving assumes the setting is broken.
 *
 * One table: an alert per row, a switch per channel, and an "Emails come" choice where a digest is
 * offered. The toolbar holds the group filter (plus "Always on") and quiet hours (compact pass
 * 2026-10-27: quiet hours was a card of its own above the table). Each switch and choice saves at
 * once; quiet hours saves with its own button, since its two times go together.
 *
 * Draws whatever the registry (lib/notifications/events.ts) holds; a new event needs no change here.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import { Callout, control, LockIcon, SettingsCard, SettingsSectionHeader, SettingsStack, st, Switch } from "@/components/app/settings/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
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
  { key: "push", label: "Pop-up" },
];
const DIGEST_LABELS: Record<DigestCadence, string> = { immediate: "One by one", daily: "Once a day", weekly: "Once a week", off: "No email" };
const CHIP = (on: boolean) => cn(
  "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]",
);

/** A phone-width screen: the alerts stack instead of sitting in five columns. */
const NARROW = "(max-width: 639px)";
function useNarrow() {
  return useSyncExternalStore(
    (onChange) => { const query = window.matchMedia(NARROW); query.addEventListener("change", onChange); return () => query.removeEventListener("change", onChange); },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/**
 * `embedded`: drawn inside My profile, whose header names the section. `onSaved`: My profile's tab
 * status counts the alerts that are on, so it is told after each change.
 */
export function NotificationPreferences({ embedded = false, onSaved }: { embedded?: boolean; onSaved?: (view: View) => void } = {}) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quiet, setQuiet] = useState<View["quiet"] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const narrow = useNarrow();
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/notification-preferences", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) { setError(body?.error ?? "Your notification preferences could not be read."); return; }
      setView(body);
      setQuiet(body.quiet);
    }, () => { if (live) setError("Your notification preferences could not be read. Check your connection."); });
    return () => { live = false; };
  }, [reads]);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/app/notification-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => null);
      if (!res.ok) { notify.fail(result?.error ?? "That could not be saved"); return; }
      setView(result);
      setQuiet(result.quiet);
      onSaved?.(result);
      notify.done(done);
    } finally {
      setBusy(false);
    }
  }

  const header = embedded ? null : <SettingsSectionHeader />;
  if (error) return <SettingsStack>{header}<Callout tone="error" title={error}><Button type="button" variant="outline" onClick={() => { setError(null); setReads((n) => n + 1); }}>Try again</Button></Callout></SettingsStack>;
  if (!view || !quiet) return <SettingsStack>{header}<SettingsCard><SectionLoading rows={6} columns={4} label="Loading your notification preferences" /></SettingsCard></SettingsStack>;

  const locked = view.events.filter((e) => e.protected);
  const groups = NOTIFICATION_GROUPS.filter((group) => view.events.some((e) => e.group === group));
  const shown = filter === "all" ? view.events : filter === "locked" ? locked : view.events.filter((e) => e.group === filter);
  const quietDirty = quiet.enabled !== view.quiet.enabled || quiet.start !== view.quiet.start || quiet.end !== view.quiet.end;
  const switchedOff = view.events.filter((e) => !e.protected && !e.delivery.in_app && !e.delivery.email && !e.delivery.push).length;

  // What an alert is, its channel switches and its email choice — drawn as a table row on a wide
  // screen and as a stacked block on a phone, where five columns did not fit (2026-10-27).
  const about = (e: EventView) => {
    const off = !e.protected && !e.delivery.in_app && !e.delivery.email && !e.delivery.push;
    return (
      <>
        <span className="flex flex-wrap items-center gap-1.5 font-semibold text-[var(--ink)]">
          {e.label}
          {e.protected ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-alt)] px-2 text-xs font-semibold text-[var(--muted)]"><LockIcon />Always on</span> : null}
        </span>
        <span className={st.sub}>{e.protected && e.protectedReason ? `Cannot be switched off. ${e.protectedReason}` : e.description}</span>
        {off ? <span className="block text-xs text-[var(--warning-ink)]">Off: you will not hear about this.</span> : null}
      </>
    );
  };
  const channel = (e: EventView, c: (typeof CHANNELS)[number]) => (
    <Switch checked={e.delivery[c.key]} disabled={busy || e.protected || !view.available} label={`${e.label}: ${c.label}`}
      onChange={(next) => void save({ event_key: e.key, [c.key]: next }, `${e.label}: ${c.label.toLowerCase()} ${next ? "on" : "off"}`)} />
  );
  const emails = (e: EventView) => <>{e.supportsDigest ? (
    // One 36px choice instead of four small chips (compact pass, 2026-10-27).
    <select
      aria-label={`${e.label}: emails come`}
      className={`${control} mt-0 w-[148px]`}
      value={e.delivery.email ? e.delivery.digest : "off"}
      disabled={busy || !view.available}
      onChange={(event) => { const d = event.target.value as DigestCadence; void save({ event_key: e.key, digest: d, email: d !== "off" }, `${e.label}: ${DIGEST_LABELS[d].toLowerCase()}`); }}
    >
      {(Object.keys(DIGEST_LABELS) as DigestCadence[]).map((d) => <option key={d} value={d}>{DIGEST_LABELS[d]}</option>)}
    </select>
  ) : <span className="text-xs text-[var(--muted)]">{e.delivery.email ? "One by one, as it happens" : "No email"}</span>}</>;

  const row = (e: EventView) => (
    <tr key={e.key} id={`notify-${e.key}`}>
      <td className={st.td}>{about(e)}</td>
      {CHANNELS.map((c) => (
        <td key={c.key} className={cn(st.td, "text-center")} title={e.protected ? "This alert cannot be switched off" : undefined}>
          <span className="inline-flex justify-center">{channel(e, c)}</span>
        </td>
      ))}
      <td className={st.td}>{emails(e)}</td>
    </tr>
  );

  const block = (e: EventView) => (
    <li key={e.key} id={`notify-${e.key}`} className="flex flex-col gap-2.5 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
      <div className="flex flex-col gap-0.5">{about(e)}</div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {CHANNELS.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-2 text-sm text-[var(--body)]">{channel(e, c)}<span aria-hidden="true">{c.label}</span></span>
        ))}
      </div>
      {e.supportsDigest || e.delivery.email ? <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]"><span aria-hidden="true">Emails come</span>{emails(e)}</div> : null}
    </li>
  );

  return (
    <SettingsStack>
      {header}
      {!view.available ? <Callout tone="warning" title="Saving notification preferences needs a database update." /> : null}

      <TableCard
        toolbar={
          <div className="flex flex-col gap-3">
          {/* Quiet hours, in the toolbar: the one setting that applies to every row below it. */}
          <div id="notify-quiet-hours" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <Switch checked={quiet.enabled} disabled={busy || !view.available} label="Quiet hours" onChange={(next) => setQuiet({ ...quiet, enabled: next })} />
            <span className="inline-flex items-center gap-1 font-semibold text-[var(--ink)]">
              Quiet hours
              <InfoTip label="About quiet hours">{`No emails or pop-ups between these times${view.timeZone ? ` (${view.timeZone})` : ""}. Held emails go when they end. Alerts marked Always on still come through.`}</InfoTip>
            </span>
            <label className="inline-flex items-center gap-1.5 text-[var(--muted)]">from
              <input type="time" className={`${control} mt-0 w-auto`} value={quiet.start} disabled={busy || !quiet.enabled} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} />
            </label>
            <label className="inline-flex items-center gap-1.5 text-[var(--muted)]">until
              <input type="time" className={`${control} mt-0 w-auto`} value={quiet.end} disabled={busy || !quiet.enabled} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} />
            </label>
            {quietDirty && <Button type="button" disabled={busy || !view.available} onClick={() => void save({ quiet }, "Quiet hours saved")}>Save quiet hours</Button>}
          </div>
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
          </div>
        }
      >
        {narrow ? <ul className="m-0 list-none p-0">{shown.map(block)}</ul> : (
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th className={st.th}>Alert</th>
              {CHANNELS.map((c) => (
                <th key={c.key} className={cn(st.th, "w-[104px] text-center")}>
                  {c.key === "push" ? <span className="inline-flex items-center gap-1">{c.label}<InfoTip label="About pop-ups">A pop-up on this computer, even when Insurvas is in another tab.</InfoTip></span> : c.label}
                </th>
              ))}
              <th className={cn(st.th, "w-[180px]")}>Emails come</th>
            </tr>
          </thead>
          <tbody>{shown.map(row)}</tbody>
        </table>
        )}
      </TableCard>
    </SettingsStack>
  );
}
