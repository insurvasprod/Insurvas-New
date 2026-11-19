import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { isProductPath, siteHostMove } from "./siteHosts.ts";

// Separate sites per plane (owner, 2026-11-18).
const env = { SITE_HOST: "insurvas.com", APP_HOST: "app.insurvas.com", PARTNER_HOST: "partner.insurvas.com", ADMIN_HOST: "admin.insurvas.com" };
const TO_APP = { kind: "to_app_host", host: "app.insurvas.com" };
const TO_PARTNER = { kind: "to_app_host", host: "partner.insurvas.com" };

test("with SITE_HOST or APP_HOST unset nothing moves, on any host", () => {
  assert.equal(siteHostMove("insurvas.com", "/app/login", {}), null);
  assert.equal(siteHostMove("insurvas.com", "/app/login", { SITE_HOST: "insurvas.com" }), null);
  assert.equal(siteHostMove("www.insurvas.com", "/app/login", { APP_HOST: "app.insurvas.com" }), null);
  assert.equal(siteHostMove("app.insurvas.com", "/", { APP_HOST: "app.insurvas.com" }), null);
  assert.equal(siteHostMove("localhost", "/app/login", env), null);
});

test("the landing site sends the agent app and sign-up to app., the partner portal to partner., with or without www", () => {
  for (const host of ["insurvas.com", "www.insurvas.com", "WWW.Insurvas.com:443"]) {
    for (const path of ["/app", "/app/login", "/app/signup", "/app/dashboard", "/signup", "/signup/verify"]) assert.deepEqual(siteHostMove(host, path, env), TO_APP, `${host}${path}`);
    for (const path of ["/partner", "/partner/login", "/partner/team-review"]) assert.deepEqual(siteHostMove(host, path, env), TO_PARTNER, `${host}${path}`);
  }
});

test("each product host keeps only its own plane", () => {
  assert.deepEqual(siteHostMove("app.insurvas.com", "/partner/login", env), TO_PARTNER);
  assert.deepEqual(siteHostMove("partner.insurvas.com", "/app/login", env), TO_APP);
  assert.deepEqual(siteHostMove("partner.insurvas.com", "/signup", env), TO_APP);
  assert.deepEqual(siteHostMove("admin.insurvas.com", "/app/dashboard", env), TO_APP);
  assert.equal(siteHostMove("app.insurvas.com", "/app/login", env), null);
  assert.equal(siteHostMove("partner.insurvas.com", "/partner/login", env), null);
  assert.equal(siteHostMove("admin.insurvas.com", "/admin/login", env), null);
});

test("`/` opens each product host's own product; the landing site keeps `/`", () => {
  assert.deepEqual(siteHostMove("app.insurvas.com", "/", env), { ...TO_APP, pathname: "/app" });
  assert.deepEqual(siteHostMove("partner.insurvas.com", "/", env), { ...TO_PARTNER, pathname: "/partner" });
  assert.deepEqual(siteHostMove("admin.insurvas.com", "/", env), { kind: "to_app_host", host: "admin.insurvas.com", pathname: "/admin" });
  for (const host of ["insurvas.com", "www.insurvas.com"]) {
    for (const path of ["/", "/pricing", "/roadmap", "/legal/privacy"]) assert.equal(siteHostMove(host, path, env), null, `${host}${path}`);
  }
});

test("without PARTNER_HOST the partner portal stays on the app host, as before", () => {
  const noPartner = { SITE_HOST: "insurvas.com", APP_HOST: "app.insurvas.com" };
  assert.deepEqual(siteHostMove("www.insurvas.com", "/partner/login", noPartner), TO_APP);
  assert.equal(siteHostMove("app.insurvas.com", "/partner/login", noPartner), null);
});

test("previews and other hosts serve everything where they are", () => {
  assert.equal(siteHostMove("insurvas-new-git-branch.vercel.app", "/app/login", env), null);
  assert.equal(siteHostMove("insurvas-new-git-branch.vercel.app", "/", env), null);
});

test("API routes and look-alike paths never move", () => {
  assert.equal(siteHostMove("insurvas.com", "/api/app/leads", env), null);
  assert.equal(siteHostMove("app.insurvas.com", "/api/partner/payouts", env), null);
  assert.equal(siteHostMove("partner.insurvas.com", "/api/app/leads", env), null);
  assert.equal(isProductPath("/apple"), false);
  assert.equal(isProductPath("/partners"), false);
  assert.equal(isProductPath("/signups"), false);
});

test("proxy.ts runs on every path the rule moves (a path outside the matcher never reaches the rule)", () => {
  const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  const matcher = proxy.match(/matcher:\s*\[([^\]]*)\]/)?.[1] ?? "";
  assert.ok(matcher.includes(`"/"`), "proxy.ts matcher is missing /");
  for (const root of ["/app", "/partner", "/signup"]) {
    assert.ok(matcher.includes(`"${root}/:path*"`), `proxy.ts matcher is missing ${root}/:path*`);
  }
});

test("proxy.ts applies the rule, keeping the path and query unless the rule names a path", () => {
  const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /siteHostMove\(hostname, pathname, process\.env\)/);
  assert.match(proxy, /url\.host = move\.host/);
  assert.match(proxy, /if \(move\.pathname\) url\.pathname = move\.pathname/);
  assert.match(proxy, /NextResponse\.redirect\(url, 308\)/);
});
