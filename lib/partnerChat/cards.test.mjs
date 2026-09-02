import assert from "node:assert/strict";
import test from "node:test";
import { cardTitle, parsePartnerMessage } from "./cards.ts";

test("unknown or future card types remain readable as plain text", () => {
  const parsed = parsePartnerMessage({
    id: "message-1",
    channel_id: "channel-1",
    partner_id: "partner-1",
    work_item_id: null,
    message: "A newer notification is available.",
    message_kind: "system_card",
    card_type: "future_card_type",
    card_payload: { unsupported: true },
    created_by: null,
    created_at: "2026-09-03T12:00:00.000Z",
  });

  assert.equal(parsed?.messageKind, "text");
  assert.equal(parsed?.cardType, null);
  assert.equal(parsed?.message, "A newer notification is available.");
  assert.equal(parsed && cardTitle(parsed), "Message");
});
