import assert from "node:assert/strict";
import test from "node:test";

import { callbackWindowFacts, hourLabel, insideWindow, windowSummary } from "./windowFacts.ts";

const federal = { startHour: 8, endHour: 21 };
const rules = [{ state: "AZ", startHour: 8, endHour: 20, noSunday: false }, { state: "TX", startHour: 8, endHour: 21, noSunday: true }];

test("a state that narrows the federal window is named beside it, as the board reads", () => {
  const facts = callbackWindowFacts("AZ", federal, rules, null);
  assert.deepEqual(facts.effective, { start: 8, end: 20 });
  assert.equal(windowSummary(facts), "8am–9pm federal, 8am–8pm AZ");
});

test("a state rule that changes nothing is not repeated", () => {
  const facts = callbackWindowFacts("TX", federal, rules, null);
  assert.equal(facts.stateWindow, null);
  assert.equal(windowSummary(facts), "8am–9pm federal");
  assert.equal(facts.noSunday, true);
});

test("the agency's own window narrows further and says so", () => {
  const facts = callbackWindowFacts("AZ", federal, rules, { startHour: 9, endHour: 18 });
  assert.deepEqual(facts.effective, { start: 9, end: 18 });
  assert.equal(windowSummary(facts), "8am–9pm federal, 8am–8pm AZ, 9am–6pm your agency");
});

test("3:00 am is outside; the end of the window is exclusive", () => {
  const facts = callbackWindowFacts("AZ", federal, rules, null);
  assert.equal(insideWindow(facts, 3, 0), false);
  assert.equal(insideWindow(facts, 14, 30), true);
  assert.equal(insideWindow(facts, 19, 59), true);
  assert.equal(insideWindow(facts, 20, 0), false);
});

test("hours read the way people say them", () => {
  assert.deepEqual([0, 8, 12, 21].map(hourLabel), ["12am", "8am", "12pm", "9pm"]);
});
