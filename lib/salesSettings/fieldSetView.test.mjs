// LA-3.7 · Settings › Application field sets (owner pick B, 2026-10-30): every field is Not asked /
// Optional / Required, the set says how it differs from the platform set, and which asked fields the
// carrier's autofill map does not place. The stored shape stays {required, optional, labels}.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FIELD_SET_GROUPS, addCustom, changesFrom, editEntry, moveWithinGroup, requireAsked, setKeyState, stateOfKey, unplacedKeys } from "./fieldSetView.ts";
import { fieldSetLayout, orderedKeys } from "../applications/fieldSetLayout.ts";
import { fieldSetEntries, fieldSetFromEntries } from "./templateDefinition.ts";
import { FIELD_SET_KEYS, definitionProblem } from "./templateSchemas.ts";

const platform = fieldSetEntries({ required: ["insured.first_name", "insured.dob"], optional: ["contact.email"] });

test("the editor's sections hold every key a field set may name, once", () => {
  const keys = FIELD_SET_GROUPS.flatMap((g) => g.keys);
  assert.deepEqual([...keys].sort(), [...FIELD_SET_KEYS].sort());
  assert.equal(new Set(keys).size, keys.length);
});

test("a field moves between Not asked, Optional and Required, in canonical order, keeping its wording", () => {
  let list = setKeyState(platform, "pay.routing_number", "required");
  assert.equal(stateOfKey(list, "pay.routing_number"), "required");
  assert.equal(list.find((e) => e.key === "pay.routing_number").sensitive, true, "a bank number is masked");
  list = list.map((e) => (e.key === "insured.dob" ? { ...e, label: "Birth date" } : e));
  list = setKeyState(list, "insured.dob", "optional");
  assert.equal(list.find((e) => e.key === "insured.dob").label, "Birth date");
  list = setKeyState(list, "contact.email", "off");
  assert.equal(stateOfKey(list, "contact.email"), "off");
  assert.deepEqual(list.map((e) => e.key), FIELD_SET_KEYS.filter((k) => list.some((e) => e.key === k)));
  const def = fieldSetFromEntries(list);
  assert.equal(definitionProblem("application_field_set", def), null);
  assert.deepEqual(def.labels, { "insured.dob": "Birth date" });
});

test("Require all asked makes a section's asked fields required and leaves the rest", () => {
  const list = requireAsked(platform, ["contact.email", "contact.phone"]);
  assert.equal(stateOfKey(list, "contact.email"), "required");
  assert.equal(stateOfKey(list, "contact.phone"), "off");
});

test("changes from the platform set name the state and the carrier's wording", () => {
  let mine = setKeyState(platform, "cov.face_amount", "required");
  mine = setKeyState(mine, "contact.email", "off");
  mine = mine.map((e) => (e.key === "insured.first_name" ? { ...e, label: "Given name" } : e));
  const changes = changesFrom(platform, mine);
  assert.deepEqual(changes.map((c) => [c.key, c.from, c.to, c.wording]), [
    ["insured.first_name", "required", "required", "Given name"],
    ["contact.email", "optional", "off", null],
    ["cov.face_amount", "off", "required", null],
  ]);
  assert.deepEqual(changesFrom(platform, platform), []);
});

test("autofill: the asked fields a map does not place, or null without a map", () => {
  assert.equal(unplacedKeys(platform, null), null);
  assert.deepEqual(unplacedKeys(platform, new Set(["insured.first_name", "insured.dob"])), ["contact.email"]);
});

test("a field moves within its section and the order is stored", () => {
  const set = fieldSetEntries({ required: ["insured.first_name", "insured.last_name", "insured.dob", "contact.phone"], optional: [] });
  const moved = moveWithinGroup(set, "insured.dob", 0);
  assert.deepEqual(moved.map((e) => e.key), ["insured.dob", "insured.first_name", "insured.last_name", "contact.phone"]);
  const def = fieldSetFromEntries(moved);
  assert.deepEqual(def.order, ["insured.dob", "insured.first_name", "insured.last_name", "contact.phone"]);
  assert.equal(definitionProblem("application_field_set", def), null);
  assert.deepEqual(fieldSetEntries(def).map((e) => e.key), def.order, "the order survives a round trip");
  assert.equal(changesFrom(set, moved).find((c) => c.key === "insured.dob").moved, true);
});

test("the agency adds, edits and removes its own question; a built-in field keeps its key and type", () => {
  let list = fieldSetEntries({ required: ["insured.first_name"], optional: [] });
  list = addCustom(list, { label: "Spouse's occupation", help: "As they say it", type: "choice", options: ["Retired", " Working "], group: "insured", state: "required" });
  const q = list.find((e) => e.custom);
  assert.equal(q.key, "custom.spouse_s_occupation");
  assert.deepEqual(q.custom.options, ["Retired", "Working"]);
  const def = fieldSetFromEntries(list);
  assert.equal(definitionProblem("application_field_set", def), null);
  assert.deepEqual(def.custom, [{ key: q.key, label: "Spouse's occupation", type: "choice", options: ["Retired", "Working"], group: "insured" }]);
  assert.equal(def.help[q.key], "As they say it");
  assert.ok(changesFrom(fieldSetEntries({ required: ["insured.first_name"], optional: [] }), list).find((c) => c.key === q.key).added);
  // A built-in field: only its wording and help change.
  const edited = editEntry(list, "insured.first_name", { label: "Given name", help: "Legal name", type: "date" });
  const first = edited.find((e) => e.key === "insured.first_name");
  assert.equal(first.label, "Given name");
  assert.equal(first.typeLabel, "Text");
  assert.equal(first.help, "Legal name");
  // The question moves to another section and is removed.
  const movedSection = editEntry(edited, q.key, { group: "cov" });
  assert.equal(movedSection.find((e) => e.key === q.key).group, "cov");
  assert.equal(definitionProblem("application_field_set", fieldSetFromEntries(movedSection.filter((e) => e.key !== q.key))), null);
  assert.match(definitionProblem("application_field_set", { required: ["insured.first_name"], optional: [], custom: [{ key: "custom.x1", label: "X", type: "choice", options: [], group: "insured" }] }), /needs at least one choice|is not asked/);
});

test("the application step reads the set's order, wording, help and questions", () => {
  const def = fieldSetFromEntries(addCustom(moveWithinGroup(fieldSetEntries({ required: ["insured.first_name", "insured.dob"], optional: ["insured.last_name"], labels: { "insured.dob": "Birth date" } }), "insured.last_name", 0),
    { label: "Height in cm", help: "", type: "number", options: [], group: "insured", state: "optional" }));
  const layout = fieldSetLayout(def);
  assert.deepEqual(orderedKeys(layout, ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "custom.height_in_cm"]), ["insured.last_name", "insured.first_name", "insured.dob", "custom.height_in_cm"]);
  assert.equal(layout.wording["insured.dob"], "Birth date");
  assert.equal(layout.custom[0].type, "number");
  assert.deepEqual(orderedKeys(null, ["a.b"]), ["a.b"], "no set: every field, as before");
});

test("the section shows what Required does and keeps every way out of a set", () => {
  const src = readFileSync(new URL("../../components/app/settings/sales/field-sets.tsx", import.meta.url), "utf8");
  assert.match(src, /before they can submit/, "what Required does, in words");
  for (const verb of ["deleteDraft", "backToPlatform", "copyTo", "FieldSetRetireDialog", "FieldSetPublishDialog", "AddFieldSetDialog", "LeaveGuard"]) assert.match(src, new RegExp(verb), verb);
});
