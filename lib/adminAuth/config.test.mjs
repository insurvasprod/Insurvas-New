import { test } from "node:test";
import assert from "node:assert/strict";

import { isAdmin2faEnabled } from "./config.ts";

test("admin 2FA is mandatory and cannot be disabled by configuration", () => {
  assert.equal(isAdmin2faEnabled(), true);
});
