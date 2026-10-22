import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { trustedClientIp } from "./clientInfo.ts";

const h = (entries) => new Headers(entries);

test("x-real-ip, which the platform writes, wins over anything in X-Forwarded-For", () => {
  assert.equal(trustedClientIp(h({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9, 198.51.100.7" })), "198.51.100.7");
});

test("a spoofed first X-Forwarded-For hop is never taken; the last, proxy-written hop is", () => {
  assert.equal(trustedClientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.4, 198.51.100.7" })), "198.51.100.7");
  // Rotating the spoofed first hop leaves the caller in the same bucket.
  const a = trustedClientIp(h({ "x-forwarded-for": "1.1.1.1, 198.51.100.7" }));
  const b = trustedClientIp(h({ "x-forwarded-for": "2.2.2.2, 198.51.100.7" }));
  assert.equal(a, b);
});

test("no usable header gives null, and callerIp turns that into one shared bucket", () => {
  assert.equal(trustedClientIp(h({})), null);
  assert.equal(trustedClientIp(h({ "x-forwarded-for": " , " })), null);
  const rateLimit = readFileSync(new URL("../rateLimit/index.ts", import.meta.url), "utf8");
  assert.match(rateLimit, /return trustedClientIp\(headers\) \|\| "unknown";/);
  assert.doesNotMatch(rateLimit, /split\(","\)\[0\]/);
});

test("no route reads the first X-Forwarded-For hop itself", () => {
  const tax = readFileSync(new URL("../../app/api/app/accounting/tax/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(tax, /x-forwarded-for/);
  assert.match(tax, /getClientIp\(request\)/);
});
