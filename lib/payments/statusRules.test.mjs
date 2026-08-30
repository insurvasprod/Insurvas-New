// Run with: npm test
//
// The mode indicator is the whole point of the SA-4.2 screen: it is what tells somebody whether
// the platform is about to move real customer money. Getting it wrong in the safe direction is
// annoying; getting it wrong in the other direction is a live transaction nobody meant to make.
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveMode, maskSecret, MODE_COPY, WHOP_SANDBOX_HOST } from "./statusRules.ts";

test("the sandbox host is the ONLY thing that reads as sandbox", () => {
  assert.equal(deriveMode(`https://${WHOP_SANDBOX_HOST}/api/v1`), "sandbox");
  assert.equal(deriveMode(`https://${WHOP_SANDBOX_HOST}`), "sandbox");
  assert.equal(deriveMode(`HTTPS://SANDBOX-API.WHOP.COM/api/v1`), "sandbox", "host compare is case-insensitive");
});

test("any other whop host is production", () => {
  assert.equal(deriveMode("https://api.whop.com/api/v1"), "production");
  assert.equal(deriveMode("https://whop.com"), "production");
});

test("a near-miss hostname is never treated as sandbox", () => {
  // The failure that matters: something that LOOKS like sandbox but is not, being reported as
  // sandbox while it charges real cards.
  assert.equal(deriveMode("https://sandbox-api.whop.com.evil.test/api/v1"), "unknown");
  assert.equal(deriveMode("https://api-sandbox.whop.com/api/v1"), "production", "not the sandbox host");
});

test("missing or malformed configuration is unknown, never production", () => {
  assert.equal(deriveMode(undefined), "unknown");
  assert.equal(deriveMode(""), "unknown");
  assert.equal(deriveMode("not-a-url"), "unknown");
  assert.equal(deriveMode("https://example.com"), "unknown");
});

test("every mode has copy, and unknown says payments are down", () => {
  for (const mode of ["sandbox", "production", "unknown"]) {
    assert.ok(MODE_COPY[mode].label.length > 0, `${mode} needs a label`);
    assert.ok(MODE_COPY[mode].detail.length > 0, `${mode} needs detail`);
  }
  assert.match(MODE_COPY.production.detail, /real/i);
  assert.match(MODE_COPY.unknown.detail, /down|missing/i);
});

test("maskSecret never returns the secret", () => {
  const key = "whop_live_abcdefghijklmnop";
  const masked = maskSecret(key);

  assert.ok(!masked.includes("abcdefghijklm"), "the body of the key must not appear");
  assert.equal(masked, "••••mnop");
  assert.ok(masked.length < key.length);
});

test("a short secret is hidden entirely rather than half-revealed", () => {
  // Showing 4 of 8 characters gives away half the secret.
  assert.match(maskSecret("short123"), /too short/);
  assert.ok(!maskSecret("short123").includes("t123"));
});

test("absent is null, not a mask of nothing", () => {
  assert.equal(maskSecret(undefined), null);
  assert.equal(maskSecret(""), null);
  assert.equal(maskSecret("   "), null);
});
