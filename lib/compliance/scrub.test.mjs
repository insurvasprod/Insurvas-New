import test from "node:test";
import assert from "node:assert/strict";

const { maskDialPhone, normalizeDialPhone, parseDncScrubDecision } = await import("./scrub.ts");

test("normalizes a display phone and masks it for retained responses", () => {
  const normalized = normalizeDialPhone("+1 (555) 123-4567");
  assert.equal(normalized, "+15551234567");
  assert.equal(maskDialPhone(normalized), "••••4567");
});

test("accepts adapter-neutral DNC decisions", () => {
  assert.deepEqual(parseDncScrubDecision({ allowed: true }), { allowed: true });
  assert.deepEqual(parseDncScrubDecision({ listed: true }), { allowed: false });
  assert.deepEqual(parseDncScrubDecision({ data: { is_dnc: false } }), { allowed: true });
});

test("rejects hostile phones and unknown vendor payloads fail closed", () => {
  assert.throws(() => normalizeDialPhone("+1555<script>"), /valid phone/);
  assert.throws(() => normalizeDialPhone("123"), /valid phone/);
  assert.throws(() => parseDncScrubDecision({ status: "ok" }), /did not include/);
});
