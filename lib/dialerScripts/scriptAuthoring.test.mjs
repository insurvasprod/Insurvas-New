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

test("the script editor names the variables that exist", () => {
  // Everything the resolver is given. If a variable is added to `variables` in the service and not
  // here, an author still cannot discover it — but the reverse, naming one that does not resolve,
  // is the worse failure and is what the second half of this test catches.
  for (const token of ["{{first_name}}", "{{state}}", "{{age}}"]) {
    assert.ok(
      workspace.includes(token),
      `the script editor does not tell an author that ${token} is available`,
    );
  }
  assert.match(
    workspace,
    /anything else is replaced with nothing rather than shown/,
    "the editor no longer warns that an unknown variable silently disappears",
  );
});

test("every variable the editor advertises is one the service actually resolves", () => {
  // The direction that matters: advertising a key the resolver does not build means the author
  // writes it, sees nothing on the call, and has no way to tell why.
  // Only the ones the editor actually offers, which are the `<code>` chips — not every `{{…}}` in
  // the file. The first draft of this scan read the comment above the editor too, and reported
  // `spouse_name` (the example of a variable that does NOT exist) as an advertised one.
  const advertised = [...workspace.matchAll(/<code>\{"\{\{(\w+)\}\}"\}<\/code>/g)].map((match) => match[1]);
  assert.ok(advertised.length > 0, "the editor advertises no variables — this guard needs rewriting");

  const block = service.slice(service.indexOf("const variables = {"));
  const supported = block.slice(0, block.indexOf("};"));
  const missing = [...new Set(advertised)].filter((key) => !new RegExp(`(^|[\\s{"'.])${key}\\b`).test(supported));

  assert.deepEqual(
    missing,
    [],
    `the editor advertises variables the resolver does not build, so they render as nothing:\n  ${missing.join("\n  ")}`,
  );
});
