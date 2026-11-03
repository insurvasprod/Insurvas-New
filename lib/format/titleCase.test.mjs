import assert from "node:assert/strict";
import test from "node:test";

import { titleCase } from "./titleCase.ts";

test("labels, tabs and buttons read in Title Case; small words stay small", () => {
  assert.equal(titleCase("Primary state"), "Primary State");
  assert.equal(titleCase("For an agency"), "For an Agency");
  assert.equal(titleCase("Copy to my agency"), "Copy to My Agency");
  assert.equal(titleCase("Plan & billing"), "Plan & Billing");
  assert.equal(titleCase("Names and licence"), "Names and Licence");
  assert.equal(titleCase("Two-step verification"), "Two-Step Verification");
});

test("the first and last word, and a word after a colon or a dot, are always capitalised", () => {
  assert.equal(titleCase("a draft to review"), "A Draft to Review");
  assert.equal(titleCase("what it is for"), "What It Is For");
  assert.equal(titleCase("Next: set up states →"), "Next: Set Up States →");
  assert.equal(titleCase("Set up · 88%"), "Set Up · 88%");
  assert.equal(titleCase("Sign in with Google"), "Sign In With Google");
  assert.equal(titleCase("Turn off two-step"), "Turn Off Two-Step");
  assert.equal(titleCase("Sign out every other session"), "Sign Out Every Other Session");
});

test("acronyms, brands, emails, links and numbers are left exactly as written", () => {
  assert.equal(titleCase("National producer number (NPN)"), "National Producer Number (NPN)");
  assert.equal(titleCase("Card on file with Whop"), "Card on File With Whop");
  assert.equal(titleCase("Export your book (CSV)"), "Export Your Book (CSV)");
  assert.equal(titleCase("v1 and iPhone"), "v1 and iPhone");
  assert.equal(titleCase("support@insurvas.com"), "support@insurvas.com");
});

test("help text stays in sentence case: a full stop or a question means a sentence", () => {
  assert.equal(titleCase("Stored encrypted and shown masked."), "Stored encrypted and shown masked.");
  assert.equal(titleCase("Which states do you sell in?"), "Which states do you sell in?");
  assert.equal(titleCase(""), "");
});
