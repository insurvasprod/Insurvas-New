"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/lib/notify";

import type { TopBarAlert, TopBarFeed, TopBarNotification } from "@/components/app/app-top-bar";
import { getPortalSoundSettings, playPortalSound, savePortalSoundSettings } from "@/components/portal/portal-feedback-bridge";
import { SectionLoading } from "@/components/ui/page-states";
import { PARTNER_ALERT_EVENTS, type PartnerAlertEvent, type PartnerAlertSettings } from "@/lib/partnerAlerts/presentation";
import type { PartnerWorkspaceAlert } from "@/lib/partnerAlerts/workspaceAlerts";

/**
 * The partner's feed, for the top bar.
 *
 * This used to be an "Alerts" button above every partner page title, with its own panel of
 * settings and nothing to read. p-nav-spec gives every shell the same bar, so the feed moved into
 * it: notifications (agent messages, lead status, account and team changes — addressed to the
 * person, cleared when read) behind the bell, organisation states behind the triangle, and these
 * same preferences — including the sound opt-in that is the partner's own — in the bar's
 * preferences panel. Polling, toasts and sound are unchanged.
 */

type PartnerAlert = { id: string; title: string; body: string; link: string; kind: PartnerAlertEvent; created_at: string };
type Response = { alerts: PartnerAlert[]; settings: PartnerAlertSettings; workspaceAlerts?: PartnerWorkspaceAlert[] };

const labels: Record<PartnerAlertEvent, string> = {
  partner_message: "Agent messages",
  lead_status_changed: "Lead status updates",
  partner_account_changed: "Account changes",
  team_access_changed: "Team access changes",
};

const TONE: Record<PartnerAlertEvent, TopBarNotification["tone"]> = {
  partner_message: "muted",
  lead_status_changed: "accent",
  partner_account_changed: "warning",
  team_access_changed: "accent",
};

function PartnerAlertPreferences({ settings, save }: { settings: PartnerAlertSettings | null; save: (next: PartnerAlertSettings) => Promise<void> }) {
  if (!settings) return <SectionLoading rows={4} columns={2} label="Loading your preferences" />;
  const local = getPortalSoundSettings();
  const setSound = (enabled: boolean) => {
    const next = { ...settings, sound_muted: !enabled, sound_opted_in_at: enabled ? settings.sound_opted_in_at ?? new Date().toISOString() : null };
    savePortalSoundSettings({ ...local, enabled, muted: !enabled, doNotDisturb: settings.do_not_disturb, volume: settings.sound_volume });
    void save(next);
  };
  return (
    <div className="portal-top-settings">
      {PARTNER_ALERT_EVENTS.map((event) => (
        <label key={event} className="portal-top-settings-row">
          <span>{labels[event]}</span>
          <input type="checkbox" checked={settings.enabled_events[event]} onChange={(input) => void save({ ...settings, enabled_events: { ...settings.enabled_events, [event]: input.target.checked } })} />
        </label>
      ))}
      <div className="portal-top-settings-group">
        <label className="portal-top-settings-row">
          <span>Do not disturb</span>
          <input type="checkbox" checked={settings.do_not_disturb} onChange={(input) => { const next = { ...settings, do_not_disturb: input.target.checked }; savePortalSoundSettings({ ...local, doNotDisturb: next.do_not_disturb }); void save(next); }} />
        </label>
        <label className="portal-top-settings-row">
          <span>Enable sounds</span>
          <input type="checkbox" checked={!settings.sound_muted} onChange={(input) => setSound(input.target.checked)} />
        </label>
        <label className="portal-top-settings-range">
          <span>Volume</span>
          <input aria-label="Alert volume" type="range" min="0" max="100" value={settings.sound_volume} onChange={(input) => { const next = { ...settings, sound_volume: Number(input.target.value) }; savePortalSoundSettings({ ...local, volume: next.sound_volume }); void save(next); }} />
        </label>
        <button type="button" className="portal-top-settings-button" onClick={() => playPortalSound("incoming", { ...getPortalSoundSettings(), enabled: true, muted: false, doNotDisturb: false, volume: settings.sound_volume }, true)}>
          Test sound
        </button>
      </div>
    </div>
  );
}

export function usePartnerTopBarFeed(): TopBarFeed {
  const [settings, setSettings] = useState<PartnerAlertSettings | null>(null);
  const [alerts, setAlerts] = useState<PartnerAlert[]>([]);
  const [workspaceAlerts, setWorkspaceAlerts] = useState<PartnerWorkspaceAlert[]>([]);
  const seen = useRef(new Set<string>());
  const initial = useRef(true);
  // A slow response must not let the next 12s tick stack a second request on top of it.
  const inFlight = useRef(false);
  // Ids marked read while a poll was in flight, so that poll's answer cannot bring them back.
  const cleared = useRef(new Set<string>());

  const save = useCallback(async (next: PartnerAlertSettings) => {
    const response = await fetch("/api/partner/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    const body = await response.json().catch(() => null) as { settings?: PartnerAlertSettings; error?: string } | null;
    if (!response.ok || !body?.settings) {
      notify.block(body?.error ?? "Alert settings could not be saved.");
      return;
    }
    setSettings(body.settings);
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/partner/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as Response;
      setSettings(body.settings);
      setAlerts(body.alerts.filter((alert) => !cleared.current.has(alert.id)));
      setWorkspaceAlerts(body.workspaceAlerts ?? []);
      if (initial.current) {
        body.alerts.forEach((alert) => seen.current.add(alert.id));
        initial.current = false;
        return;
      }
      const fresh = body.alerts.filter((alert) => !seen.current.has(alert.id));
      fresh.forEach((alert) => seen.current.add(alert.id));
      fresh.forEach((alert) => notify.arrive(alert.title, { detail: alert.body, action: { label: "Open", onClick: () => window.location.assign(alert.link) } }));
    } catch {
      // A later poll retries; alert delivery must never interrupt the portal workflow.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 12_000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(timer);
    };
  }, [load]);

  /** Optimistic, like the agent's: the badge drops now and the next poll confirms it. */
  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    ids.forEach((id) => cleared.current.add(id));
    setAlerts((current) => current.filter((alert) => !ids.includes(alert.id)));
    try {
      const response = await fetch("/api/partner/notifications", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!response.ok) throw new Error("mark read failed");
    } catch {
      ids.forEach((id) => cleared.current.delete(id));
      notify.fail("Those notifications could not be marked read. They will reappear on the next check.");
    }
  }, []);

  const notifications = useMemo<TopBarNotification[]>(
    () => [...alerts].reverse().map((alert) => ({ id: alert.id, title: alert.title, body: alert.body, link: alert.link, created_at: alert.created_at, tone: TONE[alert.kind] })),
    [alerts],
  );
  const barAlerts = useMemo<TopBarAlert[]>(() => workspaceAlerts.map((alert) => ({ ...alert })), [workspaceAlerts]);

  return {
    notifications,
    alerts: barAlerts,
    markRead,
    preferences: <PartnerAlertPreferences settings={settings} save={save} />,
    preferencesHint: "Which events reach you, and how",
    // No partner alert centre: every partner alert is a live state, drawn in full in the panel.
    alertCentreHref: null,
    notificationsEmptyBody: "Agent messages, lead status updates and changes to your account or team appear here as they happen.",
    alertsEmpty: {
      head: "Nothing is wrong with your organisation",
      body: "Paused submissions and a rising duplicate rate appear here.",
    },
  };
}
