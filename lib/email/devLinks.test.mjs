import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { devEmailLinkLine, devEmailLinksEnabled } from "./devLinks.ts";

test("dev verification links need a non-production build AND the explicit flag", () => {
  assert.equal(devEmailLinksEnabled({ NODE_ENV: "development", ALLOW_DEV_EMAIL_LINKS: "true" }), true);
  assert.equal(devEmailLinksEnabled({ NODE_ENV: "test", ALLOW_DEV_EMAIL_LINKS: " TRUE " }), true);
  assert.equal(devEmailLinksEnabled({ NODE_ENV: "development" }), false, "no flag, no link");
  assert.equal(devEmailLinksEnabled({ NODE_ENV: "development", ALLOW_DEV_EMAIL_LINKS: "1" }), false, "only the word true");
});

test("never in production, whatever the flag says", () => {
  assert.equal(devEmailLinksEnabled({ NODE_ENV: "production", ALLOW_DEV_EMAIL_LINKS: "true" }), false);
  assert.equal(devEmailLinksEnabled({ NODE_ENV: "development", VERCEL_ENV: "production", ALLOW_DEV_EMAIL_LINKS: "true" }), false);
});

test("real delivery wins: with smtp on, nothing is logged", () => {
  assert.equal(devEmailLinksEnabled({ NODE_ENV: "development", ALLOW_DEV_EMAIL_LINKS: "true", EMAIL_DELIVERY_MODE: "smtp" }), false);
});

test("the verification email prints the link only behind the gate, and only when nothing was delivered", () => {
  const source = readFileSync(new URL("./sendVerificationEmail.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!delivery\.delivered && devEmailLinksEnabled\(\)\) \{/);
  assert.match(source, /console\.info\(devEmailLinkLine\("email verification", input\.email, input\.verificationUrl\)\);/);
  assert.match(devEmailLinkLine("email verification", "a@b.test", "http://localhost:3000/x"), /http:\/\/localhost:3000\/x/);
});
