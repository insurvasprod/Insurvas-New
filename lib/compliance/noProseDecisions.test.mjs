// Run with: npm test
//
// LA-1.5 acceptance criterion 5: "No compliance decision anywhere in the codebase is made by
// matching vendor prose."
//
// `screening-contract.test.mjs` proves the contract module interprets typed answers and fails closed
// on a prose-only one. That is the positive half. This is the "anywhere in the codebase" half, which
// no single module can prove about itself.
//
// The ticket is unusually specific about what it is refusing, and names the code by function:
//
//   "The existing implementation has six overlapping detectors, decides compliance status by
//    pattern-matching English prose in the vendor's response, walks JSON twelve levels deep […]
//    About 200 lines exist solely to compensate for an untyped vendor response.
//    A typed contract deletes all of it. Do not port `messageIndicatesTcpa`,
//    `deepScanTcpaLitigator`, `deepScanDncPhoneLists` or `collectPayloadRecordChain`."
//
// A named thing that must never come back is exactly what a test should hold down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();

function sourceFiles(target) {
  const absolute = join(ROOT, target);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [target];
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const child = `${target}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(child));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

const read = (path) => readFileSync(join(ROOT, path), "utf8");
const stripComments = (source) =>
  source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the four prose-matching detectors were never ported", () => {
  const banned = [
    "messageIndicatesTcpa",
    "deepScanTcpaLitigator",
    "deepScanDncPhoneLists",
    "collectPayloadRecordChain",
  ];

  const offenders = [];
  for (const path of ["lib", "app", "components"].flatMap(sourceFiles)) {
    const source = stripComments(read(path));
    for (const name of banned) {
      if (new RegExp(`\\b${name}\\b`).test(source)) offenders.push(`${path}: ${name}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `LA-1.5 names these as the implementation a typed contract replaces. They are back:\n  ${offenders.join("\n  ")}`,
  );
});

test("no compliance module decides from a prose string", () => {
  // The discriminator is the space. A compliance decision keys on an enum — `"tcpa_litigator"`,
  // `"dnc_scrub"` — and those never contain a space. A sentence does. So a string literal with a
  // space, handed to a matching call inside the compliance path, is prose being interpreted.
  //
  // `error.message` is exempt: those are OUR OWN thrown strings being categorised for logging a few
  // lines from where they are thrown, not a vendor's answer. The test below pins that coupling
  // separately.
  // The receiver is matched loosely on purpose. An earlier version anchored it to an identifier and
  // missed `String(payload).includes("is a known litigator")` — a call expression is exactly how
  // someone would reach for the vendor's whole body. So this matches the CALL, then decides from
  // what precedes it.
  const matchers = /\.\s*(includes|startsWith|endsWith|search|indexOf)\s*\(\s*(?<literal>['"`][^'"`]*['"`])/g;

  const offenders = [];
  for (const path of sourceFiles("lib/compliance")) {
    if (path.endsWith(".test.mjs")) continue;
    const source = stripComments(read(path));
    for (const match of source.matchAll(matchers)) {
      const text = match.groups.literal.slice(1, -1);
      if (!text.includes(" ")) continue; // an enum or a key, not prose
      // Our own thrown string, categorised for logging. Anything else reaching a spaced literal is
      // reading language rather than a typed field.
      const preceding = source.slice(Math.max(0, match.index - 40), match.index);
      if (/(error|cause|failure)\??\.message$/.test(preceding)) continue;
      offenders.push(`${path}: …${preceding.trimStart().slice(-24)}.${match[1]}(${match.groups.literal})`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `compliance code matching a prose string to reach a decision:\n  ${offenders.join("\n  ")}`,
  );
});

test("every error-prose matcher still has something that throws it", () => {
  // Not a criterion, but the fragility criterion 5 leaves behind. `screening.ts` and `service.ts`
  // categorise a screening failure by matching the text of an Error thrown in another module —
  // `"typed screening decision"` comes from `screening-contract.ts`, `"invalid response"` from
  // `scrub.ts`. Reword a throw and the categorisation silently degrades to "unknown" while every
  // test still passes, because the decision it feeds is only a health label.
  //
  // All four phrases had a live thrower on 2026-09-22. This keeps it that way.
  const compliance = sourceFiles("lib/compliance").filter((path) => !path.endsWith(".test.mjs"));
  const allSource = compliance.map((path) => stripComments(read(path))).join("\n");

  const matched = new Set();
  for (const path of compliance) {
    const source = stripComments(read(path));
    for (const match of source.matchAll(
      /(?:error|cause|failure)\??\.message\s*\.\s*(?:includes|startsWith|endsWith)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    )) {
      matched.add(match[1]);
    }
  }
  assert.ok(matched.size > 0, "no error-message matchers found — this test is checking nothing");

  const thrown = [...allSource.matchAll(/throw new Error\(\s*[`'"]([^`'"]+)/g)].map((entry) => entry[1]);
  const orphaned = [...matched].filter((phrase) => !thrown.some((message) => message.includes(phrase)));

  assert.deepEqual(
    orphaned,
    [],
    `compliance code categorises a failure by a phrase nothing throws any more, so that branch is ` +
      `dead and the failure will be reported as unknown:\n  ${orphaned.join("\n  ")}`,
  );
});
