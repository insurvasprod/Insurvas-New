// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { WORKSPACE_ACTIONS, matchActions, suggestedActions } from "./actions.ts";
import { allMenuItems } from "../menu/definition.ts";

const EVERYTHING = new Set(allMenuItems().map((item) => item.required_feature).filter(Boolean));

test("every action belongs to a real menu item and goes to an app path", () => {
  const keys = new Set(allMenuItems().map((item) => item.key));
  for (const action of WORKSPACE_ACTIONS) {
    assert.ok(keys.has(action.menuKey), `${action.key} names a menu item that does not exist: ${action.menuKey}`);
    assert.match(action.href, /^\/app\//, `${action.key} must navigate inside the app`);
  }
  assert.equal(new Set(WORKSPACE_ACTIONS.map((action) => action.key)).size, WORKSPACE_ACTIONS.length, "action keys are unique");
});

test("an action is matched by its title or the words people use for it, best match first", () => {
  assert.equal(matchActions("book an", EVERYTHING, "owner")[0]?.key, "book-appointment");
  assert.ok(matchActions("dnc", EVERYTHING, "owner").some((action) => action.key === "check-number"));
  assert.ok(matchActions("csv", EVERYTHING, "owner").some((action) => action.key === "import-list"));
  assert.deepEqual(matchActions("b", EVERYTHING, "owner"), [], "one letter matches nothing");
  assert.deepEqual(matchActions("zzzz", EVERYTHING, "owner"), []);
});

test("search never offers an action the plan or the role cannot open", () => {
  // No outbound dialing on the plan: no dialer action.
  const noDialer = new Set([...EVERYTHING].filter((feature) => feature !== "outbound_dialing"));
  assert.ok(!matchActions("serve", noDialer, "owner").some((action) => action.key === "serve-next"));
  // Settings is owner-only, so a producer is not offered "Invite a teammate".
  assert.ok(matchActions("invite", EVERYTHING, "owner").some((action) => action.key === "invite-teammate"));
  assert.ok(!matchActions("invite", EVERYTHING, "producer").some((action) => action.key === "invite-teammate"));
});

test("the empty box suggests everyday actions, gated the same way", () => {
  const owner = suggestedActions(EVERYTHING, "owner").map((action) => action.key);
  assert.ok(owner.length > 0 && owner.length <= 5);
  assert.equal(owner[0], "serve-next");
  const nothing = suggestedActions(new Set(), "owner");
  assert.ok(nothing.every((action) => allMenuItems().find((item) => item.key === action.menuKey && !item.required_feature)), "with no features only ungated actions remain");
});
