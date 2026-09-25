import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_SIGNATURE, parseSignatureAnswers, signatureGuidance } from "./signatureReadiness.ts";

const all = (value) => Object.fromEntries(Object.keys(EMPTY_SIGNATURE).map((key) => [key, value]));

test("nothing asked is neutral, never a no", () => {
  const guidance = signatureGuidance(EMPTY_SIGNATURE);
  assert.equal(guidance.tone, "neutral");
  assert.equal(guidance.asked, 0);
});

test("all six yes can finish today", () => {
  const guidance = signatureGuidance(all(true));
  assert.equal(guidance.tone, "success");
  assert.equal(guidance.yes, 6);
});

test("the board's case: no email, no e-sign, can text → send by text or book a callback", () => {
  const guidance = signatureGuidance({ ...all(true), can_open_email: false, can_esign_now: false });
  assert.equal(guidance.tone, "error");
  assert.match(guidance.detail, /Send the link by text/);
  assert.equal(guidance.yes, 4);
});

test("cannot stay on the line wins; banking alone is a warning; unasked counts", () => {
  assert.equal(signatureGuidance({ ...all(true), can_stay_on_line: false }).tone, "error");
  assert.equal(signatureGuidance({ ...all(true), banking_to_hand: false }).tone, "warning");
  const partial = signatureGuidance({ ...EMPTY_SIGNATURE, can_receive_text: true, can_stay_on_line: true });
  assert.equal(partial.headline, "4 still to ask");
});

test("parser accepts booleans and null only", () => {
  assert.deepEqual(parseSignatureAnswers({ can_esign_now: true, banking_to_hand: null }), { can_esign_now: true, banking_to_hand: null });
  assert.equal(parseSignatureAnswers({ can_esign_now: "yes" }), null);
  assert.deepEqual(parseSignatureAnswers({ unknown: true }), {});
});
