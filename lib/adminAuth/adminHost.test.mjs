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
