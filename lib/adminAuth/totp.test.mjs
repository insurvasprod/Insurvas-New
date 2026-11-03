import assert from "node:assert/strict";
import test from "node:test";
import * as OTPAuth from "otpauth";

import { generateTotpSecret, verifyTotpCode, verifyTotpStep } from "./totp.ts";

const EMAIL = "staff@insurvas.invalid";
const NOW = Date.parse("2026-09-25T10:00:10.000Z");
const STEP = Math.floor(NOW / 1000 / 30);

function codeAt(secret, timestamp) {
  return new OTPAuth.TOTP({
    issuer: "Insurvas Admin",
    label: EMAIL,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate({ timestamp });
}

test("a current code verifies and reports its own time step", () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotpStep(EMAIL, secret, codeAt(secret, NOW), NOW), STEP);
  assert.equal(verifyTotpCode(EMAIL, secret, codeAt(secret, Date.now())), true);
});

test("one step of drift either side is accepted, and reports the step the code belongs to", () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotpStep(EMAIL, secret, codeAt(secret, NOW - 30_000), NOW), STEP - 1);
  assert.equal(verifyTotpStep(EMAIL, secret, codeAt(secret, NOW + 30_000), NOW), STEP + 1);
});

test("a code two steps away, or a wrong code, verifies to nothing", () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotpStep(EMAIL, secret, codeAt(secret, NOW - 60_000), NOW), null);
  const right = codeAt(secret, NOW);
  const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, "0");
  // Not impossible for `wrong` to be valid at a neighbouring step; vanishingly rare, and it would
  // then have to match that step's code exactly.
  if (wrong !== codeAt(secret, NOW - 30_000) && wrong !== codeAt(secret, NOW + 30_000)) {
    assert.equal(verifyTotpStep(EMAIL, secret, wrong, NOW), null);
  }
});
