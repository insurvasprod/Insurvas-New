/**
 * LA-2.13 and LA-2.14, pinned.
 *
 * The fourth and fifth finished mechanisms found unreachable in this sweep:
 *
 *   `tenant_scoring_settings`      0 readers — scoring could not be turned on
 *   `tenant_scoring_weights`       0 readers — c6 "weights are inspectable and adjustable"
 *   `tenant_scoring_cohort_stats`  0 readers — c3 "the holdout's contact rate is reported"
 *   `POST /api/app/outbound/application`  0 callers — LA-2.14's entry point had no door handle
 *
 * The LA-2.14 route is worth noting: it was already correct, already shared the inbound
 * verification panel with no fork, and already refused a setter twice. The only thing missing was
 * something that called it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("the scoring settings, weights and holdout are all read by the product", () => {
  const service = read("lib", "scoring", "service.ts");
  assert.match(service, /from\("tenant_scoring_settings"\)/);
  assert.match(service, /from\("tenant_scoring_weights"\)/);
  assert.match(service, /from\("tenant_scoring_cohort_stats"\)/);

  const route = read("app", "api", "app", "scoring", "route.ts");
  assert.match(route, /scoringOverview/);
  assert.match(route, /saveScoringSettings/);
  assert.match(route, /export async function GET\(/);
  assert.match(route, /export async function PUT\(/);
});

test("the screen shows the weights the scorer actually uses", () => {
  const service = read("lib", "scoring", "service.ts");
  // The EFFECTIVE weights come from `scoring_weights_for`, the same function `score_lead` reads, so
  // the screen cannot display one number while the queue ranks by another.
  assert.match(service, /rpc\("scoring_weights_for"/);
  // And an override is marked as such, because "this is the platform default" and "somebody here
  // chose this" are different facts and only one is worth revisiting.
  assert.match(service, /isDefault: !overridden\.has\(signal\.signal\)/);
});

test("only signals the scorer knows about can be saved", () => {
  const service = read("lib", "scoring", "service.ts");
  // An unknown signal would be stored, never read, and would sit in the table looking like it did
  // something.
  assert.match(service, /const known = new Set\(SCORING_SIGNALS\.map/);
  assert.match(service, /\.filter\(\(weight\) => known\.has\(weight\.signal\)\)/);

  const route = read("app", "api", "app", "scoring", "route.ts");
  assert.match(route, /signal: z\.enum\(/);
});

test("the holdout is bounded and the comparison is stated, not judged", () => {
  const route = read("app", "api", "app", "scoring", "route.ts");
  // A control arm larger than the treatment arm measures the naive order more precisely than the
  // thing being tested.
  assert.match(route, /holdout_pct: z\.number\(\)\.int\(\)\.min\(0\)\.max\(50\)/);

  const workspace = read("components", "app", "scoring-workspace.tsx");
  // The task's own framing: "Contact rate 14.2% scored versus 11.8% control, over 4,000 dials is an
  // answer. It uses machine learning is not."
  assert.match(workspace, /contactRatePct/);
  assert.match(workspace, /const lift =/);
  // Stated as a difference over a named sample size, with an explicit warning rather than a verdict.
  assert.match(workspace, /Treat a small sample as noise/);
});

test("the score is never shown to an agent, only the reason", () => {
  const workspace = read("components", "app", "scoring-workspace.tsx");
  // LA-2.13's warning about `vendor_score`: "Do not put a number in front of an agent until you can
  // explain it." The settings screen is for the owner; the dialer shows the reason and no score.
  assert.match(workspace, /The score itself is never shown to an agent/);

  const dialer = read("components", "app", "dialer-workspace.tsx");
  assert.doesNotMatch(dialer, /served\.score/);
  assert.match(dialer, /served\.selectionReason/);
});

test("scoring is off by default and the queue survives it being off", () => {
  const service = read("lib", "scoring", "service.ts");
  // A tenant row that does not exist yet must read as disabled rather than as undefined.
  assert.match(service, /enabled: row\.enabled === true/);

  const workspace = read("components", "app", "scoring-workspace.tsx");
  assert.match(workspace, /Turning it off returns the queue to callbacks, then retries due, then fresh/);
});

test("a setter cannot reach the scoring surface", () => {
  const route = read("app", "api", "app", "scoring", "route.ts");
  // The weights decide the order of a setter's own queue, and vendor contact rate is one of the
  // signals.
  assert.match(route, /const SCORING_ROLES = \["owner", "producer"\]/);
  const policy = read("lib", "entitlements", "agentApiPolicy.ts");
  assert.match(policy, /scoring\/route\.ts", featureKey: "outbound_dialing", allowedRoles: \["owner", "producer"\]/);
});

test("Interested — start application is reachable from the dialer", () => {
  const dialer = read("components", "app", "dialer-workspace.tsx");
  assert.match(dialer, /async function startApplication\(/);
  assert.match(dialer, /fetch\("\/api\/app\/outbound\/application"/);
  assert.match(dialer, /Start application/);
});

test("the outbound application opens the same panel as inbound, with no fork", () => {
  const route = read("app", "api", "app", "outbound", "application", "route.ts");
  // LA-2.14's rule: "Do not build a second application flow." Both routes call the same two
  // functions, and this asserts the outbound one does not reach for an outbound-specific variant.
  assert.match(route, /getVerificationPanel/);
  assert.match(route, /updateVerificationField/);
  assert.doesNotMatch(route, /getOutboundVerificationPanel|outboundPanel/);

  const inbound = read("app", "api", "app", "inbound", "verification", "route.ts");
  assert.match(inbound, /getVerificationPanel/);
});

test("a setter cannot take an application, and it is refused twice", () => {
  const route = read("app", "api", "app", "outbound", "application", "route.ts");
  // LA-2.12: a setter cannot "sell, quote, or submit an application". The route states it and the
  // RPC enforces it, because a rule that lives only in TypeScript stops applying the moment
  // anything else calls the API.
  assert.match(route, /const APPLICATION_ROLES = \["owner", "producer"\]/);
  assert.match(route, /SETTER_MAY_NOT_TAKE_APPLICATIONS/);
});

test("saving one weight does not mark all seven as overridden", () => {
  const service = read("lib", "scoring", "service.ts");
  // Found in the browser pass: the form posts all seven signals, so upserting each one made every
  // weight read as "somebody here chose this" the moment anyone changed one. That erases the only
  // distinction the DEFAULT badge exists to draw.
  const code = service.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /rpc\("default_scoring_weights"\)/);
  // Stored only when it differs from the platform default...
  assert.match(code, /\.filter\(\(weight\) => weight\.weight !== defaultBySignal\.get\(weight\.signal\)\)/);
  // ...and the override is REMOVED when the value goes back to the default, rather than pinning the
  // default as though it had been chosen.
  assert.match(code, /\.filter\(\(weight\) => weight\.weight === defaultBySignal\.get\(weight\.signal\)\)/);
  assert.match(code, /\.delete\(\)[\s\S]{0,120}\.in\("signal", backToDefault\)/);
});
