import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PARTNER_ALERT_SETTINGS, PARTNER_ALERT_EVENTS, settingsFromRow } from "./presentation.ts";

test("partner alerts start visually enabled but audio remains explicit opt-in", () => {
  assert.equal(DEFAULT_PARTNER_ALERT_SETTINGS.sound_muted, true);
  assert.equal(DEFAULT_PARTNER_ALERT_SETTINGS.sound_opted_in_at, null);
  assert.deepEqual(PARTNER_ALERT_EVENTS, ["partner_message", "lead_status_changed", "partner_account_changed", "team_access_changed"]);
});

test("partner alert settings ignore malformed event values and clamp volume", () => {
  const settings = settingsFromRow({
    enabled_events: { partner_message: false, team_access_changed: "yes" },
    sound_muted: false,
    sound_volume: 140,
    do_not_disturb: true,
  });

  assert.equal(settings.enabled_events.partner_message, false);
  assert.equal(settings.enabled_events.team_access_changed, true);
  assert.equal(settings.sound_volume, 100);
  assert.equal(settings.sound_muted, false);
  assert.equal(settings.do_not_disturb, true);
});
