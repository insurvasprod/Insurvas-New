export const PARTNER_ALERT_EVENTS = [
  "partner_message",
  "lead_status_changed",
  "partner_account_changed",
  "team_access_changed",
] as const;

export type PartnerAlertEvent = (typeof PARTNER_ALERT_EVENTS)[number];

export type PartnerAlertSettings = {
  enabled_events: Record<PartnerAlertEvent, boolean>;
  do_not_disturb: boolean;
  sound_muted: boolean;
  sound_volume: number;
  sound_opted_in_at: string | null;
};

export const DEFAULT_PARTNER_ALERT_SETTINGS: PartnerAlertSettings = {
  enabled_events: {
    partner_message: true,
    lead_status_changed: true,
    partner_account_changed: true,
    team_access_changed: true,
  },
  do_not_disturb: false,
  sound_muted: true,
  sound_volume: 70,
  sound_opted_in_at: null,
};

export function settingsFromRow(row: Partial<PartnerAlertSettings> | null): PartnerAlertSettings {
  const enabled = { ...DEFAULT_PARTNER_ALERT_SETTINGS.enabled_events };
  if (row?.enabled_events && typeof row.enabled_events === "object") {
    for (const event of PARTNER_ALERT_EVENTS) {
      const value = row.enabled_events[event];
      if (typeof value === "boolean") enabled[event] = value;
    }
  }
  return {
    enabled_events: enabled,
    do_not_disturb: row?.do_not_disturb === true,
    sound_muted: row?.sound_muted !== false,
    sound_volume: typeof row?.sound_volume === "number" ? Math.max(0, Math.min(100, row.sound_volume)) : DEFAULT_PARTNER_ALERT_SETTINGS.sound_volume,
    sound_opted_in_at: typeof row?.sound_opted_in_at === "string" ? row.sound_opted_in_at : null,
  };
}
