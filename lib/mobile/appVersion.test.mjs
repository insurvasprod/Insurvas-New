import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { appUpdateRequired, appUpdateRequiredBody, appVersionFrom, compareVersions, parseVersion, APP_UPDATE_REQUIRED_CODE } from "./appVersion.ts";

// Board M8 · the server tells an old phone app to update (426 + app_update_required), opt-in.
const app = (version, extra = {}) => ({ pathname: "/api/app/me", client: "app", userAgent: `InsurvasApp/${version} (Android)`, minVersion: "1.2.0", ...extra });

test("does nothing while MOBILE_MIN_APP_VERSION is unset, empty or unreadable", () => {
  for (const minVersion of [undefined, null, "", "  ", "latest", "1.x"]) {
    assert.equal(appUpdateRequired(app("0.1.0", { minVersion })), false, String(minVersion));
  }
});

test("an older app is refused, the same or a newer one passes", () => {
  assert.equal(appUpdateRequired(app("1.1.9")), true);
  assert.equal(appUpdateRequired(app("1.0")), true);
  assert.equal(appUpdateRequired(app("1.2.0")), false);
  assert.equal(appUpdateRequired(app("1.2")), false);
  assert.equal(appUpdateRequired(app("1.2.1")), false);
  assert.equal(appUpdateRequired(app("2.0.0")), false);
  assert.equal(appUpdateRequired(app("1.10.0", { minVersion: "1.9.0" })), false);
});

test("only the app's own requests are checked: the header and a readable version are both needed", () => {
  assert.equal(appUpdateRequired(app("1.0.0", { client: null })), false);
  assert.equal(appUpdateRequired(app("1.0.0", { client: "web" })), false);
  assert.equal(appUpdateRequired(app("1.0.0", { client: " APP " })), true);
  // The app's web preview sends the header but a browser's user agent.
  assert.equal(appUpdateRequired(app("1.0.0", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })), false);
  assert.equal(appUpdateRequired(app("1.0.0", { userAgent: "InsurvasApp/beta (iPhone)" })), false);
  assert.equal(appUpdateRequired(app("1.0.0", { userAgent: null })), false);
});

test("the agency's and the partner's API are covered, pages and other APIs are not", () => {
  assert.equal(appUpdateRequired(app("1.0.0", { pathname: "/api/app/auth/mobile/login" })), true);
  assert.equal(appUpdateRequired(app("1.0.0", { pathname: "/api/partner/me" })), true);
  assert.equal(appUpdateRequired(app("1.0.0", { pathname: "/api/admin/tenants" })), false);
  assert.equal(appUpdateRequired(app("1.0.0", { pathname: "/app/dashboard" })), false);
  assert.equal(appUpdateRequired(app("1.0.0", { pathname: "/api/applications" })), false);
});

test("reads the version from the app's user agent", () => {
  assert.equal(appVersionFrom("InsurvasApp/1.0.3 (Android)"), "1.0.3");
  assert.equal(appVersionFrom("okhttp/4 InsurvasApp/2.1 (iPhone)"), "2.1");
  assert.equal(appVersionFrom("NotInsurvasApp/1.0"), null);
  assert.deepEqual(parseVersion("1.2.3"), [1, 2, 3]);
  assert.equal(parseVersion("1.2.3-beta"), null);
  assert.ok(compareVersions([1, 2], [1, 2, 0]) === 0);
});

test("the answer carries the code the app reads, and proxy.ts answers 426 with it", () => {
  const body = appUpdateRequiredBody("1.2.0");
  assert.equal(body.code, APP_UPDATE_REQUIRED_CODE);
  assert.equal(body.code, "app_update_required");
  assert.equal(body.minVersion, "1.2.0");
  const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /appUpdateRequired\(\{[^}]*minVersion: process\.env\.MOBILE_MIN_APP_VERSION/);
  assert.match(proxy, /status: 426/);
});
