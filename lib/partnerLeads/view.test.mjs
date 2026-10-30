import test from "node:test";
import assert from "node:assert/strict";

import {
  AGE_TONE_TEXT,
  CLOSED_COLUMN,
  DEFAULT_AGE_THRESHOLDS,
  PARTNER_BOARD_COLUMNS,
  ageShort,
  ageTone,
  boardColumns,
  laneOf,
  snapshotFields,
  snapshotValue,
} from "./view.ts";
import { NOBODY_CLAIMED_LABEL, PARTNER_LANES } from "./lanes.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const row = (lane, seconds, stageName = "New lead") => ({ lane, submittedAt: ago(seconds), stageName });

/* ── Columns ─────────────────────────────────────────────────────────────────────────────────── */

test("the board's columns are the counters' own lanes, in the counters' order", () => {
  assert.deepEqual(
    PARTNER_BOARD_COLUMNS.map((column) => column.key),
    PARTNER_LANES.map((lane) => lane.key),
  );
});

test("Closed is a column only when it holds something", () => {
  assert.equal(boardColumns(false).length, 4);
  assert.equal(boardColumns(true).length, 5);
  assert.equal(boardColumns(true).at(-1).key, CLOSED_COLUMN.key);
});

test("a row with no lane, or a lane nobody recognises, is treated as newly arrived", () => {
  assert.equal(laneOf({}), "new");
  assert.equal(laneOf({ lane: null }), "new");
  assert.equal(laneOf({ lane: "somewhere_else" }), "new");
  assert.equal(laneOf({ lane: "closed" }), "closed");
  assert.equal(laneOf({ lane: "verification" }), "verification");
});

/* ── Age ─────────────────────────────────────────────────────────────────────────────────────── */

test("an open lead goes amber at the partner rung and red at expiry", () => {
  assert.equal(ageTone(row("new", 60), NOW), "neutral");
  assert.equal(ageTone(row("new", 299), NOW), "neutral");
  assert.equal(ageTone(row("new", 300), NOW), "warning", "exactly at the threshold counts as past it");
  assert.equal(ageTone(row("claimed", 3600), NOW), "warning");
  assert.equal(ageTone(row("verification", 14_399), NOW), "warning");
  assert.equal(ageTone(row("new", 14_400), NOW), "danger");
});

test("a finished lead is never late, however old it is", () => {
  assert.equal(ageTone(row("converted", 30 * 86_400), NOW), "neutral");
  assert.equal(ageTone(row("closed", 365 * 86_400), NOW), "neutral");
});

test("a lead the SLA ladder has already flagged is amber whatever the clock says", () => {
  assert.equal(ageTone(row("new", 10, NOBODY_CLAIMED_LABEL), NOW), "warning");
  // Ground truth raises the floor, it does not cap the ceiling.
  assert.equal(ageTone(row("new", 20_000, NOBODY_CLAIMED_LABEL), NOW), "danger");
  // And it does not resurrect a finished lead.
  assert.equal(ageTone(row("closed", 10, NOBODY_CLAIMED_LABEL), NOW), "neutral");
});

test("a tenant's own ladder values override the defaults", () => {
  const strict = { warnSeconds: 30, dangerSeconds: 120 };
  assert.equal(ageTone(row("new", 60), NOW, strict), "warning");
  assert.equal(ageTone(row("new", 60), NOW), "neutral", "the same lead is fine under the default ladder");
  assert.equal(ageTone(row("new", 180), NOW, strict), "danger");
});

test("the defaults are the queue SLA ladder's own", () => {
  assert.deepEqual(DEFAULT_AGE_THRESHOLDS, { warnSeconds: 300, dangerSeconds: 14_400 });
});

test("an unparseable date never paints a lead red", () => {
  assert.equal(ageTone({ lane: "new", submittedAt: "not a date" }, NOW), "neutral");
});

test("every tone that means something carries words, so colour is never alone", () => {
  assert.equal(AGE_TONE_TEXT.neutral, null);
  assert.ok(AGE_TONE_TEXT.warning);
  assert.ok(AGE_TONE_TEXT.danger);
});

