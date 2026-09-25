import { test } from "node:test";
import assert from "node:assert/strict";

import { emailDeliveryMode, isReservedTestRecipient } from "./transport.ts";

test("external email delivery is disabled unless explicitly opted in", () => {
  const previous = process.env.EMAIL_DELIVERY_MODE;
  try {
    delete process.env.EMAIL_DELIVERY_MODE;
    assert.equal(emailDeliveryMode(), "disabled");
    process.env.EMAIL_DELIVERY_MODE = "smtp";
    assert.equal(emailDeliveryMode(), "smtp");
    process.env.EMAIL_DELIVERY_MODE = "SMTP";
    assert.equal(emailDeliveryMode(), "smtp");
  } finally {
    if (previous === undefined) delete process.env.EMAIL_DELIVERY_MODE;
    else process.env.EMAIL_DELIVERY_MODE = previous;
  }
});

test("reserved QA domains can never be external recipients", () => {
  assert.equal(isReservedTestRecipient("fixture@invalid.test"), true);
  assert.equal(isReservedTestRecipient("demo@insurvas.test"), true);
  assert.equal(isReservedTestRecipient("person@example.com"), true);
  assert.equal(isReservedTestRecipient("person@real-company.example"), true);
  assert.equal(isReservedTestRecipient("person@real-company.invalid"), true);
  assert.equal(isReservedTestRecipient("person@real-company.test"), true);
  assert.equal(isReservedTestRecipient("person@real-company.com"), false);
});
