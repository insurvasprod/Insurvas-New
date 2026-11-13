"use client";

/**
 * Settings › My profile › Alerts (LA-8.4, Notion sprint): per event, per channel, a digest for the
 * high-volume ones, quiet hours — and four alerts that cannot be switched off, shown locked with the
 * reason rather than hidden, because someone who cannot find why an email keeps arriving assumes the
 * setting is broken.
 *
 * Settings round 8, board A (owner pick 2026-11-12): the alerts table is part of My profile's one page
 * and saves with its ONE save bar — each switch used to save on its own, a second way to save on the
 * same page. useAlertsDraft holds the draft (quiet hours + every alert's channels); AlertsSection draws
 * it: quiet hours on one line, a filter (All / Off / Always on, a group, a search) and one line per alert.
 *
 * Draws whatever the registry (lib/notifications/events.ts) holds; a new event needs no change here.
 */

import { useEffect, useState } from "react";

import { SaveFoot, Seg, StatusLine } from "@/components/app/settings/business/indexed-form";
import { control, LockIcon, SettingsCard, SettingsSectionHeader, SettingsStack, st, Switch } from "@/components/app/settings/primitives";
import { cardSurface } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { NOTIFICATION_GROUPS, type DigestCadence } from "@/lib/notifications/events";

type Channel = "in_app" | "email" | "push";
type Delivery = { in_app: boolean; email: boolean; push: boolean; digest: DigestCadence; protected: boolean };
type EventView = {
  key: string; label: string; description: string; group: (typeof NOTIFICATION_GROUPS)[number];
  supportsDigest: boolean; protected: boolean; protectedReason: string | null;
  delivery: Delivery;
};
type Quiet = { enabled: boolean; start: string; end: string };
type View = { available: boolean; timeZone: string | null; quiet: Quiet; events: EventView[] };
type Filter = "all" | "off" | "locked";

/** The board's column order: In app · Browser · Email. */
const CHANNELS: { key: Channel; label: string }[] = [
  { key: "in_app", label: "In app" },
  { key: "push", label: "Browser" },
  { key: "email", label: "Email" },
];
const DIGEST_LABELS: Record<DigestCadence, string> = { immediate: "Right away", daily: "Daily digest", weekly: "Weekly digest", off: "No email" };
/** The email choices once email is on; turning email off is the switch. */
const DIGEST_CHOICES: DigestCadence[] = ["immediate", "daily", "weekly"];
const STICKY_TH = "sticky top-0 z-10 bg-[var(--surface-alt)]";

const isOff = (e: EventView) => !e.protected && !e.delivery.in_app && !e.delivery.email && !e.delivery.push;
const sameDelivery = (a: Delivery, b: Delivery) => a.in_app === b.in_app && a.email === b.email && a.push === b.push && a.digest === b.digest;

export type AlertsDraft = ReturnType<typeof useAlertsDraft>;

export function useAlertsDraft() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery>>({});
  const [quiet, setQuiet] = useState<Quiet | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/notification-preferences", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) { setError(body?.error ?? "Your alert choices could not be read."); return; }
      setView(body);
      setQuiet(body.quiet);
      setDeliveries({});
    }).catch(() => { if (live) setError("Your alert choices could not be read."); });
    return () => { live = false; };
  }, []);

  // The table as drafted: each alert with the delivery chosen on screen.
  const events: EventView[] = (view?.events ?? []).map((e) => (deliveries[e.key] ? { ...e, delivery: deliveries[e.key] } : e));
  const changedKeys = (view?.events ?? []).filter((e) => deliveries[e.key] && !sameDelivery(deliveries[e.key], e.delivery)).map((e) => e.key);
  const quietChanged = Boolean(view && quiet && (quiet.enabled !== view.quiet.enabled || quiet.start !== view.quiet.start || quiet.end !== view.quiet.end));
  const count = changedKeys.length + (quietChanged ? 1 : 0);

  const setDelivery = (key: string, patch: Partial<Delivery>) => {
    const base = events.find((e) => e.key === key);
    if (!base || base.protected) return;
    setDeliveries((current) => ({ ...current, [key]: { ...base.delivery, ...patch } }));
  };
  const discard = () => { setDeliveries({}); if (view) setQuiet(view.quiet); };

  /** Saves every changed alert and quiet hours; resolves to the problems (empty when all saved). */
  async function save(): Promise<string[]> {
    if (!view || !view.available) return [];
    const problems: string[] = [];
    const latest: { view: View | null } = { view: null };
    const failed = new Set<string>();
    const put = async (body: Record<string, unknown>): Promise<string | null> => {
      const res = await fetch("/api/app/notification-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const result = await res?.json().catch(() => null);
      if (!res?.ok) return result?.error ?? "That could not be saved. Nothing changed.";
      latest.view = result as View;
      return null;
    };
    for (const key of changedKeys) {
      const before = view.events.find((e) => e.key === key)!.delivery;
      const after = deliveries[key];
      const patch: Record<string, unknown> = {};
      for (const field of ["in_app", "email", "push", "digest"] as const) if (after[field] !== before[field]) patch[field] = after[field];
      const problem = await put({ event_key: key, ...patch });
      if (problem) { problems.push(problem); failed.add(key); }
    }
    let quietFailed = false;
    if (quietChanged && quiet) {
      const problem = await put({ quiet });
      if (problem) { problems.push(problem); quietFailed = true; }
    }
    const fresh = latest.view;
    if (fresh) {
      setView(fresh);
      // What did not save stays a draft; everything else now matches the server.
      setDeliveries((current) => Object.fromEntries(Object.entries(current).filter(([key]) => failed.has(key))));
      if (!quietFailed) setQuiet(fresh.quiet);
    }
    return problems;
  }

  const switchedOff = events.filter(isOff).length;
  const notes = [error, view && !view.available ? "alerts need a database update" : null].filter(Boolean) as string[];
  return { view, error, events, quiet, setQuiet, setDelivery, changedKeys, quietChanged, count, switchedOff, notes, discard, save };
}

