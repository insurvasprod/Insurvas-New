"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/lib/notify";

import { type AgentAlertEvent, type AgentAlertSettings } from "./presentation";
import { setServerSoundSettings } from "@/lib/notify/sound";

/**
 * One poller, two surfaces.
 *
 * The alert centre owned the polling, the toasts, the sound and the settings in a single
 * component, which was fine while it was the only thing that wanted them. The top bar wants the
 * same feed — and a second copy of this loop would mean two requests every 2.5 seconds and two
 * toasts per alert. Extracting it changes nothing about the behaviour and makes a second consumer
 * free.
 *
 * Mount this ONCE per page. Everything below is unchanged from the alert centre except that the
 * alert list is now returned rather than only announced.
 */

export type AgentAlert = {
  id: string;
  title: string;
  body: string;
  link: string;
  event_type: AgentAlertEvent;
  created_at: string;
};

type AlertResponse = { alerts: AgentAlert[]; settings: AgentAlertSettings; soundTreatmentsPersisted?: boolean };

function openAlert(alert: AgentAlert) {
  window.location.assign(alert.link);
}

export function useAgentAlertFeed() {
  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [settings, setSettings] = useState<AgentAlertSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [saving, setSaving] = useState(false);
  // Undefined until the first poll answers; the panel only warns on an explicit false.
  const [soundTreatmentsPersisted, setSoundTreatmentsPersisted] = useState<boolean | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const firstPoll = useRef(true);

  const deliver = useCallback((response: AlertResponse) => {
    setSettings(response.settings);
    // Do-not-disturb and volume are already stored per user and already have controls. Handing them
    // to the notification sound layer means those controls govern every sound in the product rather
    // than only the alert-centre ones — otherwise a muted agent still hears the dialer.
    // Only an explicit false means the column is missing; undefined is an older response shape.
    setServerSoundSettings(response.settings, response.soundTreatmentsPersisted !== false);
    setSoundTreatmentsPersisted(response.soundTreatmentsPersisted);
    setAlerts(response.alerts);
    if (firstPoll.current) {
      // The first poll is the backlog, not news. Announcing it would greet every page load with a
      // stack of toasts for things the person already knows about.
      response.alerts.forEach((alert) => seen.current.add(alert.id));
      firstPoll.current = false;
      return;
    }
    const fresh = response.alerts.filter((alert) => !seen.current.has(alert.id));
    fresh.forEach((alert) => seen.current.add(alert.id));
    if (!fresh.length) return;
    // The sound used to be played here, separately, through the legacy portal player. Now that
    // these toasts are `arrive`, the notification layer plays it — and playing both would give one
    // alert two different sounds, from two systems with different mute rules, which is the exact
    // problem the vocabulary was built to end.
    //
    // Coalescing is still honoured: `notify` rate-limits to one sound per 2s, so a burst of six
    // alerts is six toasts and one chime, which is what coalesceAlertBatch was doing by hand.
    fresh.forEach((alert) => {
      notify.arrive(alert.title, { detail: alert.body, action: { label: "Open", onClick: () => openAlert(alert) } });
      if (response.settings.do_not_disturb || typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        // Browser/lock-screen notifications intentionally avoid lead, policy, and account details.
        // The authenticated in-portal toast remains the detailed surface.
        const notification = new Notification("Insurvas alert", { body: "You have a new portal alert.", tag: alert.id });
        notification.onclick = () => { window.focus(); openAlert(alert); };
      }
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/app/notifications", { cache: "no-store" });
      if (!response.ok) return;
      deliver((await response.json()) as AlertResponse);
    } catch {
      // Alerts are supplemental UI; a transient poll failure must not create an unhandled
      // rejection or take down the rest of the workspace. The next poll retries automatically.
    }
  }, [deliver]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 2500);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [load]);

  const requestBrowserAlerts = useCallback(async () => {
    if (typeof Notification === "undefined") { setPermission("unsupported"); return; }
    try {
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next === "granted") notify.done("Browser alerts enabled");
      else if (next === "denied") notify.block("Browser alerts are blocked. Allow notifications for Insurvas in your browser settings, then try again.");
    } catch {
      notify.fail("Browser alerts could not be enabled in this browser.");
    }
  }, []);

  const save = useCallback(async (next: AgentAlertSettings) => {
    setSaving(true);
    try {
      const response = await fetch("/api/app/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!response.ok) { notify.block("Alert settings could not be saved; your current choices are still shown."); return; }
      setSettings(((await response.json()) as { settings: AgentAlertSettings }).settings);
      notify.done("Alert settings saved");
    } catch {
      notify.fail("Alert settings could not be saved; your current choices are still shown.");
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Mark exactly these read. Always by id: the endpoint reads an empty list as "everything", and
   * everything includes the workspace alerts, which clear when the queue is fixed, never when read.
   *
   * Optimistic: the badge drops immediately, and the next poll confirms it. `keepalive` because the
   * usual caller is a notification being opened, which navigates away before the response lands.
   */
  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const clearing = new Set(ids);
    setAlerts((current) => current.filter((alert) => !clearing.has(alert.id)));
    try {
      await fetch("/api/app/notifications", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    } catch {
      notify.fail("Those notifications could not be marked read. They will reappear on the next check.");
    }
  }, []);

  return { alerts, settings, setSettings, saving, save, permission, requestBrowserAlerts, markRead, soundTreatmentsPersisted };
}
