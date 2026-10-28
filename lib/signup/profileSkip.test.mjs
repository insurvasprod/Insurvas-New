// "Skip for now" on About you (manager review, 2026-10-28): into the app for this visit, asked again
// at the next login. Reads the source: the route needs a session and the form is a React component.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PROFILE_SKIPPED_COOKIE, PROFILE_SKIP_PATH, profileSkippedCookieOptions } from "./profileSkip.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("the skip marker lasts one browser session and only the server reads it", () => {
  assert.equal(PROFILE_SKIPPED_COOKIE, "insurvas_profile_skipped");
  assert.equal(profileSkippedCookieOptions.httpOnly, true);
  assert.equal("maxAge" in profileSkippedCookieOptions, false, "no max-age: it ends with the session");
  assert.equal(PROFILE_SKIP_PATH, "/api/app/onboarding/business-profile/skip");
});

test("skipping is only offered, and only works, once the plan has started", () => {
  const route = read("app/api/app/onboarding/business-profile/skip/route.ts");
  assert.match(route, /context\.onboardingState !== "completed"/);
  assert.match(route, /response\.cookies\.set\(PROFILE_SKIPPED_COOKIE, sessionKey\(session\), profileSkippedCookieOptions\)/);
  assert.doesNotMatch(route, /\.from\(|\.rpc\(/, "skipping writes nothing to the database");
  assert.match(read("app/app/onboarding/business-profile/page.tsx"), /skipHref=\{paid && !gate \? PROFILE_SKIP_PATH : undefined\}/, "no Skip on the gate");
});
