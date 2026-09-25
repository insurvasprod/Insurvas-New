/**
 * Opens the top bar's alert preferences from elsewhere on the page. Alert settings are per person
 * and have no page of their own, so the one place that points at them (Settings › Alerts) asks the
 * bar to open its panel instead of linking anywhere.
 */
export const OPEN_ALERT_SETTINGS_EVENT = "insurvas:open-alert-settings";

export function openAlertSettings() {
  window.dispatchEvent(new Event(OPEN_ALERT_SETTINGS_EVENT));
}
