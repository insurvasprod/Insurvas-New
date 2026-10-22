import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { detailFor, suggestionFor } from "./suggest.ts";

// Owner 2026-10-22: a notification about something that went wrong says what to do next.

test("a problem with no detail gets a next step read from its title", () => {
  assert.match(suggestionFor("fail", "Failed to fetch"), /internet connection/);
  assert.match(suggestionFor("block", "Forbidden"), /account owner/);
  assert.match(suggestionFor("block", "Row 2: phone must be a valid US phone number"), /fields/);
  assert.match(suggestionFor("block", "Outside the calling window for FL"), /calling hours/);
  assert.match(suggestionFor("warn", "Lead is on the DNC list"), /can't be called/);
  assert.match(suggestionFor("fail", "Request timed out"), /took too long/);
  assert.match(suggestionFor("block", "A partner with this email already exists"), /already exists/);
});

test("anything else still gets a sensible fallback per kind of problem", () => {
  assert.match(suggestionFor("fail", "Could not save"), /Try again in a moment/);
  assert.match(suggestionFor("block", "Not possible right now"), /then try again/);
  assert.ok(suggestionFor("warn", "Imported with warnings"));
});

test("good news never gets a suggestion", () => {
  for (const treatment of ["win", "arrive", "done"]) assert.equal(suggestionFor(treatment, "Failed to fetch"), null, treatment);
});

test("the caller's own detail always wins; a detail that only repeats the title does not", () => {
  assert.equal(detailFor("fail", "Could not save", "The carrier portal is down; try after 6pm."), "The carrier portal is down; try after 6pm.");
  assert.match(detailFor("fail", "Could not save", "Could not save"), /Try again/);
  assert.equal(detailFor("done", "Saved"), undefined);
});

test("every notification goes through the card, and the card shows the suggestion", () => {
  const index = readFileSync(join(process.cwd(), "lib", "notify", "index.ts"), "utf8");
  assert.match(index, /toast\.custom\(/);
  assert.match(index, /detailFor\(treatment, title, options\.detail\)/);
  assert.doesNotMatch(index, /toast\[KIND/, "the old coloured sonner box is back");
});
