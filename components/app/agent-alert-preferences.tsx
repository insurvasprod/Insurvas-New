"use client";

import { NotificationSoundSettings } from "@/components/app/notification-sound-settings";
import { AGENT_ALERT_EVENTS, type AgentAlertEvent, type AgentAlertSettings } from "@/lib/agentAlerts/presentation";

/**
 * An agent's notification preferences, drawn inside the top bar's preferences panel.
 *
 * Moved out of the bar unchanged when the bar stopped being agent-only: the partner and staff
 * shells draw their own preferences in the same panel, and the bar no longer needs to know what an
 * agent's events are called.
 */

const EVENT_LABELS: Record<AgentAlertEvent, string> = {
  new_lead: "New unclaimed leads",
  handoff_offered: "Handoffs offered to me",
  unclaimed_escalation: "Unclaimed escalations",
  callback_due: "Callbacks due",
  mentioned: "Mentions in notes or chat",
  partner_message: "Partner messages",
};

export type AgentAlertPreferencesFeed = {
  settings: AgentAlertSettings | null;
  saving: boolean;
  save: (next: AgentAlertSettings) => void | Promise<void>;
  setSettings: (next: AgentAlertSettings) => void;
  permission: NotificationPermission | "unsupported";
  requestBrowserAlerts: () => void | Promise<void>;
  soundTreatmentsPersisted?: boolean;
};

export function AgentAlertPreferences({ feed }: { feed: AgentAlertPreferencesFeed }) {
  const settings = feed.settings;
  if (!settings) {
    return (
      <div className="portal-top-empty">
        <p className="portal-top-empty-head">Loading your preferences</p>
        <p className="portal-top-empty-body">They appear as soon as the first check answers.</p>
      </div>
    );
  }
  return (
    <div className="portal-top-settings">
      <p className="portal-top-settings-note">These controls apply only to you.</p>
      {AGENT_ALERT_EVENTS.map((event) => (
        <label key={event} className="portal-top-settings-row">
          <span>{EVENT_LABELS[event]}</span>
          <input
            type="checkbox"
            checked={settings.enabled_events[event]}
            disabled={feed.saving}
            onChange={() => void feed.save({ ...settings, enabled_events: { ...settings.enabled_events, [event]: !settings.enabled_events[event] } })}
          />
        </label>
      ))}
      <div className="portal-top-settings-group">
        <label className="portal-top-settings-row">
          <span>Do not disturb</span>
          <input type="checkbox" checked={settings.do_not_disturb} disabled={feed.saving}
            onChange={() => void feed.save({ ...settings, do_not_disturb: !settings.do_not_disturb })} />
        </label>
        <label className="portal-top-settings-row">
          <span>Mute sound</span>
          <input type="checkbox" checked={settings.sound_muted} disabled={feed.saving}
            onChange={() => void feed.save({ ...settings, sound_muted: !settings.sound_muted })} />
        </label>
        <label className="portal-top-settings-range">
          <span>Volume</span>
          <input aria-label="Alert volume" type="range" min="0" max="100" value={settings.sound_volume}
            onChange={(event) => feed.setSettings({ ...settings, sound_volume: Number(event.target.value) })}
            onMouseUp={() => void feed.save(settings)}
            onKeyUp={() => void feed.save(settings)} />
        </label>
        <button
          type="button"
          disabled={feed.permission === "unsupported" || feed.permission === "granted"}
          onClick={() => void feed.requestBrowserAlerts()}
          className="portal-top-settings-button"
        >
          {feed.permission === "unsupported"
            ? "Browser alerts unavailable in this browser"
            : feed.permission === "denied"
              ? "Re-enable browser alerts in browser settings"
              : feed.permission === "granted"
                ? "Browser alerts are enabled"
                : "Enable browser alerts"}
        </button>
        <NotificationSoundSettings settings={settings} save={(next) => void feed.save(next)} saving={feed.saving} persisted={feed.soundTreatmentsPersisted} />
      </div>
    </div>
  );
}
