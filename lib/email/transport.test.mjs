import { test } from "node:test";
import assert from "node:assert/strict";

import { emailDeliveryMode, isReservedTestRecipient } from "./transport.ts";

test("external email delivery is disabled unless explicitly opted in", () => {
  const previous = process.env.EMAIL_DELIVERY_MODE;
  const previousVercel = process.env.VERCEL_ENV;
  try {
    delete process.env.EMAIL_DELIVERY_MODE;
    delete process.env.VERCEL_ENV;
    assert.equal(emailDeliveryMode(), "disabled");
    process.env.EMAIL_DELIVERY_MODE = "smtp";
    assert.equal(emailDeliveryMode(), "smtp");
    process.env.EMAIL_DELIVERY_MODE = "SMTP";
    assert.equal(emailDeliveryMode(), "smtp");
  } finally {
    if (previous === undefined) delete process.env.EMAIL_DELIVERY_MODE;
    else process.env.EMAIL_DELIVERY_MODE = previous;
    if (previousVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercel;
  }
});

test("the deployed production site sends by default; everything else stays off unless opted in", () => {
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "production" }), "smtp", "production on Vercel, no variable set");
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "preview" }), "disabled", "preview deployments stay off");
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "development" }), "disabled", "vercel dev / env pull stays off");
  assert.equal(emailDeliveryMode({}), "disabled", "local dev, next start and scripts stay off");
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "production", EMAIL_DELIVERY_MODE: "disabled" }), "smtp", ".env.example's template value does not stop real signups");
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "production", EMAIL_DELIVERY_MODE: "smtp" }), "smtp");
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "production", EMAIL_DELIVERY_MODE: "off" }), "disabled", "off is the kill switch");
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "production", EMAIL_DELIVERY_MODE: " OFF " }), "disabled");
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "preview", EMAIL_DELIVERY_MODE: "disabled" }), "disabled");
  assert.equal(emailDeliveryMode({ VERCEL_ENV: "preview", EMAIL_DELIVERY_MODE: "smtp" }), "smtp", "an explicit opt-in still works anywhere");
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
