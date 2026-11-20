// Run with: node --experimental-strip-types --test lib/settings/samePageHash.test.mjs
//
// Settings › Products "+ Form" links to "/app/settings#form-templates". A Next <Link> push never fires
// `hashchange`, so the settings shell sends same-page hash links through location.hash instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { samePageHash } from "./samePageHash.ts";

const here = { origin: "https://app.example.test", pathname: "/app/settings", search: "", hash: "#products" };

test("a link to another settings section on the open page sets its hash", () => {
  assert.equal(samePageHash("/app/settings#form-templates", here), "form-templates");
  assert.equal(samePageHash("/app/settings#sales-process/health-questions", here), "sales-process/health-questions");
  assert.equal(samePageHash("#carriers", here), "carriers");
});

test("links that leave the page, change the query or show no new hash are left to the router", () => {
  assert.equal(samePageHash("/app/publishers", here), null);
  assert.equal(samePageHash("/app/settings/accounting#tax", here), null);
  assert.equal(samePageHash("/app/settings?tab=x#form-templates", here), null);
  assert.equal(samePageHash("https://elsewhere.test/app/settings#form-templates", here), null);
  assert.equal(samePageHash("/app/settings#products", here), null);
  assert.equal(samePageHash("/app/settings#", here), null);
  assert.equal(samePageHash(null, here), null);
});

test("the settings shell routes same-page hash clicks through location.hash", () => {
  const shell = readFileSync(new URL("../../components/app/agent-settings-tabs.tsx", import.meta.url), "utf8");
  assert.match(shell, /samePageHash\(/);
  assert.match(shell, /window\.location\.hash = /);
});
