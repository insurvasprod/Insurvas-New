import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { isProductPath, siteHostMove } from "./siteHosts.ts";

const env = { SITE_HOST: "insurvas.com", APP_HOST: "app.insurvas.com" };

test("with SITE_HOST or APP_HOST unset nothing moves, on any host", () => {
  assert.equal(siteHostMove("app.insurvas.com", "/", {}), null);
  assert.equal(siteHostMove("insurvas.com", "/app/login", { SITE_HOST: "insurvas.com" }), null);
  assert.equal(siteHostMove("localhost", "/", env), null);
});

test("insurvas.com keeps the landing page and sends the product to app.insurvas.com", () => {
  assert.equal(siteHostMove("insurvas.com", "/", env), null);
  assert.equal(siteHostMove("www.insurvas.com", "/pricing", env), null);
  for (const path of ["/app", "/app/login", "/app/signup", "/app/dashboard", "/partner", "/partner/login"]) {
    assert.deepEqual(siteHostMove("insurvas.com", path, env), { kind: "to_app_host", host: "app.insurvas.com" }, path);
    assert.deepEqual(siteHostMove("WWW.Insurvas.com:443", path, env), { kind: "to_app_host", host: "app.insurvas.com" }, path);
  }
});

test("app.insurvas.com opens on sign-in, and serves the product", () => {
  assert.deepEqual(siteHostMove("app.insurvas.com", "/", env), { kind: "sign_in" });
  assert.equal(siteHostMove("app.insurvas.com", "/app/login", env), null);
  assert.equal(siteHostMove("app.insurvas.com", "/app/leads", env), null);
});

test("API routes and look-alike paths never move", () => {
  assert.equal(siteHostMove("insurvas.com", "/api/app/leads", env), null);
  assert.equal(isProductPath("/apple"), false);
  assert.equal(isProductPath("/partners"), false);
});

test("proxy.ts applies the rule, keeping the path and query on the move", () => {
  const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /siteHostMove\(hostname, pathname, process\.env\)/);
  assert.match(proxy, /url\.host = move\.host/);
});
