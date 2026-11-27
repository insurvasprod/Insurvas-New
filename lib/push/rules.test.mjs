import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chunk, isExpoPushToken, toExpoMessage, unregisteredFromTickets } from "./rules.ts";
import { bearerFrom } from "../tenantAuth/appClient.ts";
import { deviceLabel } from "../tenantAuth/securityRules.ts";

const TOKEN = "ExponentPushToken[abcDEF123_xyz]";

test("only Expo push tokens are accepted", () => {
  assert.equal(isExpoPushToken(TOKEN), true);
  assert.equal(isExpoPushToken("ExpoPushToken[abcdefgh12]"), true);
  assert.equal(isExpoPushToken("https://evil.example/hook"), false);
  assert.equal(isExpoPushToken("ExponentPushToken[]"), false);
  assert.equal(isExpoPushToken(42), false);
});

test("a push never links outside the app", () => {
  assert.equal(toExpoMessage(TOKEN, { title: "Hi", href: "/app/leads/1" }).data.href, "/app/leads/1");
  assert.equal(toExpoMessage(TOKEN, { title: "Hi", href: "https://evil.example" }).data.href, null);
  assert.equal(toExpoMessage(TOKEN, { title: "Hi", href: "//evil.example/app/" }).data.href, null);
});

test("transfers and callbacks due ring on the calls channel; the rest are quiet", () => {
  const ring = toExpoMessage(TOKEN, { title: "Transfer waiting", category: "inbound_transfer" });
  assert.equal(ring.channelId, "calls");
  assert.equal(ring.priority, "high");
  assert.equal(ring.sound, "default");
  // The intake alert behind Settings › Inbound "new transfer" rings with the transfer buttons too.
  const intake = toExpoMessage(TOKEN, { title: "New lead available", category: "new_unclaimed_lead" });
  assert.equal(intake.channelId, "calls");
  assert.equal(intake.categoryId, "transfer");
  const quiet = toExpoMessage(TOKEN, { title: "Case moved", category: "case_update" });
  assert.equal(quiet.channelId, "default");
  assert.equal(quiet.sound, null);
});

test("lock-screen text is trimmed and an empty title still names the app", () => {
  const m = toExpoMessage(TOKEN, { title: "  ", body: "x".repeat(400) });
  assert.equal(m.title, "Insurvas");
  assert.equal(m.body.length, 178);
});

test("batches of at most 100 and DeviceNotRegistered tokens are found by position", () => {
  assert.deepEqual(chunk([...Array(205).keys()]).map((c) => c.length), [100, 100, 5]);
  const tickets = [{ status: "ok", id: "1" }, { status: "error", details: { error: "DeviceNotRegistered" } }, { status: "error", details: { error: "MessageTooBig" } }];
  assert.deepEqual(unregisteredFromTickets(["a", "b", "c"], tickets), ["b"]);
  assert.deepEqual(unregisteredFromTickets(["a"], null), []);
});

test("the app's header token: Bearer scheme with a JWT only", () => {
  assert.equal(bearerFrom("Bearer aaa.bbb.ccc"), "aaa.bbb.ccc");
  assert.equal(bearerFrom("bearer aaa.bbb.ccc"), null);
  assert.equal(bearerFrom("Basic dXNlcjpwYXNz"), null);
  assert.equal(bearerFrom("Bearer not-a-jwt"), null);
  assert.equal(bearerFrom(null), null);
});

test("Signed-in devices names an app session", () => {
  assert.equal(deviceLabel("InsurvasApp/1.0 (iPhone; iOS 19.1)"), "Insurvas app on iPhone");
  assert.equal(deviceLabel("InsurvasApp/1.0 (Android 16)"), "Insurvas app on Android");
});

test("requireTenant takes a header token only when it was issued to the app", () => {
  const src = readFileSync(new URL("../tenantAuth/requireTenant.ts", import.meta.url), "utf8");
  assert.match(src, /session\.cli === APP_CLIENT/);
  assert.match(src, /session\.cli !== APP_CLIENT/);
});

test("the app's web-preview CORS never applies in production or outside /api/app", async () => {
  const { appPreviewOrigin } = await import("../security/appPreviewCors.ts");
  const dev = { nodeEnv: "development", pathname: "/api/app/me", origin: "http://localhost:8081" };
  assert.equal(appPreviewOrigin(dev), "http://localhost:8081");
  assert.equal(appPreviewOrigin({ ...dev, nodeEnv: "production" }), null);
  assert.equal(appPreviewOrigin({ ...dev, pathname: "/api/admin/users" }), null);
  assert.equal(appPreviewOrigin({ ...dev, origin: "https://evil.example" }), null);
  assert.equal(appPreviewOrigin({ ...dev, origin: "http://localhost:8081.evil.example" }), null);
  assert.equal(appPreviewOrigin({ ...dev, origin: null }), null);
});

test("push devices are retired, never deleted", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261124100000_app_push_devices.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke delete, truncate on public\.app_push_device from service_role/);
  assert.match(sql, /enable row level security/);
});
