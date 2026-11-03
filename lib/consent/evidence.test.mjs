import assert from "node:assert/strict";
import test from "node:test";

import { bestEvidence, consentGivenAt, evidenceTime, keptFor } from "./evidence.ts";

const art = (capture_status, ip = null, extra = {}) => ({ id: capture_status + (ip ?? ""), capture_status, ip, consent_timestamp: null, captured_at: "2026-09-12T14:02:00Z", provider: "trustedform", ...extra });

test("a claimed copy with an IP is full evidence; without one it is text, no IP", () => {
  assert.equal(bestEvidence([art("claimed", "1.2.3.4")]).level, "full");
  assert.equal(bestEvidence([art("claimed")]).level, "no_ip");
});

test("a link we never claimed is not the words; an expired or failed one is lost", () => {
  assert.equal(bestEvidence([art("pending", "1.2.3.4")]).level, "link_only");
  assert.equal(bestEvidence([art("expired")]).level, "lost");
  assert.equal(bestEvidence([art("failed")]).level, "lost");
});

test("the lead is judged by its best certificate, and no certificate is none", () => {
  assert.equal(bestEvidence([art("failed"), art("claimed", "9.9.9.9"), art("pending")]).level, "full");
  assert.deepEqual(bestEvidence([]), { level: "none", artefact: null });
});

test("consent time is the certificate's own, else when it was captured", () => {
  assert.equal(consentGivenAt(art("claimed", null, { consent_timestamp: "2026-09-01T00:00:00Z" })), "2026-09-01T00:00:00Z");
  assert.equal(consentGivenAt(art("claimed")), "2026-09-12T14:02:00Z");
  assert.equal(consentGivenAt(null), null);
});

test("how long the oldest record has been kept reads like the board", () => {
  const now = Date.UTC(2026, 8, 24);
  assert.equal(keptFor("2022-07-10T00:00:00Z", now), "4 yr 2 mo");
  assert.equal(keptFor("2026-06-01T00:00:00Z", now), "3 mo");
  assert.equal(keptFor("2026-09-12T00:00:00Z", now), "12 days");
  assert.equal(keptFor("2024-09-24T00:00:00Z", now), "2 yr");
});

test("evidence times are fixed to UTC and say so", () => {
  assert.equal(evidenceTime("2026-09-12T14:02:00Z"), "12 Sep 2026, 14:02 UTC");
  assert.equal(evidenceTime(null), "Not recorded");
});

test("a partner's attestation sits between a certificate link and nothing", async () => {
  const { EVIDENCE_LABEL } = await import("./evidence.ts");
  assert.equal(EVIDENCE_LABEL.attested, "Partner attested, no text");
});
