// Run with: npm test
//
// This is a safety control: it exists so a compromised vendor or a broken feature can be switched
// off for everyone in one click. Every failure below is a feature staying reachable when somebody
// has decided it must not be — so the tests lean on "does it actually deny", not "does it allow".
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyKillSwitches,
  isFeatureAvailable,
  killSwitchNotice,
  switchRefusalReason,
  OFF_MESSAGE_MAX,
} from "./killSwitchRules.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const sw = (over = {}) => ({
  feature_key: "outbound_dialing",
  state: "on",
  beta_tenant_ids: [],
  off_message: null,
  updated_at: null,
  ...over,
});

test("no row means available — the table holds exceptions only", () => {
  assert.equal(isFeatureAvailable(undefined, TENANT_A), true);
});

test("off denies everyone, including the tenant who paid for it", () => {
  // The headline of the ticket: a killed feature is invisible even to someone whose plan grants it.
  assert.equal(isFeatureAvailable(sw({ state: "off" }), TENANT_A), false);
  assert.equal(isFeatureAvailable(sw({ state: "off" }), TENANT_B), false);
});

test("beta allows only the listed tenants", () => {
  const beta = sw({ state: "beta", beta_tenant_ids: [TENANT_A] });
  assert.equal(isFeatureAvailable(beta, TENANT_A), true);
  assert.equal(isFeatureAvailable(beta, TENANT_B), false);
});

test("beta with an empty list denies everyone rather than allowing everyone", () => {
  // The dangerous default. An empty allowlist must fail closed.
  assert.equal(isFeatureAvailable(sw({ state: "beta", beta_tenant_ids: [] }), TENANT_A), false);
});

test("a switch can only REMOVE features, never grant one", () => {
  // A kill switch must not become a way to hand somebody a feature they did not pay for.
  const granted = ["book_of_business"];
  const switches = new Map([
    ["outbound_dialing", sw({ feature_key: "outbound_dialing", state: "beta", beta_tenant_ids: [TENANT_A] })],
  ]);

  const effective = applyKillSwitches(granted, switches, TENANT_A);
  assert.deepEqual(effective, ["book_of_business"], "a beta switch cannot add an ungranted feature");
});

test("applyKillSwitches filters exactly the killed keys and keeps order", () => {
  const granted = ["book_of_business", "outbound_dialing", "quoting", "tcpa_checker"];
  const switches = new Map([
    ["outbound_dialing", sw({ feature_key: "outbound_dialing", state: "off" })],
    ["tcpa_checker", sw({ feature_key: "tcpa_checker", state: "beta", beta_tenant_ids: [TENANT_B] })],
    ["quoting", sw({ feature_key: "quoting", state: "on" })],
  ]);

  assert.deepEqual(applyKillSwitches(granted, switches, TENANT_A), ["book_of_business", "quoting"]);
  assert.deepEqual(applyKillSwitches(granted, switches, TENANT_B), [
    "book_of_business",
    "quoting",
    "tcpa_checker",
  ]);
});

test("an empty granted list stays empty whatever the switches say", () => {
  const switches = new Map([["outbound_dialing", sw({ state: "beta", beta_tenant_ids: [TENANT_A] })]]);
  assert.deepEqual(applyKillSwitches([], switches, TENANT_A), []);
});

test("the notice is the admin's message, or nothing — never invented", () => {
  assert.equal(killSwitchNotice(undefined), null);
  assert.equal(killSwitchNotice(sw({ state: "on", off_message: "ignored while on" })), null);
  assert.equal(killSwitchNotice(sw({ state: "off", off_message: null })), null);
  assert.equal(killSwitchNotice(sw({ state: "off", off_message: "   " })), null, "whitespace is not a message");
  assert.equal(
    killSwitchNotice(sw({ state: "off", off_message: "Dialing is off while we switch DNC providers." })),
    "Dialing is off while we switch DNC providers.",
  );
});

test("the notice never leaks who is in the beta", () => {
  const notice = killSwitchNotice(sw({ state: "beta", beta_tenant_ids: [TENANT_A], off_message: "Coming soon." }));
  assert.equal(notice, "Coming soon.");
  assert.ok(!String(notice).includes(TENANT_A));
});

test("validation refuses the states that would silently do nothing", () => {
  assert.equal(switchRefusalReason({ state: "on", betaTenantIds: [], offMessage: null }), null);
  assert.equal(switchRefusalReason({ state: "off", betaTenantIds: [], offMessage: null }), null);

  assert.match(switchRefusalReason({ state: "beta", betaTenantIds: [], offMessage: null }), /at least one tenant/i);
  assert.match(switchRefusalReason({ state: "nonsense", betaTenantIds: [], offMessage: null }), /state must be/i);
  assert.match(
    switchRefusalReason({ state: "off", betaTenantIds: [], offMessage: "x".repeat(OFF_MESSAGE_MAX + 1) }),
    new RegExp(String(OFF_MESSAGE_MAX)),
  );
});
