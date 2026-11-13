import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { areaLabel, changeSentence, cleanLabel, describeChange, initials, kindOf, plainHistoryCsv, saveKey, valueWords, wherePath } from "./describe.ts";

// Settings round 8 · Settings history: every row reads in plain words. The cases are real rows from
// the log (2026-11-12), so a writer's label or value shape that reads badly shows up here first.

const row = (sectionKey, settingKey, settingLabel, oldValue, newValue, changeType = "update") => ({ sectionKey, settingKey, settingLabel, oldValue, newValue, changeType });
const say = (...args) => changeSentence(describeChange(row(...args)));

test("money is dollars, never cents; durations and shares read as words", () => {
  assert.equal(say("accounting", "invoice_tolerance_cents", "Invoice tolerance cents", "5000", "2500"), "Flag a bill that differs by more than $50.00 → $25.00");
  assert.equal(say("accounting", "tax_1099_threshold_cents", "Tax 1099 threshold cents", "200000", "60000"), "1099 threshold $2,000.00 → $600.00");
  assert.equal(say("sales-preferences", "price_band_max_cents", "Price band max cents", "1450", "1500"), "Price band max $14.50 → $15.00");
  assert.equal(say("accounting", "producer_default_split_bp", "Producer default split bp", null, "4000", "create"), "Producer default split set to 40%");
  assert.equal(say("accounting", "bank_window_days", "Bank window days", "21", "3"), "Bank match: days to look either side 21 days → 3 days");
  assert.equal(say("compliance", "transfer_gate.gate.timeoutMs", "Transfer gate › gate › timeoutMs", "2000", "2500"), "Time allowed for each transfer check 2 seconds → 2.5 seconds");
  assert.equal(say("compliance", "deletion_requests.deletion.holdDays", "Deletion requests › deletion › holdDays", "7", "10"), "Hold a deletion request for 7 days → 10 days");
});

test("keys and enum values become words; switches say on or off", () => {
  assert.equal(say("retention", "queue_owner_save_queue", "Queue owner save queue", "writing_agent", "admin"), "Who works the save queue Writing agent → Admin");
  assert.equal(say("calling-windows", "noSunday", "No calls on Sundays", "false", "true"), "No calls on Sundays turned on");
  assert.equal(say("products", "products.final_expense", "Sells Final Expense", "true", "false"), "Sells Final Expense turned off");
  assert.equal(cleanLabel("Complaint deadlines › complaints › redDays"), "Complaint deadlines › Red days");
  assert.equal(cleanLabel("Retention rules › call attempt logs:CA"), "Retention rules › Call attempt logs (CA)");
  assert.equal(cleanLabel("American Amicable › First payment › Grace days"), "American Amicable › First payment › Grace days");
  assert.equal(say("accounting", "tax_category:commission_entry_type:advance", "Tax category:commission entry type:advance", "other", "gross_receipts"), "Tax category for advance commission Other → Gross receipts");
});

