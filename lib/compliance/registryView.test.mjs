// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { dialingPosture, fullUtc, healthPill, registryFooter, shortUtc, unreachableVendors, vendorRoles } from "./registryView.ts";

const vendor = (over) => ({ id: over.id ?? over.name ?? "v", name: "Vendor", vendor_type: "dnc_scrub", is_enabled: true, available: true, calls_24h: 10, failures_24h: 0, last_latency_ms: 96, ...over });

test("roles follow the listing's order per type, litigators included, never Advisory", () => {
  const roles = vendorRoles([
    vendor({ id: "a", vendor_type: "dnc_scrub" }),
    vendor({ id: "b", vendor_type: "dnc_scrub" }),
    vendor({ id: "c", vendor_type: "dnc_scrub", is_enabled: false }),
    vendor({ id: "d", vendor_type: "litigator_scrub" }),
    vendor({ id: "e", vendor_type: "litigator_scrub" }),
    vendor({ id: "f", vendor_type: "phone_validation" }),
  ]);
  assert.deepEqual(Object.fromEntries(roles), { a: "Primary", b: "Fallback", c: "Unused", d: "Primary", e: "Fallback", f: "Not called" });
  assert.ok(![...roles.values()].includes("Advisory"));
});

test("health reads the board's states and never calls an unchecked vendor reachable", () => {
  assert.equal(healthPill(vendor({})).label, "Reachable · 96 ms");
  assert.equal(healthPill(vendor({ calls_24h: 0 })).label, "Not checked");
  assert.equal(healthPill(vendor({ available: false, calls_24h: 4, failures_24h: 4 })).label, "Unreachable · 4 failures");
  assert.equal(healthPill(vendor({ calls_24h: 5, failures_24h: 2 })).tone, "warning");
  assert.equal(healthPill(vendor({ last_latency_ms: null })).label, "Reachable");
});

test("demo mode says the vendors are not what gates dialing", () => {
  const posture = dialingPosture([], { demo: true, dncBlocked: false });
  assert.equal(posture.tone, "info");
  assert.match(posture.lines[0], /DEMO_SCREENING_MODE/);
});

test("blocked names each missing check, DNC from the gate and the litigator from the preflight", () => {
  const none = dialingPosture([], { demo: false, dncBlocked: true });
  assert.equal(none.title, "Dialing is currently blocked");
  assert.match(none.lines[0], /No DNC vendor is enabled/);
  assert.match(none.lines[1], /No litigator vendor is enabled/);
  const litigatorOnly = dialingPosture([vendor({})], { demo: false, dncBlocked: false });
  assert.equal(litigatorOnly.tone, "error");
  assert.equal(litigatorOnly.lines.length, 2);
});

test("possible: the board's sentence when both types answered, a warning when one is only unchecked", () => {
  const ok = dialingPosture([vendor({}), vendor({ vendor_type: "litigator_scrub" })], { demo: false, dncBlocked: false });
  assert.equal(ok.tone, "success");
  assert.equal(ok.lines[0], "One enabled DNC vendor is reachable.");
  const unchecked = dialingPosture([vendor({ calls_24h: 0 }), vendor({ vendor_type: "litigator_scrub" })], { demo: false, dncBlocked: false });
  assert.equal(unchecked.tone, "warning");
  assert.match(unchecked.lines[0], /has not been checked/);
});

test("the footer names the unreachable vendors, and reads truthfully when there are none", () => {
  const down = unreachableVendors([vendor({ name: "Blacklist Alliance", available: false }), vendor({ name: "Off", available: false, is_enabled: false })]);
  assert.match(registryFooter(down), /^Enabled is not the same as working\. Blacklist Alliance is configured and unreachable/);
  assert.doesNotMatch(registryFooter([]), /is configured and unreachable —/);
  assert.match(registryFooter([]), /never rendered\.$/);
});

test("times are UTC with the zone shown", () => {
  assert.equal(shortUtc("2026-09-22T08:44:05Z", 2026), "22 Sep 08:44 UTC");
  assert.equal(shortUtc("2025-09-22T08:44:05Z", 2026), "22 Sep 2025 08:44 UTC");
  assert.equal(fullUtc("2026-09-22T08:44:05Z"), "22 Sep 2026 08:44:05 UTC");
  assert.equal(shortUtc(null, 2026), null);
});
