import assert from "node:assert/strict";
import test from "node:test";

import { isAdminPath, normaliseHost, refuseAdminOnThisHost } from "./adminHost.ts";

test("with ADMIN_HOST unset nothing is refused, on any host", () => {
  assert.equal(refuseAdminOnThisHost("app.insurvas.com", "/admin", undefined), false);
  assert.equal(refuseAdminOnThisHost("localhost", "/api/admin/admins", ""), false);
});

test("with ADMIN_HOST set, /admin and /api/admin are refused on the agent host", () => {
  for (const path of ["/admin", "/admin/login", "/admin/tenants", "/api/admin/auth/login"]) {
    assert.equal(refuseAdminOnThisHost("app.insurvas.com", path, "admin.insurvas.com"), true, path);
  }
});

test("the admin host itself is served, whatever the case or port", () => {
  assert.equal(refuseAdminOnThisHost("Admin.Insurvas.com:443", "/admin/login", "admin.insurvas.com"), false);
  assert.equal(refuseAdminOnThisHost("admin.insurvas.com", "/api/admin/me", " ADMIN.insurvas.com "), false);
});

test("non-admin paths are never refused, and look-alike paths are not admin paths", () => {
  assert.equal(refuseAdminOnThisHost("app.insurvas.com", "/app/login", "admin.insurvas.com"), false);
  assert.equal(isAdminPath("/administrator"), false);
  assert.equal(isAdminPath("/api/administer"), false);
  assert.equal(normaliseHost("a.example.com, b.example.com"), "a.example.com");
});

const { adminHostSetupGaps, adminPageRedirect, requestHostname } = await import("./adminHost.ts");

test("the host is read from Host, never from a client-sent X-Forwarded-Host (H-2)", async () => {
  assert.equal(requestHostname("app.insurvas.com:443", "fallback.example"), "app.insurvas.com");
  assert.equal(requestHostname(null, "App.Insurvas.com"), "app.insurvas.com");
  const proxy = (await import("node:fs")).readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(proxy.slice(0, proxy.indexOf("refuseAdminOnThisHost(hostname")), /headers\.get\("x-forwarded-host"\)/);
  assert.match(proxy, /const hostname = requestHostname\(request\.headers\.get\("host"\), request\.nextUrl\.hostname\);/);
});

test("a refused admin page moves to the admin host; the API and writes stay a 404", () => {
  assert.equal(adminPageRedirect("GET", "/admin/login", "?next=1", "admin.insurvas.com"), "https://admin.insurvas.com/admin/login?next=1");
  assert.equal(adminPageRedirect("HEAD", "/admin", "", "admin.insurvas.com"), "https://admin.insurvas.com/admin");
  assert.equal(adminPageRedirect("POST", "/admin/login", "", "admin.insurvas.com"), null);
  assert.equal(adminPageRedirect("GET", "/api/admin/me", "", "admin.insurvas.com"), null);
  assert.equal(adminPageRedirect("GET", "/admin/login", "", undefined), null);
});

test("production without the admin host settings is reported; local development is not", () => {
  assert.deepEqual(adminHostSetupGaps({}), []);
  assert.deepEqual(adminHostSetupGaps({ NODE_ENV: "production" }), [], "a local next start names no public host");
  const missing = ["Set ADMIN_HOST to the admin host (admin.insurvas.com)."];
  assert.deepEqual(adminHostSetupGaps({ VERCEL_ENV: "production" }), missing);
  // Today's production: the site and app hosts are set, the admin host is not.
  assert.deepEqual(adminHostSetupGaps({ SITE_HOST: "insurvas.com", APP_HOST: "app.insurvas.com" }), missing);
  // Host-only cookies (no cookie domain) are the safe default; a host-pinned one is fine too.
  assert.deepEqual(adminHostSetupGaps({ VERCEL_ENV: "production", SITE_HOST: "insurvas.com", ADMIN_HOST: "admin.insurvas.com" }), []);
  assert.deepEqual(adminHostSetupGaps({ SITE_HOST: "insurvas.com", ADMIN_HOST: "admin.insurvas.com", ADMIN_COOKIE_DOMAIN: "admin.insurvas.com", AGENT_COOKIE_DOMAIN: "app.insurvas.com" }), []);
  // A cookie on the shared parent reaches the other plane.
  assert.deepEqual(adminHostSetupGaps({ SITE_HOST: "insurvas.com", ADMIN_HOST: "admin.insurvas.com", AGENT_COOKIE_DOMAIN: ".insurvas.com" }), ["AGENT_COOKIE_DOMAIN is the shared parent domain; set it to its own host or leave it empty."]);
});