/** Quiet hours on one line, the filter, and the alerts table — inside My profile's one card. */
export function AlertsSection({ alerts, disabled = false }: { alerts: AlertsDraft; disabled?: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [group, setGroup] = useState<string>("");
  const [find, setFind] = useState("");
  const { view, quiet, events } = alerts;

  if (alerts.error) return <p className="m-0 text-sm text-[var(--error-ink)]">{alerts.error}</p>;
  if (!view || !quiet) return <SectionLoading rows={6} columns={4} label="Loading your alerts" />;

  const locked = events.filter((e) => e.protected);
  const off = events.filter(isOff);
  const groups = NOTIFICATION_GROUPS.filter((g) => events.some((e) => e.group === g));
  const words = find.trim().toLowerCase();
  const shown = (filter === "all" ? events : filter === "locked" ? locked : off)
    .filter((e) => !group || e.group === group)
    .filter((e) => !words || `${e.label} ${e.description} ${e.group}`.toLowerCase().includes(words));
  const readOnly = disabled || !view.available;

  const row = (e: EventView) => {
    const changed = alerts.changedKeys.includes(e.key);
    return (
      <tr key={e.key} id={`notify-${e.key}`} className={cn(changed && "[&>td]:bg-[var(--primary-soft)]")}>
        <td className={cn(st.td, "max-w-[360px] whitespace-nowrap")}>
          <span className="flex min-w-0 items-center gap-1.5 text-[var(--ink)]">
            <span className="min-w-0 truncate">{e.label}</span>
            {e.protected ? <span className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-badge border border-[var(--border)] px-2 text-xs font-medium text-[var(--muted)]"><LockIcon />Always on</span> : null}
            <InfoTip label={`About ${e.label.toLowerCase()}`}>{e.protected && e.protectedReason ? `Cannot be switched off. ${e.protectedReason}` : e.description}</InfoTip>
          </span>
        </td>
        {CHANNELS.map((c) => (
          <td key={c.key} className={cn(st.td, "whitespace-nowrap", c.key === "email" ? "text-left" : "text-center")} title={e.protected ? "This alert cannot be switched off" : undefined}>
            <span className={cn("inline-flex items-center gap-2", c.key !== "email" && "justify-center")}>
              <Switch checked={e.delivery[c.key]} disabled={e.protected || !view.available} label={`${e.label}: ${c.label}`}
                onChange={(next) => !disabled && alerts.setDelivery(e.key, c.key === "email" && next && e.delivery.digest === "off" ? { email: true, digest: "immediate" } : { [c.key]: next })} />
              {/* How email arrives sits beside its own switch, only while email is on. */}
              {c.key === "email" && e.supportsDigest && e.delivery.email ? (
                <select
                  aria-label={`${e.label}: how email arrives`}
                  disabled={readOnly}
                  value={e.delivery.digest === "off" ? "immediate" : e.delivery.digest}
                  onChange={(event) => alerts.setDelivery(e.key, { digest: event.target.value as DigestCadence, email: true })}
                  className="h-7 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-xs font-medium text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] disabled:opacity-50"
                >
                  {DIGEST_CHOICES.map((d) => <option key={d} value={d}>{DIGEST_LABELS[d]}</option>)}
                </select>
              ) : c.key === "email" && e.delivery.email ? <span className="text-xs text-[var(--muted)]">{DIGEST_LABELS.immediate}</span> : null}
            </span>
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {/* Quiet hours: one line. The times show only while it is on. */}
      <div id="notify-quiet-hours" className="flex min-h-9 scroll-mt-24 flex-wrap items-center gap-x-2.5 gap-y-2">
        <Switch checked={quiet.enabled} disabled={readOnly} label="Quiet hours" onChange={(next) => alerts.setQuiet({ ...quiet, enabled: next })} />
        <b className="text-sm font-semibold text-[var(--ink)]">Quiet hours</b>
        {quiet.enabled ? (
          <>
            <label className="sr-only" htmlFor="notify-quiet-start">Quiet from</label>
            <input id="notify-quiet-start" type="time" className={cn(control, "mt-0 h-8 w-auto text-xs")} value={quiet.start} disabled={readOnly} onChange={(e) => alerts.setQuiet({ ...quiet, start: e.target.value })} />
            <span className="text-xs text-[var(--muted)]">to</span>
            <label className="sr-only" htmlFor="notify-quiet-end">Quiet until</label>
            <input id="notify-quiet-end" type="time" className={cn(control, "mt-0 h-8 w-auto text-xs")} value={quiet.end} disabled={readOnly} onChange={(e) => alerts.setQuiet({ ...quiet, end: e.target.value })} />
            <span className="text-xs text-[var(--muted)]">{view.timeZone ? `${view.timeZone} · ` : ""}email and browser wait; Always on still comes through</span>
          </>
        ) : (
          <span className="text-xs text-[var(--muted)]">Off. Turn it on to hold email and browser alerts overnight.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg<Filter>
          label="Which alerts"
          size="xs"
          value={filter}
          onChange={setFilter}
          options={[
            { key: "all", label: `All ${events.length}` },
            { key: "off", label: `Off ${off.length}`, title: "Alerts you will not hear about" },
            { key: "locked", label: `Always on ${locked.length}`, title: "Missing one of these causes harm that cannot be undone, so they always reach you — through quiet hours too." },
          ]}
        />
        <span id="notify-protected" className="sr-only">Always on alerts cannot be switched off.</span>
        {groups.length > 1 ? (
          <select aria-label="Alert group" className={cn(control, "mt-0 h-8 w-auto text-xs")} value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">Every group</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        ) : null}
        <label className="sr-only" htmlFor="notify-find">Find an alert</label>
        <input id="notify-find" type="search" placeholder="Find an alert" className={cn(control, "mt-0 ml-auto h-8 w-[200px] text-xs")} value={find} onChange={(event) => setFind(event.target.value)} />
      </div>

      {/* The card's body would scroll sideways and so break the sticky header; four columns never need it. */}
      <TableCard bodyClassName="overflow-x-visible">
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th className={cn(st.th, STICKY_TH)}>Alert</th>
              {CHANNELS.map((c) => <th key={c.key} className={cn(st.th, STICKY_TH, c.key === "email" ? "w-[230px] text-left" : "w-[96px] text-center")}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(row)}
            {shown.length === 0 ? <tr><td colSpan={4} className={cn(st.td, "text-center text-[var(--muted)]")}>No alerts match.</td></tr> : null}
          </tbody>
        </table>
      </TableCard>
    </div>
  );
}

/** Alerts on a page of their own (outside My profile): the same draft and one save bar. */
export function NotificationPreferences({ embedded = false }: { embedded?: boolean } = {}) {
  const alerts = useAlertsDraft();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const header = embedded ? null : <SettingsSectionHeader />;
  if (!alerts.view && !alerts.error) return <SettingsStack>{header}<SettingsCard><SectionLoading rows={6} columns={4} label="Loading your alerts" /></SettingsCard></SettingsStack>;
  const save = async () => {
    setSaving(true);
    const problems = await alerts.save();
    setSaving(false);
    setProblem(problems.length ? problems.join(" ") : null);
    if (!problems.length) notify.done("Alerts saved");
  };
  return (
    <SettingsStack className="gap-3">
      {header}
      <StatusLine tone={problem || alerts.error ? "danger" : alerts.count || alerts.notes.length ? "warning" : "good"}>
        {problem ?? (alerts.count ? `${alerts.count} unsaved ${alerts.count === 1 ? "change" : "changes"}` : alerts.notes[0] ?? "Saved")}
      </StatusLine>
      <section className={cn(cardSurface, "flex min-w-0 flex-col overflow-hidden")}>
        <div className="p-4"><AlertsSection alerts={alerts} disabled={saving} /></div>
        <SaveFoot count={alerts.count} what="alerts" saving={saving} onDiscard={alerts.discard} onSave={() => void save()} />
      </section>
    </SettingsStack>
  );
}
