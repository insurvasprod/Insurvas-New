// Run with: npm test
//
// LA-0.5 acceptance criterion 6: "No module contains its own copy of the eligibility logic."
//
// Notion is explicit about why: "A single read-only helper `canWrite(carrier, state, date)` that
// later modules call — do not scatter this logic." Scattered eligibility is how an agent ends up
// writing business they are not appointed for in one screen and blocked in another.
//
// The name `canWrite` is unfortunately used by three unrelated things in this repo:
//   1. lib/appointments/service.ts    — appointment eligibility (this one)
//   2. lib/entitlements/types.ts      — whether the SUBSCRIPTION may write at all
//   3. component-local role gates     — whether this USER may write
// They are different questions. This test pins the appointment one and asserts the other two are
// not quietly reimplementing it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

import { canWriteFromVault } from "./eligibility.ts";

const ROOT = process.cwd();
const OWNING_FILES = new Set(["lib/appointments/eligibility.ts", "lib/appointments/service.ts"]);

function sourceFiles(target) {
  const absolute = join(ROOT, target);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [target];
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = `${target}/${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", ".next"].includes(entry.name)) continue;
      found.push(...sourceFiles(child));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

function appSources() {
  return ["lib", "app", "components"]
    .flatMap(sourceFiles)
    .map((path) => [path, readFileSync(join(ROOT, path), "utf8")]);
}

test("only the appointments module reasons about appointment eligibility", () => {
  // The tell-tale of a second implementation is a file that inspects appointment shape —
  // terminated_at, effective_from against a carrier/state pair — without going through the helper.
  const eligibilityShape = /terminated_at/;
  const offenders = [];

  for (const [path, source] of appSources()) {
    if (OWNING_FILES.has(path)) continue;
    if (path.startsWith("lib/appointments/")) continue; // the module's own types and service code
    if (path.endsWith(".test.mjs")) continue;
    // Generated column declarations, not logic: `terminated_at: string | null` trips the union
    // bar in the `decides` pattern below without deciding anything.
    if (path === "lib/supabase/database.types.ts") continue;
    if (!eligibilityShape.test(source)) continue;

    // Reading or displaying a termination date is fine. Deciding from it is not.
    const decides = /(if|\?|&&|\|\|)[^\n]{0,80}terminated_at/.test(source)
      || /terminated_at[^\n]{0,40}(>|<|>=|<=|===|!==)/.test(source);
    if (decides) offenders.push(path);
  }

  assert.deepEqual(
    offenders,
    [],
    `these files decide eligibility from appointment fields instead of calling canWrite():\n  ${offenders.join("\n  ")}`,
  );
});

test("the three different questions called canWrite are not the same function", () => {
  // A guard against the collision becoming a real bug: if someone ever makes the entitlement
  // helper take a carrier and a state, these two have merged and one caller is now wrong.
  const entitlements = readFileSync(join(ROOT, "lib/entitlements/types.ts"), "utf8");
  assert.ok(
    /export function canWrite\(entitlement: Entitlement\): boolean/.test(entitlements),
    "the entitlement canWrite() changed shape — check it has not absorbed appointment eligibility",
  );
  assert.ok(
    !/carrier/i.test(entitlements),
    "lib/entitlements/types.ts mentions carriers; the entitlement gate must not know about appointments",
  );
});

// --- the helper's own contract, as Notion words it -------------------------

const VAULT = {
  tenantCarriers: [{ carrier_id: "car-1", effective_from: "2024-01-01" }],
  appointments: [
    { carrier_id: "car-1", state: "TX", status: "active", effective_from: "2024-02-01", terminated_at: null },
    { carrier_id: "car-1", state: "NM", status: "active", effective_from: "2027-01-01", terminated_at: null },
  ],
  licenses: [
    { state: "TX", license_number: "TX-1", expires_at: "2030-01-01" },
    { state: "NM", license_number: "NM-1", expires_at: "2030-01-01" },
  ],
  eoPolicies: [{ carrier: "EO Co", policy_number: "EO-1", expires_at: "2030-01-01" }],
};

test("canWrite is false for a carrier/state pair with no appointment", () => {
  assert.equal(canWriteFromVault(VAULT, "car-1", "AZ", "2026-01-01"), false);
  assert.equal(canWriteFromVault(VAULT, "car-999", "TX", "2026-01-01"), false);
});

test("canWrite is false for an appointment whose effective date is in the future", () => {
  // NM is appointed from 2027; asking about 2026 must refuse.
  assert.equal(canWriteFromVault(VAULT, "car-1", "NM", "2026-01-01"), false);
  assert.equal(canWriteFromVault(VAULT, "car-1", "NM", "2027-06-01"), true);
});

test("an expired licence makes canWrite false for every state it covers", () => {
  const expiredTexas = {
    ...VAULT,
    licenses: [
      { state: "TX", license_number: "TX-1", expires_at: "2025-01-01" },
      { state: "NM", license_number: "NM-1", expires_at: "2030-01-01" },
    ],
  };
  assert.equal(canWriteFromVault(expiredTexas, "car-1", "TX", "2026-01-01"), false);
  // and only that state — NM is unaffected once its appointment is live
  assert.equal(canWriteFromVault(expiredTexas, "car-1", "NM", "2027-06-01"), true);
});

test("an expired E&O policy makes canWrite false everywhere at once", () => {
  const expiredEo = { ...VAULT, eoPolicies: [{ carrier: "EO Co", policy_number: "EO-1", expires_at: "2025-01-01" }] };
  assert.equal(canWriteFromVault(expiredEo, "car-1", "TX", "2026-01-01"), false);
  assert.equal(canWriteFromVault(expiredEo, "car-1", "NM", "2027-06-01"), false);
});

test("a policy written before a termination stays writable at its own date", () => {
  // Notion: "a policy written last year stays valid when an appointment is later terminated."
  const terminated = {
    ...VAULT,
    appointments: [
      { carrier_id: "car-1", state: "TX", status: "terminated", effective_from: "2024-02-01", terminated_at: "2026-06-01" },
    ],
  };
  assert.equal(canWriteFromVault(terminated, "car-1", "TX", "2026-01-01"), true, "before termination");
  assert.equal(canWriteFromVault(terminated, "car-1", "TX", "2026-06-01"), false, "on the termination date");
  assert.equal(canWriteFromVault(terminated, "car-1", "TX", "2026-09-01"), false, "after termination");
});

test("eligibility needs the carrier contract as well as the appointment", () => {
  const noContract = { ...VAULT, tenantCarriers: [] };
  assert.equal(canWriteFromVault(noContract, "car-1", "TX", "2026-01-01"), false);
});

test("state matching is not case- or whitespace-sensitive", () => {
  assert.equal(canWriteFromVault(VAULT, "car-1", " tx ", "2026-01-01"), true);
});
