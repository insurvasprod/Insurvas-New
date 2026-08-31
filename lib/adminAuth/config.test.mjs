import { test } from "node:test";
import assert from "node:assert/strict";

import { isAdmin2faEnabled } from "./config.ts";

test("admin 2FA is enabled only by an explicit true value", () => {
  assert.equal(isAdmin2faEnabled("true"), true);
  assert.equal(isAdmin2faEnabled(" TRUE "), true);
  assert.equal(isAdmin2faEnabled("false"), false);
  assert.equal(isAdmin2faEnabled("1"), false);
  assert.equal(isAdmin2faEnabled(undefined), false);
});
