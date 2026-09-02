"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { AGENT_ALERT_EVENTS, coalesceAlertBatch, type AgentAlertEvent, type AgentAlertSettings } from "@/lib/agentAlerts/presentation";

type AgentAlert = { id: string; title: string; body: string; link: string; event_type: AgentAlertEvent; created_at: string };
type AlertResponse = { alerts: AgentAlert[]; settings: AgentAlertSettings };

const LABELS: Record<AgentAlertEvent, string> = {
  new_lead: "New unclaimed leads",
  handoff_offered: "Handoffs offered to me",
  unclaimed_escalation: "Unclaimed escalations",
  callback_due: "Callbacks due",
  mentioned: "Mentions in notes or chat",
  partner_message: "Partner messages",
};

function openAlert(alert: AgentAlert) { window.location.assign(alert.link); }

function playAlertSound(settings: AgentAlertSettings, eventType: AgentAlertEvent) {
  if (settings.do_not_disturb || settings.sound_muted || settings.sound_volume === 0 || typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = eventType === "new_lead" ? 880 : 660;
  gain.gain.value = Math.min(0.12, settings.sound_volume / 1000);
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + (eventType === "new_lead" ? 0.18 : 0.12));
  oscillator.addEventListener("ended", () => void context.close(), { once: true });
}

export function AgentAlertCenter() {
  const [settings, setSettings] = useState<AgentAlertSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [saving, setSaving] = useState(false);
  const seen = useRef(new Set<string>());
  const firstPoll = useRef(true);

  const deliver = useCallback((response: AlertResponse) => {
    setSettings(response.settings);
    if (firstPoll.current) {
      response.alerts.forEach((alert) => seen.current.add(alert.id));
      firstPoll.current = false;
      return;
    }
    const fresh = response.alerts.filter((alert) => !seen.current.has(alert.id));
    fresh.forEach((alert) => seen.current.add(alert.id));
    if (!fresh.length) return;
    const batch = coalesceAlertBatch(fresh);
    if (batch.playSound) playAlertSound(response.settings, fresh[0].event_type);
    fresh.forEach((alert) => {
      toast(alert.title, { description: alert.body, action: { label: "Open", onClick: () => openAlert(alert) } });
      if (response.settings.do_not_disturb || typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        const notification = new Notification(alert.title, { body: alert.body, tag: alert.id });
        notification.onclick = () => { window.focus(); openAlert(alert); };
      }
    });
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/app/notifications", { cache: "no-store" });
    if (!response.ok) return;
    deliver(await response.json() as AlertResponse);
  }, [deliver]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 2500);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [load]);

  async function requestBrowserAlerts() {
    if (typeof Notification === "undefined") { setPermission("unsupported"); return; }
    const next = await Notification.requestPermission();
    setPermission(next);
    if (next === "granted") toast.success("Browser alerts enabled");
    else if (next === "denied") toast.error("Browser alerts are blocked. Allow notifications for Insurvas in your browser settings, then try again.");
  }

  async function save(next: AgentAlertSettings) {
    setSaving(true);
    const response = await fetch("/api/app/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    setSaving(false);
    if (!response.ok) { toast.error("Alert settings could not be saved; your current choices are still shown."); return; }
    setSettings((await response.json() as { settings: AgentAlertSettings }).settings);
    toast.success("Alert settings saved");
  }

  if (!settings) return null;
  const toggle = (event: AgentAlertEvent) => void save({ ...settings, enabled_events: { ...settings.enabled_events, [event]: !settings.enabled_events[event] } });
  const dnd = settings.do_not_disturb;

  return <div className="relative z-20 mb-4 flex flex-wrap items-center justify-end gap-2">
    {dnd && <span role="status" className="rounded-full border border-amber-300/70 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">Do not disturb · alerts paused</span>}
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm font-medium shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-500)]">
      {dnd ? <BellOff className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />} Alerts {dnd ? "paused" : "on"}
    </button>
    {open && <section aria-label="Agent alert settings" className="absolute right-0 top-11 w-[min(23rem,calc(100vw-2rem))] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-[var(--color-card-foreground)] shadow-xl">
      <div className="mb-3 flex items-start justify-between gap-4"><div><h2 className="font-semibold">Alert settings</h2><p className="text-xs text-[var(--color-muted-foreground)]">These controls apply only to your alerts.</p></div><button type="button" aria-label="Close alert settings" onClick={() => setOpen(false)} className="rounded p-1 focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]"><Check className="size-4" aria-hidden="true" /></button></div>
      <div className="space-y-2">{AGENT_ALERT_EVENTS.map((event) => <label key={event} className="flex items-center justify-between gap-3 rounded px-1 py-1 text-sm"><span>{LABELS[event]}</span><input type="checkbox" checked={settings.enabled_events[event]} onChange={() => toggle(event)} disabled={saving} className="size-4 accent-[var(--brand-500)]" /></label>)}</div>
      <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-3 text-sm">
        <label className="flex items-center justify-between gap-3"><span>Do not disturb</span><input type="checkbox" checked={settings.do_not_disturb} onChange={() => void save({ ...settings, do_not_disturb: !settings.do_not_disturb })} disabled={saving} className="size-4 accent-[var(--brand-500)]" /></label>
        <label className="flex items-center justify-between gap-3"><span className="flex items-center gap-2">{settings.sound_muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}Mute sound</span><input type="checkbox" checked={settings.sound_muted} onChange={() => void save({ ...settings, sound_muted: !settings.sound_muted })} disabled={saving} className="size-4 accent-[var(--brand-500)]" /></label>
        <label className="block">Volume <input aria-label="Alert volume" type="range" min="0" max="100" value={settings.sound_volume} onChange={(event) => setSettings({ ...settings, sound_volume: Number(event.target.value) })} onMouseUp={() => void save(settings)} onKeyUp={() => void save(settings)} className="mt-1 w-full accent-[var(--brand-500)]" /></label>
        <button type="button" onClick={() => void requestBrowserAlerts()} className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-left text-sm hover:bg-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]">{permission === "denied" ? "Re-enable browser alerts in browser settings" : permission === "granted" ? "Browser alerts are enabled" : "Enable browser alerts"}</button>
        <button type="button" onClick={() => settings && playAlertSound(settings, "new_lead")} className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-left text-sm hover:bg-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]">Test new-lead sound</button>
      </div>
    </section>}
  </div>;
}
