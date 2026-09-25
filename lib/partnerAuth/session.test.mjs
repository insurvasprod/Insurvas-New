import test from "node:test";
import assert from "node:assert/strict";
import { continuedPartnerSession, partnerSessionCookie, partnerSessionCookieOptions, signPartnerSessionToken, verifyPartnerSessionToken } from "./session.ts";

process.env.PARTNER_SESSION_SECRET ||= "test-partner-secret";

test("re-issuing a browser-session sign-in keeps it a browser session", () => {
  const now = 1_000_000;
  const continued = continuedPartnerSession({ remember: false, exp: now + 3600 }, now);
  assert.equal(continued.remember, false);
  assert.equal("maxAge" in partnerSessionCookie(continued.remember, continued.maxAge), false);
});

test("a token from before the claim existed is treated as a browser session", () => {
  assert.equal(continuedPartnerSession({}, 1_000_000).remember, false);
});

test("re-issuing a remembered sign-in keeps its expiry instead of restarting the 12 hours", () => {
  const now = 1_000_000;
  const continued = continuedPartnerSession({ remember: true, exp: now + 3600 }, now);
  assert.equal(continued.remember, true);
  assert.equal(continued.expiresAt, now + 3600);
  assert.equal(partnerSessionCookie(continued.remember, continued.maxAge).maxAge, 3600);
});

test("the token carries the sign-in's choice and a fixed expiry when one is given", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const remembered = await verifyPartnerSessionToken(await signPartnerSessionToken("u", "t", "p", 3, { remember: true, expiresAt }));
  assert.equal(remembered?.remember, true);
  assert.equal(remembered?.exp, expiresAt);
  const browser = await verifyPartnerSessionToken(await signPartnerSessionToken("u", "t", "p", 3));
  assert.equal(browser?.remember, false);
});

test("'Keep me signed in' keeps the 12-hour cookie; unticked, the cookie ends with the browser", () => {
  assert.equal(partnerSessionCookie(true).maxAge, 60 * 60 * 12);
  assert.equal("maxAge" in partnerSessionCookie(false), false);
  // Everything else about the cookie is the same either way.
  const { maxAge, ...rest } = partnerSessionCookieOptions;
  assert.equal(maxAge, 60 * 60 * 12);
  assert.deepEqual(partnerSessionCookie(false), rest);
});
