import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { actorOptionsFor, staffLoginsVisibleTo } from "./present.ts";

test("only super_admin sees staff sign-ins", () => {
  assert.equal(staffLoginsVisibleTo("super_admin"), true);
  for (const role of ["support_agent", "billing_admin", "", "owner"]) assert.equal(staffLoginsVisibleTo(role), false, role);
});

test("the actor filter offers no staff choice to a role that cannot see staff", () => {
  assert.deepEqual(actorOptionsFor("support_agent").map((o) => o.value), ["all", "user"]);
  assert.ok(actorOptionsFor("super_admin").some((o) => o.value === "admin"));
});

test("the feed query filters to tenant users when staff are not visible, totals included", async () => {
  const source = await readFile(new URL("./queries.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!options\.includeStaff\) \{\s*request = request\.eq\("actor_type", "user"\);\s*inRange = inRange\.eq\("actor_type", "user"\);/);
});

test("the API route and the page both pass the viewer's role through", async () => {
  const route = await readFile(new URL("../../app/api/admin/activity/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../../app/admin/(protected)/activity/page.tsx", import.meta.url), "utf8");
  assert.match(route, /includeStaff: staffLoginsVisibleTo\(auth\.session\.role\)/);
  assert.match(page, /includeStaff: staffLoginsVisibleTo\(admin\.role\)/);
});
