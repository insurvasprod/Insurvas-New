// Run with: npm test
//
// This endpoint is unauthenticated by design — Whop calls it, not a user — so the signature check
// is the only thing between the public internet and an API that marks invoices paid. It gets the
// most tests of anything in the payments module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { verifyWhopSignature, WEBHOOK_TOLERANCE_SECONDS } from "./verify.ts";

const SECRET = "ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const WEBHOOK_ID = "msg_bQPHmO2eBnHYtWWuxAN9K3Xd";
const NOW = 1786381404;
const BODY = JSON.stringify({ id: WEBHOOK_ID, type: "payment.succeeded", data: { id: "pay_1" } });

function sign(body, { id = WEBHOOK_ID, timestamp = NOW, secret = SECRET } = {}) {
  return createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
}

function headers(overrides = {}) {
  return {
    "webhook-id": WEBHOOK_ID,
    "webhook-timestamp": String(NOW),
    "webhook-signature": `v1,${sign(BODY)}`,
    ...overrides,
  };
}

test("a correctly signed request passes", () => {
  const result = verifyWhopSignature({ payload: BODY, headers: headers(), secret: SECRET, nowSeconds: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.webhookId, WEBHOOK_ID);
});

test("a tampered body is rejected", () => {
  // The attack this stops: take a real signed webhook and change the amount.
  const tampered = JSON.stringify({ id: WEBHOOK_ID, type: "payment.succeeded", data: { id: "pay_999" } });
  const result = verifyWhopSignature({ payload: tampered, headers: headers(), secret: SECRET, nowSeconds: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "signature mismatch");
});

test("re-serialising the body breaks the signature — the raw bytes matter", () => {
  // Why the route uses request.text() and not request.json(). Same data, different bytes.
  const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
  const result = verifyWhopSignature({ payload: reserialised, headers: headers(), secret: SECRET, nowSeconds: NOW });

  assert.equal(result.ok, false);
});

test("a signature made with a different secret is rejected", () => {
  const forged = { "webhook-signature": `v1,${sign(BODY, { secret: "ws_attacker" })}` };
  const result = verifyWhopSignature({ payload: BODY, headers: headers(forged), secret: SECRET, nowSeconds: NOW });

  assert.equal(result.ok, false);
});

test("the webhook-id is part of what is signed", () => {
  // Stops replaying one event's signature under a different id to dodge our deduplication.
  const result = verifyWhopSignature({
    payload: BODY,
    headers: headers({ "webhook-id": "msg_someone_elses" }),
    secret: SECRET,
    nowSeconds: NOW,
  });

  assert.equal(result.ok, false);
});

test("an old request is rejected even though it is correctly signed", () => {
  const result = verifyWhopSignature({
    payload: BODY,
    headers: headers(),
    secret: SECRET,
    nowSeconds: NOW + WEBHOOK_TOLERANCE_SECONDS + 1,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /replay window/);
});

test("a request from the future is rejected too", () => {
  const result = verifyWhopSignature({
    payload: BODY,
    headers: headers(),
    secret: SECRET,
    nowSeconds: NOW - WEBHOOK_TOLERANCE_SECONDS - 1,
  });

  assert.equal(result.ok, false);
});

test("a request just inside the window is accepted", () => {
  const result = verifyWhopSignature({
    payload: BODY,
    headers: headers(),
    secret: SECRET,
    nowSeconds: NOW + WEBHOOK_TOLERANCE_SECONDS - 1,
  });

  assert.equal(result.ok, true);
});

test("several signatures pass if any one matches — secret rotation", () => {
  const rotation = { "webhook-signature": `v1,${sign(BODY, { secret: "ws_old" })} v1,${sign(BODY)}` };
  const result = verifyWhopSignature({ payload: BODY, headers: headers(rotation), secret: SECRET, nowSeconds: NOW });

  assert.equal(result.ok, true);
});

test("a signature with no v1 version is rejected", () => {
  const result = verifyWhopSignature({
    payload: BODY,
    headers: headers({ "webhook-signature": `v2,${sign(BODY)}` }),
    secret: SECRET,
    nowSeconds: NOW,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /no v1 signature/);
});

test("each missing header is refused by name", () => {
  for (const missing of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
    const incomplete = headers();
    delete incomplete[missing];
    const result = verifyWhopSignature({ payload: BODY, headers: incomplete, secret: SECRET, nowSeconds: NOW });

    assert.equal(result.ok, false, `${missing} should be required`);
    assert.match(result.reason, new RegExp(missing));
  }
});

test("a non-numeric timestamp is refused rather than coerced", () => {
  const result = verifyWhopSignature({
    payload: BODY,
    headers: headers({ "webhook-timestamp": "not-a-time" }),
    secret: SECRET,
    nowSeconds: NOW,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /not a number/);
});

test("an empty secret refuses everything", () => {
  const result = verifyWhopSignature({ payload: BODY, headers: headers(), secret: "", nowSeconds: NOW });

  assert.equal(result.ok, false);
  assert.match(result.reason, /not set/);
});

test("header lookup is case-insensitive", () => {
  const upper = {
    "Webhook-Id": WEBHOOK_ID,
    "Webhook-Timestamp": String(NOW),
    "Webhook-Signature": `v1,${sign(BODY)}`,
  };
  // Node lowercases incoming headers, but a proxy or a test harness may not.
  const result = verifyWhopSignature({
    payload: BODY,
    headers: { ...upper, "webhook-id": WEBHOOK_ID, "webhook-timestamp": String(NOW), "webhook-signature": `v1,${sign(BODY)}` },
    secret: SECRET,
    nowSeconds: NOW,
  });

  assert.equal(result.ok, true);
});

test("an empty body still verifies correctly", () => {
  const emptyHeaders = {
    "webhook-id": WEBHOOK_ID,
    "webhook-timestamp": String(NOW),
    "webhook-signature": `v1,${sign("")}`,
  };
  const result = verifyWhopSignature({ payload: "", headers: emptyHeaders, secret: SECRET, nowSeconds: NOW });

  assert.equal(result.ok, true);
});
