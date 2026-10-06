// Run with: npm test
//
// LA-2.23 criterion 1: "Variables resolve from the live lead — no placeholder text ever appears on
// screen." The resolver delivers it with one expression:
//
//   value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => variables[key] ?? "")
//
// An unknown key becomes an **empty string**. On the call that is exactly right — an agent must
// never read `{{first_name}}` aloud, and a blank is less wrong than a placeholder.
//
// While writing the script it is a trap. `{{spouse_name}}` does not warn, does not fail to save and
// does not render; it disappears, and the agent reads a sentence with a hole in it on a live call.
// The editor is the only place an author could learn which keys exist, so it names them. Pinned here
// because a card description is exactly the kind of text a later tidy-up shortens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dialerSource } from "./dialerSource.mjs";

const ROOT = process.cwd();
const workspace = dialerSource();
const service = readFileSync(join(ROOT, "lib/dialerScripts/service.ts"), "utf8");

test("an unknown script variable renders as nothing, never as a placeholder", () => {
  // The `?? ""` is the criterion. Losing it would put `{{spouse_name}}` in front of a customer.
  assert.match(
    service,
    /replace\(\/\\\{\\\{\\s\*\(\[a-zA-Z0-9_\.\]\+\)\\s\*\\\}\\\}\/g, \(_, key: string\) => variables\[key\] \?\? ""\)/,
    "the script resolver no longer blanks unknown variables",
  );
});

test("the dialer no longer shows or edits the suggested script", () => {
  // User decision 2026-10-06: the Suggested script card (and its editor) and the Rebuttals card were
  // taken off the dialer. The stored scripts, the resolver and the API are untouched.
  assert.doesNotMatch(workspace, /aria-label="Suggested script"/);
  assert.doesNotMatch(workspace, /Save new version/);
});

test("if a script editor returns, every variable it advertises is one the service actually resolves", () => {
  // The direction that matters: advertising a key the resolver does not build means the author
  // writes it, sees nothing on the call, and has no way to tell why. An editor must then also say
  // that anything else "is replaced with nothing rather than shown".
  // Only the ones the editor actually offers, which are the `<code>` chips — not every `{{…}}` in
  // the file. The first draft of this scan read the comment above the editor too, and reported
  // `spouse_name` (the example of a variable that does NOT exist) as an advertised one.
  const advertised = [...workspace.matchAll(/<code>\{"\{\{(\w+)\}\}"\}<\/code>/g)].map((match) => match[1]);
  if (advertised.length === 0) return;
  assert.match(workspace, /anything else is replaced with nothing rather than shown/);

  const block = service.slice(service.indexOf("const variables = {"));
  const supported = block.slice(0, block.indexOf("};"));
  const missing = [...new Set(advertised)].filter((key) => !new RegExp(`(^|[\\s{"'.])${key}\\b`).test(supported));

  assert.deepEqual(
    missing,
    [],
    `the editor advertises variables the resolver does not build, so they render as nothing:\n  ${missing.join("\n  ")}`,
  );
});
