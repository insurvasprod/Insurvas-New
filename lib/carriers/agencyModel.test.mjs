import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { agencyCarrierModel, carriersWithHistory, offeredCarriers } from "./agencyModel.ts";

const library = [
  { id: "a", code: "aetna", name: "Aetna" },
  { id: "b", code: "americo", name: "Americo" },
  { id: "c", code: "moo", name: "Mutual of Omaha" },
  { id: "d", code: "never", name: "Never added" },
];
const today = "2026-11-02";
const appointment = (carrier_id, state, extra = {}) => ({ carrier_id, state, status: "active", effective_from: "2026-01-01", terminated_at: null, ...extra });

const model = (over = {}) => agencyCarrierModel({
  library,
  contracts: [{ carrier_id: "a", is_active: true }, { carrier_id: "b", is_active: true }],
  requirements: [{ carrier_id: "b", contracted: false }, { carrier_id: "c", contracted: true }],
  appointments: [appointment("a", "tx"), appointment("a", "FL"), appointment("c", "TX"), appointment("a", "GA", { status: "pending" }), appointment("a", "NY", { terminated_at: "2026-10-01" })],
  today,
  ...over,
});

test("Settings › Carriers decides: a contract or a switch row makes a carrier the agency's; the switch turns it off", () => {
  const carriers = model();
  assert.deepEqual(carriers.map((c) => [c.id, c.on]), [["a", true], ["b", false], ["c", true]]);
  assert.ok(!carriers.some((c) => c.id === "d"), "a library carrier never added is not the agency's");
});

test("a carrier's states are the ones it is appointed in today; pending and ended ones do not count", () => {
  const byId = new Map(model().map((c) => [c.id, c.states]));
  assert.deepEqual(byId.get("a"), ["FL", "TX"]);
  assert.deepEqual(byId.get("c"), ["TX"]);
});

test("pickers offer only carriers switched on, and only where they are appointed when the state is known", () => {
  const carriers = model();
  assert.deepEqual(offeredCarriers(carriers).map((c) => c.id), ["a", "c"]);
  assert.deepEqual(offeredCarriers(carriers, "fl").map((c) => c.id), ["a"]);
  assert.deepEqual(offeredCarriers(carriers, "CA").map((c) => c.id), []);
});

test("filters over records keep every carrier the records name: history is never hidden", () => {
  const options = carriersWithHistory(model(), [{ id: "b", name: "Americo" }, { id: "d", name: "Never added" }]);
  assert.deepEqual(options.map((c) => c.id), ["a", "b", "c", "d"]);
});

// Every carrier picker reads lib/carriers/agency.ts. The raw library read stays for the file pipeline
// (recognising a carrier by name) and the admin console only.
test("no agency page or component hands the whole carrier library to a picker", () => {
  const roots = ["app/app", "components/app"];
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && /libraryCarriers\(|listStatementCarriers\(\)|loadCarrierChoices\(\)/.test(readFileSync(path, "utf8"))) offenders.push(path);
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, []);
});
