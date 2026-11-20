import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { shouldRetrySend } from "./retry.ts";

test("a send the mail server refused, or that had no settings, is handed back for a later run", () => {
  assert.equal(shouldRetrySend({ delivered: false, reason: "provider_rejected" }), true);
  assert.equal(shouldRetrySend({ delivered: false, reason: "email_not_configured" }), true);
});

test("a sent email, or a deliberate skip, stays handled", () => {
  assert.equal(shouldRetrySend({ delivered: true }), false);
  assert.equal(shouldRetrySend({ delivered: false, reason: "reserved_test_recipient" }), false);
  assert.equal(shouldRetrySend({ delivered: false, reason: "email_delivery_disabled" }), false);
});

test("the outbox and the digests release their claim when a send fails, then stop the run", async () => {
  const source = await readFile("lib/notifications/outbox.ts", "utf8");
  const alert = source.slice(source.indexOf("export async function processOutbox"), source.indexOf("export async function sendDigests"));
  assert.match(alert, /shouldRetrySend\(result\)\) \{\s*[\s\S]*?update\(\{ email_handled_at: null \}\)\.eq\("id", row\.id\);\s*out\.retry \+= 1;\s*break;/);
  const digest = source.slice(source.indexOf("export async function sendDigests"), source.indexOf("export async function emitCredentialExpiry"));
  assert.match(digest, /shouldRetrySend\(result\)\) \{\s*[\s\S]*?update\(\{ sent_at: null \}\)\.in\("id", \[\.\.\.claimed\]\);\s*out\.retry \+= 1;\s*break;/);
  // The "last sent" time moves only after the send, so a failed digest is still due next run.
  assert.ok(digest.indexOf("user_notification_settings") > digest.indexOf("shouldRetrySend(result)"));
});
