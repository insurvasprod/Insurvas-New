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
  assert.match(index, /sileo\.show\(/);
  assert.match(index, /detailFor\(treatment, title, options\.detail\)/);
  assert.doesNotMatch(index, /toast\[KIND/, "the old coloured sonner box is back");
  // notify.promise ends through `show`, into its own loading toast, so an outcome keeps its sound,
  // duration and suggestion; Sileo's own promise() cannot end in warn or block.
  assert.match(index, /type: "loading", duration: null/, "the promise toast no longer stays up while the work runs");
  assert.match(index, /show\(treatment \?\? fallback, title, rest, id\)/, "a promise outcome bypasses show and its rules");
  assert.doesNotMatch(index, /sileo\.promise\(/, "notify.promise was moved onto sileo.promise, which has no warn or block");
  assert.match(index, /return running;/, "notify.promise swallows the work's own result or rejection");
  // `fail: null` is for a form that shows its error beside the field: the spinner goes, nothing else.
  assert.match(index, /if \(outcome === null\) return sileo\.dismiss\(id\)/, "fail: null no longer just clears the spinner");
  for (const file of [["components", "app", "carrier-file-upload.tsx"], ["components", "app", "statement-import.tsx"]]) {
    const source = readFileSync(join(process.cwd(), ...file), "utf8");
    assert.match(source, /notify\.promise\(/, `${file.join("/")} no longer shows its upload as a toast`);
    assert.match(source, /fail: null/, `${file.join("/")} now toasts an error the dialog already shows where it can be fixed`);
  }
});
