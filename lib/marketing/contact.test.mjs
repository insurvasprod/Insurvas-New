// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { contactFieldErrors, contactInbox, contactRequestSchema, isBot } from "./contact.ts";
import { contactRequestEmail } from "../email/templates.ts";

const valid = { name: "Dana Whit", email: " Dana@Agency.COM ", agency: "", message: "We run 40 agents and need a custom carrier feed." };

test("a valid request is trimmed, lower-cased and an empty agency becomes null", () => {
  const parsed = contactRequestSchema.parse(valid);
  assert.equal(parsed.email, "dana@agency.com");
  assert.equal(parsed.agency, null);
  assert.equal(parsed.name, "Dana Whit");
});

test("each bad field gets its own message", () => {
  const result = contactRequestSchema.safeParse({ name: "D", email: "nope", message: "hi" });
  assert.equal(result.success, false);
  const errors = contactFieldErrors(result.error);
  assert.equal(errors.name, "Enter your name");
  assert.equal(errors.email, "Enter a valid email address");
  assert.equal(errors.message, "Tell us a little more");
});

test("an over-long message is refused", () => {
  assert.equal(contactRequestSchema.safeParse({ ...valid, message: "x".repeat(4001) }).success, false);
});

test("the honeypot marks a script", () => {
  assert.equal(isBot({ website: "" }), false);
  assert.equal(isBot({ website: "http://spam.example" }), true);
});

test("the inbox is the dedicated one, else the sending address, else none", () => {
  assert.equal(contactInbox({ CONTACT_INBOX_EMAIL: "hello@insurvas.com", SMTP_FROM_EMAIL: "no-reply@insurvas.com" }), "hello@insurvas.com");
  assert.equal(contactInbox({ SMTP_FROM_EMAIL: "no-reply@insurvas.com" }), "no-reply@insurvas.com");
  assert.equal(contactInbox({}), null);
});

test("the email escapes what the visitor typed and keeps the subject on one line", () => {
  const email = contactRequestEmail({ name: "<b>Dana</b>\nInjected: header", email: "dana@agency.com", agency: "Acme & Co", message: "Hello <script>alert(1)</script>\n\nSecond paragraph" });
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /Acme &amp; Co/);
  assert.doesNotMatch(email.subject, /\n/);
  assert.match(email.text, /Second paragraph/);
});