test("no raw ids, JSON or key prefixes on screen", () => {
  const stage = "758c8f91-1fa8-4395-919a-12dac2bd95f2";
  assert.equal(say("dispositions", "mapping:application_submitted", "Outcome “application_submitted” moves the lead", null, `to stage ${stage}`, "create"), "Outcome “Application submitted” moves the lead set to another stage");
  assert.equal(changeSentence(describeChange(row("dispositions", "mapping:x", "Outcome “x” moves the lead", null, `to stage ${stage}`, "create"), { [stage]: "Submitted" })), "Outcome “X” moves the lead set to “Submitted”");
  const person = "1a01e923-c071-422d-96dd-08ff23e23075";
  assert.equal(say("compliance", "purge_job.purge.recipients", "Purge job › purge › recipients", "[]", JSON.stringify([person])), "Who hears about each purge None → 1 person");
  assert.equal(valueWords(JSON.stringify([person]), null, { [person]: "Dana Ruiz" }), "Dana Ruiz");
  assert.equal(say("integrations", "api_key:0b0c", "API key “Old CRM export”", "isk_94cnKJgL…", null, "delete"), "API key “Old CRM export” revoked");
  const deadline = say("compliance", "complaint_deadlines.CA", "Complaint deadlines › CA", null, JSON.stringify({ notes: "CA CDI request for information: 21 days.", response_days: 21 }), "create");
  assert.equal(deadline, "Complaint deadlines › CA set to 21 days · CA CDI request for information: 21 days.");
  const rule = say("compliance", "retention_rules.lead_data_unconverted", "Retention rules › lead data unconverted", null, JSON.stringify({ basis: "our_policy", notes: "Two years.", action: "purge", retain_days: 730 }), "create");
  assert.match(rule, /Keep 2 years · then purge · Two years\./);
  for (const sentence of [deadline, rule]) assert.doesNotMatch(sentence, /[{}[\]"]|_/);
  assert.equal(say("business-identity", "timezone", "Business timezone", null, "America/New_York", "create"), "Business timezone set to Eastern time");
  assert.equal(say("business-identity", "phone", "Business phone", null, "3243242444", "create"), "Business phone set to (324) 324-2444");
  assert.equal(say("business-identity", "postalCode", "ZIP code", null, "40000", "create"), "ZIP code set to 40000");
});

test("what happened reads as a verb: archived, edited, removed, uploaded, back to the default", () => {
  assert.equal(say("pipelines", "stage:x", "Stage “QA save fix”", null, "archived"), "Stage “QA save fix” archived");
  assert.equal(say("dispositions", "disposition:x", "Call outcome “QA outcome fix”", null, "edited"), "Call outcome “QA outcome fix” edited");
  assert.equal(say("team-access", "member:x", "Invitation for qa@insurvas.test", "invited", null, "delete"), "Invitation for qa@insurvas.test removed");
  assert.equal(say("business-identity", "logo", "Logo", null, "New logo uploaded"), "Logo uploaded");
  assert.equal(say("retention", "ladder", "Ladder", "3", null, "reset_to_default"), "Ladder back to the default");
  const long = describeChange(row("accounting", "payout_statement_footer", "Payout statement footer", null, "Questions about this statement? Reply within 10 days. Payments are sent by ACH on the 15th.", "create"));
  assert.ok(long.long);
  assert.match(long.phrase, /^set to “Questions about this statement\?/);
});

test("kinds, sections, people and saves", () => {
  assert.deepEqual(["create", "update", "delete", "reset_to_default"].map(kindOf), ["added", "changed", "removed", "reset"]);
  assert.equal(areaLabel("sales-preferences"), "Sales process");
  assert.equal(areaLabel("dispositions"), "Pipelines & outcomes");
  assert.equal(areaLabel("accounting", (id) => (id === "accounting" ? "Accounting" : undefined)), "Accounting");
  assert.equal(wherePath("sales-preferences"), "Settings › Sales process › Quote & case checks");
  assert.equal(initials("Dana Ruiz"), "DR");
  assert.equal(initials("Insurvas"), "IN");
  const a = { actorUserId: "u", actorName: "Dana", sectionKey: "accounting", occurredAt: "2026-11-12T14:18:05Z" };
  assert.equal(saveKey(a), saveKey({ ...a, occurredAt: "2026-11-12T14:18:55Z" }));
  assert.notEqual(saveKey(a), saveKey({ ...a, sectionKey: "retention" }));
});

test("the export is the rows on screen, in the words on screen, and safe in a spreadsheet", () => {
  const entries = [
    { id: "1", sectionKey: "accounting", settingKey: "invoice_tolerance_cents", settingLabel: "Invoice tolerance cents", oldValue: "2500", newValue: "1500", changeType: "update", actorUserId: "u", actorName: "Dana Ruiz", actorRole: "admin", occurredAt: "2026-11-12T14:18:00Z", source: "ui", reason: null },
    { id: "2", sectionKey: "business-identity", settingKey: "dba", settingLabel: "Trading name", oldValue: null, newValue: "=HYPERLINK(\"x\")", changeType: "create", actorUserId: null, actorName: null, actorRole: null, occurredAt: "2026-11-11T10:00:00Z", source: "system", reason: null },
  ];
  const lines = plainHistoryCsv(entries).trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /"Who","Role then","Section","Setting","Before","After","Kind"/);
  assert.match(lines[1], /"Dana Ruiz","Admin","Accounting","Flag a bill that differs by more than","\$25\.00","\$15\.00","Changed"/);
  assert.match(lines[2], /"Insurvas",.*"'=HYPERLINK/);
});

test("the screen is built from the plain words and keeps the owner-only rule", () => {
  const read = (file) => fs.readFileSync(file, "utf8");
  const screen = read("components/app/settings/settings-history.tsx");
  assert.match(screen, /describeChange\(/);
  assert.doesNotMatch(screen, /changeLine\(|font-mono/, "the row never shows the stored value");
  assert.match(screen, /<Sheet\b/);
  assert.doesNotMatch(screen, /<Callout\b/, "no notice cards: problems ride the status line");
  const detail = read("components/app/settings/history/change-detail.tsx");
  assert.match(detail, /Show technical details/);
  assert.match(detail, /Copy/);
  const route = read("app/api/app/settings-audit/route.ts");
  assert.match(route, /settingsAuditIdNames\(/);
  assert.match(route, /onlyActor: q\.mine \? auth\.context\.userId : undefined/);
});
