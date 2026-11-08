import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { isProductPath, siteHostMove } from "./siteHosts.ts";

const env = { SITE_HOST: "insurvas.com", APP_HOST: "app.insurvas.com" };
const MOVE = { kind: "to_app_host", host: "app.insurvas.com" };

test("with SITE_HOST or APP_HOST unset nothing moves, on any host", () => {
  assert.equal(siteHostMove("insurvas.com", "/app/login", {}), null);
  assert.equal(siteHostMove("insurvas.com", "/app/login", { SITE_HOST: "insurvas.com" }), null);
  assert.equal(siteHostMove("www.insurvas.com", "/app/login", { APP_HOST: "app.insurvas.com" }), null);
  assert.equal(siteHostMove("localhost", "/app/login", env), null);
});

test("the landing host sends the product to app.insurvas.com, with or without www", () => {
  for (const path of ["/app", "/app/login", "/app/signup", "/app/dashboard", "/partner", "/partner/login", "/partner/team-review"]) {
    assert.deepEqual(siteHostMove("insurvas.com", path, env), MOVE, path);
    assert.deepEqual(siteHostMove("www.insurvas.com", path, env), MOVE, path);
    assert.deepEqual(siteHostMove("WWW.Insurvas.com:443", path, env), MOVE, path);
  }
});

test("`/` and the public pages stay the landing site on every host, app.insurvas.com included", () => {
  for (const host of ["insurvas.com", "www.insurvas.com", "app.insurvas.com"]) {
    for (const path of ["/", "/pricing", "/roadmap", "/signup", "/legal/privacy"]) assert.equal(siteHostMove(host, path, env), null, `${host}${path}`);
  }
});

test("the app host, previews and other hosts serve the product where they are", () => {
  assert.equal(siteHostMove("app.insurvas.com", "/app/login", env), null);
  assert.equal(siteHostMove("app.insurvas.com", "/partner/login", env), null);
  assert.equal(siteHostMove("insurvas-new-git-branch.vercel.app", "/app/login", env), null);
  assert.equal(siteHostMove("admin.insurvas.com", "/admin/login", env), null);
});

test("API routes and look-alike paths never move", () => {
  assert.equal(siteHostMove("insurvas.com", "/api/app/leads", env), null);
  assert.equal(siteHostMove("www.insurvas.com", "/api/partner/payouts", env), null);
  assert.equal(isProductPath("/apple"), false);
  assert.equal(isProductPath("/partners"), false);
});

test("proxy.ts applies the rule, keeping the path and query on the move", () => {
  const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /siteHostMove\(hostname, pathname, process\.env\)/);
  assert.match(proxy, /url\.host = move\.host/);
  assert.match(proxy, /NextResponse\.redirect\(url, 308\)/);
  assert.doesNotMatch(proxy, /kind === "sign_in"/, "`/` must stay the landing page on app.insurvas.com");
});
