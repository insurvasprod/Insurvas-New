"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";

import { InfoTip } from "@/components/ui/info-tip";

import { getSoundPreferences, previewTreatment, saveSoundPreferences } from "@/lib/notify/sound";
import { AUDIBLE, AUDIBLE_BY_DEFAULT, TREATMENT_LABELS, type Treatment } from "@/lib/notify/treatments";
import type { AgentAlertSettings, AudibleTreatment } from "@/lib/agentAlerts/presentation";

/**
 * Which sounds this person hears, and a way to hear each one before deciding.
 *
 * This replaces PortalSoundControls on the agent plane rather than sitting beside it. That control
 * carried its own mute, do-not-disturb and volume in localStorage, directly beneath the
 * server-stored mute, do-not-disturb and volume in the panel above — two sets of switches with the
 * same names governing different things, which is worse than either alone. The master controls stay
 * where they are; this adds only what was missing, which is *which* events are worth a noise.
 *
 * The preview buttons matter more than they look. Nobody can choose between four sounds they have
 * never heard from a list of adjectives, and a sound you cannot audition is one you turn off.
 */
export function NotificationSoundSettings({
  settings,
  save,
  saving = false,
}: {
  /**
   * The server-stored settings this panel writes into, where there are any.
   *
   * Optional because the partner plane has its own settings shape and no storage for per-treatment
   * choices. There the panel is local-only — which is still worth having, because it governs the
   * sound those people actually hear.
   */
  settings?: AgentAlertSettings;
  save?: (next: AgentAlertSettings) => void;
  saving?: boolean;
  /** Undefined until the first poll answers. Only an explicit `false` is worth saying out loud. */
  persisted?: boolean;
}) {
  // Read from the same place the sound layer reads from, never from the server response directly.
  // Anything else lets the panel show one answer while the product plays another — and while the
  // storage column is still pending, the server's answer is `{}` for everyone.
  const [chosen, setChosen] = useState<Partial<Record<AudibleTreatment, boolean>>>({});
  useEffect(() => {
    const sync = () => setChosen(getSoundPreferences().enabled as Partial<Record<AudibleTreatment, boolean>>);
    sync();
    // The server writes into that store on every poll, so the panel has to hear about it.
    window.addEventListener("insurvas:notify-sound-settings", sync);
    return () => window.removeEventListener("insurvas:notify-sound-settings", sync);
  }, []);

  // A missing key is "no opinion", not "off" — so changing a default later still reaches everyone
  // who never touched the setting.
  const isOn = (treatment: Treatment) =>
    chosen[treatment as AudibleTreatment] ?? AUDIBLE_BY_DEFAULT.includes(treatment);

  const toggle = (treatment: Treatment) => {
    const next = { ...chosen, [treatment as AudibleTreatment]: !isOn(treatment) };
    // Local first, so the switch takes effect on the next sound whether or not the write lands.
    saveSoundPreferences({ ...getSoundPreferences(), enabled: next });
    setChosen(next);
    // Then durably, where there is somewhere durable to put it.
    if (settings && save) save({ ...settings, sound_treatments: next });
  };

  return (
    <div className="portal-notify-sound-settings border-t border-[var(--color-border)] pt-3">
      <p className="flex items-center gap-1.5 font-semibold">
        Which events make a sound
        <InfoTip label="About sounds">Sound is always off while you are on a call, except for compliance blocks. Routine saves and system faults never make a sound.</InfoTip>
      </p>

      {/* A control that silently forgets is worse than one that admits it cannot save yet. The
          storage for these choices is a pending migration; until it lands they apply to this
          browser only, and the toggles would otherwise snap back and simply look broken. */}

      <div className="space-y-1">
        {AUDIBLE.map((treatment) => (
          <div key={treatment} className="flex items-center justify-between gap-2 rounded px-1 py-1">
            <label className="min-w-0 flex-1 cursor-pointer" title={TREATMENT_LABELS[treatment].hint}>
              <span className="block text-sm">{TREATMENT_LABELS[treatment].label}</span>
            </label>
            <button
              type="button"
              // Plays regardless of whether the treatment is currently on: refusing to play the
              // sound someone just asked to hear is the kind of dead control that makes people
              // distrust the whole panel.
              onClick={() => previewTreatment(treatment)}
              aria-label={`Play the ${TREATMENT_LABELS[treatment].label.toLowerCase()} sound`}
              className="rounded border border-[var(--color-border)] p-1.5 hover:bg-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]"
            >
              <Play className="size-3.5" aria-hidden="true" />
            </button>
            <input
              type="checkbox"
              checked={isOn(treatment)}
              onChange={() => toggle(treatment)}
              disabled={saving}
              aria-label={`Sound for ${TREATMENT_LABELS[treatment].label.toLowerCase()}`}
              className="size-4 accent-[var(--brand-500)]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
