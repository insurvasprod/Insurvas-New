"use client";

import { useEffect, useRef, useState } from "react";

import { NOTIFY_OWNED_CLASS } from "@/lib/notify/sound";

export type PortalFeedbackKind = "success" | "failure" | "incoming";

export type PortalSoundSettings = {
  enabled: boolean;
  muted: boolean;
  doNotDisturb: boolean;
  volume: number;
};

const SETTINGS_KEY = "insurvas.portal-feedback.v1";
const DEFAULT_SETTINGS: PortalSoundSettings = {
  enabled: false,
  muted: false,
  doNotDisturb: false,
  volume: 70,
};

function clampVolume(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : DEFAULT_SETTINGS.volume;
}

export function getPortalSoundSettings(): PortalSoundSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<PortalSoundSettings>;
    return {
      enabled: stored.enabled === true,
      muted: stored.muted === true,
      doNotDisturb: stored.doNotDisturb === true,
      volume: clampVolume(stored.volume),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function savePortalSoundSettings(settings: PortalSoundSettings) {
  if (typeof window === "undefined") return;
  const next = { ...settings, volume: clampVolume(settings.volume) };
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("insurvas:portal-sound-settings", { detail: next }));
}

function audioContext() {
  if (typeof window === "undefined") return null;
  const Candidate = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Candidate ? new Candidate() : null;
}

/**
 * A short non-verbal vocabulary: completed work, failed work, and an incoming operational alert.
 * Sound is never the sole status signal; this is deliberately only a supplement to Sonner/ARIA UI.
 */
export function playPortalSound(kind: PortalFeedbackKind, settings = getPortalSoundSettings(), force = false) {
  if (!force && (!settings.enabled || settings.muted || settings.doNotDisturb || settings.volume === 0)) return;
  const context = audioContext();
  if (!context) return;
  const notes: Record<PortalFeedbackKind, number[]> = {
    success: [659.25, 783.99],
    failure: [293.66, 220],
    incoming: [523.25, 659.25],
  };
  const gainValue = Math.min(0.1, settings.volume / 1000);
  try {
    for (const [index, frequency] of notes[kind].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.09;
      oscillator.type = kind === "failure" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.12);
    }
    window.setTimeout(() => void context.close(), 260);
  } catch {
    void context.close();
  }
}

function kindFromToast(toast: Element): PortalFeedbackKind | null {
  const type = toast.getAttribute("data-type");
  if (type === "success") return "success";
  if (type === "error" || type === "warning") return "failure";
  if (type === "info" || type === "default") return "incoming";
  return null;
}

/** Bridges existing Sonner calls into optional audio without changing API mutation behavior. */
export function PortalFeedbackBridge({ ignoreDefaultToasts = false }: { ignoreDefaultToasts?: boolean }) {
  const heard = useRef(new WeakSet<Element>());

  useEffect(() => {
    function inspect(node: Node) {
      if (!(node instanceof Element)) return;
      const candidates = [node, ...Array.from(node.querySelectorAll("[data-sonner-toast]"))];
      for (const candidate of candidates) {
        if (!candidate.matches("[data-sonner-toast]") || heard.current.has(candidate)) continue;
        heard.current.add(candidate);
        // Toasts raised through `lib/notify` carry their own sound rules — which treatment this is,
        // whether a call is open, whether it has been rate limited — and none of that is legible
        // from `data-type`. Reading the colour off the DOM here would play a second sound that
        // contradicts them: a chime for every routine save, and one into a live call.
        if (candidate.classList.contains(NOTIFY_OWNED_CLASS)) continue;
        const kind = kindFromToast(candidate);
        if (ignoreDefaultToasts && kind === "incoming") continue;
        if (kind) playPortalSound(kind);
      }
    }
    const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(inspect)));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ignoreDefaultToasts]);

  return null;
}

export function PortalSoundControls({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState<PortalSoundSettings>(() => getPortalSoundSettings());
  const update = (patch: Partial<PortalSoundSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      savePortalSoundSettings(next);
      return next;
    });
  };

  return (
    <div className={compact ? "portal-sound-controls portal-sound-controls-compact" : "portal-sound-controls"}>
      <div className="portal-sound-controls-heading">
        <div>
          <p className="font-semibold">Sound feedback</p>
          <p className="text-xs text-muted-foreground">Optional tones for success, failed actions, and incoming alerts.</p>
        </div>
        <label className="portal-toggle"><span className="sr-only">Enable sound feedback</span><input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><span aria-hidden="true" /></label>
      </div>
      {settings.enabled && <div className="mt-3 space-y-3 text-sm">
        <label className="flex items-center justify-between gap-3"><span>Mute sound</span><input type="checkbox" checked={settings.muted} onChange={(event) => update({ muted: event.target.checked })} /></label>
        <label className="flex items-center justify-between gap-3"><span>Do not disturb</span><input type="checkbox" checked={settings.doNotDisturb} onChange={(event) => update({ doNotDisturb: event.target.checked })} /></label>
        <label className="block">Volume <input className="mt-1 w-full accent-[var(--portal-primary)]" type="range" min="0" max="100" value={settings.volume} onChange={(event) => update({ volume: Number(event.target.value) })} /></label>
        <button type="button" className="portal-secondary-button" onClick={() => playPortalSound("success", settings, true)}>Test sound</button>
      </div>}
    </div>
  );
}
