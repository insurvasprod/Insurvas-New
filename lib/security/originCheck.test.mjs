import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { configuredHosts, hostOf, refuseCrossSite } from "./originCheck.ts";

const base = { method: "POST", pathname: "/api/app/leads", origin: null, referer: null, authorization: null, requestHost: "app.insurvas.com", allowedHosts: ["https://app.insurvas.com", "admin.insurvas.com"] };

test("same-origin and configured-host writes pass", () => {
  assert.equal(refuseCrossSite({ ...base, origin: "https://app.insurvas.com" }), false);
  assert.equal(refuseCrossSite({ ...base, requestHost: "localhost:3000", origin: "http://localhost:3000" }), false);
  assert.equal(refuseCrossSite({ ...base, pathname: "/api/admin/tenants", requestHost: "admin.insurvas.com", origin: "https://admin.insurvas.com" }), false);
});

test("a write from another site is refused, on every protected plane", () => {
  for (const pathname of ["/api/app/leads", "/api/partner/leads", "/api/admin/tenants"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(refuseCrossSite({ ...base, method, pathname, origin: "https://evil.example" }), true, `${method} ${pathname}`);
    }
  }
  // A sibling subdomain is same-SITE (Lax lets it through) but not same-origin.
  assert.equal(refuseCrossSite({ ...base, origin: "https://blog.insurvas.com" }), true);
  assert.equal(refuseCrossSite({ ...base, origin: "null" }), true);
  // No Origin: the Referer decides.
  assert.equal(refuseCrossSite({ ...base, referer: "https://evil.example/page" }), true);
  assert.equal(refuseCrossSite({ ...base, referer: "https://app.insurvas.com/app/leads" }), false);
});

test("reads, token-authenticated calls, header-less clients and other paths are not checked", () => {
  assert.equal(refuseCrossSite({ ...base, method: "GET", origin: "https://evil.example" }), false);
  assert.equal(refuseCrossSite({ ...base, authorization: "Bearer a.b.c", origin: "chrome-extension://abc" }), false);
  assert.equal(refuseCrossSite({ ...base }), false);
  for (const pathname of ["/api/cron/run", "/api/internal/x", "/api/webhooks/whop", "/api/v1/leads", "/api/leads/post", "/api/affiliate/abc", "/api/application"]) {
    assert.equal(refuseCrossSite({ ...base, pathname, origin: "https://evil.example" }), false, pathname);
  }
});

test("hosts are compared with their ports, and configuration is read from env", () => {
  assert.equal(hostOf("https://App.Insurvas.com/path"), "app.insurvas.com");
  assert.equal(hostOf("localhost:3000"), "localhost:3000");
  assert.equal(refuseCrossSite({ ...base, requestHost: "localhost:3000", origin: "http://localhost:4000", allowedHosts: [] }), true);
  assert.deepEqual(configuredHosts({ NEXT_PUBLIC_APP_URL: "https://a.example", ADMIN_HOST: "admin.example" }), ["https://a.example", "admin.example"]);
});

test("proxy.ts runs the check before the /api/admin early return, and the matcher covers the three planes", () => {
  const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  const check = proxy.indexOf("refuseCrossSite({");
  const adminReturn = proxy.indexOf('if (pathname.startsWith("/api/admin")) {');
  assert.ok(check > 0 && check < adminReturn, "the Origin check must run before /api/admin returns early");
  for (const path of ["/api/app/:path*", "/api/partner/:path*", "/api/admin/:path*"]) assert.ok(proxy.includes(`"${path}"`), path);
});