test("ageShort reads in the units a person would say", () => {
  assert.equal(ageShort(ago(30), NOW), "1 min", "under a minute still rounds up to one");
  assert.equal(ageShort(ago(12 * 60), NOW), "12 min");
  assert.equal(ageShort(ago(3 * 3600), NOW), "3 hr");
  assert.equal(ageShort(ago(30 * 3600), NOW), "yesterday");
  assert.equal(ageShort(ago(4 * 86_400), NOW), "4 d");
});

/* ── The submitted form ──────────────────────────────────────────────────────────────────────── */

test("a value is formatted the way it is read, not the way it is stored", () => {
  assert.equal(snapshotValue("tobacco", true), "Yes");
  assert.equal(snapshotValue("tobacco", "true"), "Yes");
  assert.equal(snapshotValue("existing_coverage", false), "No");
  assert.equal(snapshotValue("date_of_birth", "2008-02-27"), "27 Feb 2008");
  assert.equal(snapshotValue("phone", "4724521313"), "(472) 452-1313");
  assert.equal(snapshotValue("phone", "14724521313"), "(472) 452-1313");
  assert.equal(snapshotValue("email", "a@b.com"), "a@b.com");
});

test("an amount typed in dollars stays dollars", () => {
  // The bug this guards: formatCentsAsCurrency(55000) is $550.00 — a hundredfold cut to a
  // customer's coverage. Template values are typed by a person, not stored in cents.
  assert.equal(snapshotValue("coverage_amount", 55000), "$55,000");
  assert.equal(snapshotValue("monthly_premium", "42.5"), "$42.5");
  assert.equal(snapshotValue("coverage_amount", "about 50k"), "about 50k", "free text is left alone");
});

test("nothing written down reads as a dash, never as empty space", () => {
  assert.equal(snapshotValue("notes", null), "—");
  assert.equal(snapshotValue("notes", undefined), "—");
  assert.equal(snapshotValue("notes", ""), "—");
  assert.equal(snapshotValue("notes", "   "), "—");
});

test("the submission is grouped in the order a person reads it", () => {
  const groups = snapshotFields({
    age: 18,
    email: "tetttttt@gmail.com",
    phone: "4724521313",
    state: "IN",
    tobacco: true,
    language: "English",
    last_name: "test",
    first_name: "test",
    health_notes: "test",
    date_of_birth: "2008-02-27",
    coverage_amount: 55000,
    beneficiary_name: "test",
    existing_coverage: true,
    beneficiary_relationship: "Sibling",
  });
  assert.deepEqual(groups.map((group) => group.key), ["person", "contact", "coverage", "notes"]);
  // Within a group the order is the one declared, not the one the object happened to serialise in.
  assert.deepEqual(groups[0].fields.map((field) => field.key), ["date_of_birth", "age", "state", "language", "tobacco"]);
  assert.deepEqual(groups[1].fields.map((field) => field.key), ["phone", "email"]);
  assert.equal(groups[0].fields[0].label, "Date of birth");
  assert.equal(groups[0].fields[0].value, "27 Feb 2008");
});

test("the name is not repeated inside a panel whose title is the name", () => {
  const keys = snapshotFields({ first_name: "test", last_name: "test", age: 18 }).flatMap((group) => group.fields.map((field) => field.key));
  assert.deepEqual(keys, ["age"]);
});

test("a field no group knows about keeps its label and its value", () => {
  const groups = snapshotFields({ favourite_colour: "green", age: 18 });
  assert.deepEqual(groups.map((group) => group.key), ["person", "other"]);
  assert.deepEqual(groups[1].fields, [{ key: "favourite_colour", label: "Favourite colour", value: "green" }]);
});

test("a submission with nothing in it has no groups at all", () => {
  assert.deepEqual(snapshotFields({}), []);
  assert.deepEqual(snapshotFields(null), []);
  assert.deepEqual(snapshotFields({ first_name: "test" }), [], "hidden fields do not make an empty group");
});
