import assert from "node:assert/strict";
import test from "node:test";

import { buildTrail, parentOf } from "./breadcrumbs.ts";

test("the current page is the last crumb and never a link", () => {
  const trail = buildTrail([{ label: "Settings", href: "/app/settings" }, { label: "Carriers", href: "/app/settings#carriers" }]);
  assert.deepEqual(trail, [
    { kind: "crumb", label: "Settings", href: "/app/settings", current: false },
    { kind: "crumb", label: "Carriers", href: undefined, current: true },
  ]);
});

test("a long trail keeps the root and the last two, and folds the middle into one entry", () => {
  const crumbs = ["Home", "Leads", "Campaign", "List", "Lead"].map((label, index) => ({ label, href: `/${index}` }));
  const trail = buildTrail(crumbs, 4);
  assert.equal(trail.length, 4);
  assert.equal(trail[0].kind === "crumb" && trail[0].label, "Home");
  assert.deepEqual(trail[1], { kind: "more", hidden: [{ label: "Leads", href: "/1" }, { label: "Campaign", href: "/2" }] });
  assert.equal(trail[3].kind === "crumb" && trail[3].current, true);
  assert.equal(buildTrail(crumbs.slice(0, 4), 4).length, 4, "four or fewer are shown whole");
});

test("empty labels are dropped", () => {
  assert.equal(buildTrail([{ label: "Settings", href: "/s" }, { label: "  " }, { label: "Profile" }]).length, 2);
});

test("the narrow form goes to the nearest linked parent", () => {
  assert.deepEqual(parentOf([{ label: "Settings", href: "/app/settings" }, { label: "Agency" }, { label: "Products" }]), { label: "Settings", href: "/app/settings" });
  assert.equal(parentOf([{ label: "Home" }]), null);
});
