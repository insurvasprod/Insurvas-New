import assert from "node:assert/strict";
import test from "node:test";

import { roleReach } from "./roleReach.ts";

const menu = [
  { label: "Dialer", path: "/app/dialer", required_roles: ["owner", "producer", "setter"] },
  { label: "Calendar", path: "/app/calendar", required_roles: ["owner", "producer", "setter"] },
  { label: "Vendors & campaigns", path: "/app/campaigns", required_roles: ["owner", "producer"] },
  { label: "Commission ledger", path: "/app/ledger", required_roles: ["owner", "producer", "bookkeeper"] },
  { label: "Settings", path: "/app/settings", required_roles: ["owner"] },
  { label: "Lapse risk", path: "/app/lapse-risk", required_roles: ["owner", "producer"] },
  { label: "Dashboard", path: "/app/dashboard" },
];

test("a setter is set beside a producer, the first other role the ledger admits", () => {
  const { otherRole, rows } = roleReach(menu, "setter", "Commission ledger");
  assert.equal(otherRole, "producer");
  assert.deepEqual(rows.map((row) => [row.area, row.viewer, row.other]), [
    ["Dialer", true, true],
    ["Calendar", true, true],
    ["Vendors & campaigns", false, true],
    ["Commission ledger", false, true],
    ["Settings", false, false],
  ]);
  assert.equal(rows.find((row) => row.current).area, "Commission ledger");
});

test("a closed page outside the main areas is added to the table and marked", () => {
  const { rows } = roleReach(menu, "setter", "Lapse risk");
  assert.ok(rows.some((row) => row.area === "Lapse risk" && row.current && !row.viewer && row.other));
});

test("when only the owner gets in, the comparison is the owner", () => {
  assert.equal(roleReach(menu, "producer", "Settings").otherRole, "owner");
});

test("a label the menu does not know still yields the main areas", () => {
  const { rows } = roleReach(menu, "assistant", "Something else");
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => !row.current));
});
