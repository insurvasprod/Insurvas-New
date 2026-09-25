// Run with: npm test
//
// LA-1.12 acceptance criterion 1: "Exactly one disposition vocabulary exists in the codebase —
// **verified by search**." The criterion names its own instrument, so this is it.
//
// Also LA-1.12 criterion 3 ("No flow logic is compiled into the wizard component") and LA-1.11
// criterion 4 ("The panel renders any product's form without product-specific code") — three
// negative claims about the same pair of screens, which no single runtime check can establish.
//
// The traps these come from are quoted in the tickets:
//
//   "One specific flow's logic is hardcoded inside the generic wizard, reading steps by array
//    position. That belongs in a template."
//
//   "Collapse four disposition vocabularies into one."
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, sep } from "node:path";

const ROOT = process.cwd();

/** The vocabulary LA-1.12 seeds, tenant-scoped and editable. Live on 2026-09-22: 125 tenants, 8 each. */
const CANONICAL = [
  "application_submitted",
  "sent_to_underwriting",
  "callback_scheduled",
  "did_not_qualify",
  "no_payment_method",
  "not_interested",
  "do_not_call",
  "call_dropped",
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

const sources = () =>
  ["lib", "app", "components"]
    .flatMap((dir) => walk(join(ROOT, dir)))
    .map((file) => [file.slice(ROOT.length + 1).split(sep).join("/"), readFileSync(file, "utf8")])
    .filter(([path]) => path !== "lib/supabase/database.types.ts");

const namesKeys = (source) =>
  CANONICAL.filter((key) => source.includes(`'${key}'`) || source.includes(`"${key}"`) || source.includes(`\`${key}\``));

/**
 * Files allowed to name most of the vocabulary, each for a stated reason.
 *
 * `lib/pipelines/service.ts` is the seed — the one place the eight are defined, which is what
 * "exactly one vocabulary" means.
 *
 * The two dialer files are a **separate vocabulary that shares four names**, and that is a finding
 * rather than an exemption. `app/api/app/dialer/attempt/[id]/disposition/route.ts` declares
 * `z.enum(["no_answer", "voicemail", "busy", "call_dropped", "not_interested", "callback_scheduled",
 * "application_submitted"])` — three of which are not tenant dispositions at all — and consults no
 * tenant configuration, so renaming or disabling a disposition has no effect there.
 *
 * A call ATTEMPT outcome ("no answer", "busy") is genuinely a different fact from a WORK ITEM
 * disposition, so this is not simply a duplicate. What it is, is two vocabularies sharing four key
 * names with nothing marking which is which. The dialer belongs to LA-2.x; resolving the overlap is
 * recorded there rather than forced here. They are listed so the count cannot grow quietly.
 */
const ALLOWED_TO_NAME_MANY = new Set([
  "lib/pipelines/service.ts",
  "app/api/app/dialer/attempt/[id]/disposition/route.ts",
  "components/app/dialer-workspace.tsx",
]);

test("only the seed defines the disposition vocabulary", () => {
  // Naming a key or two is a reference. Naming four or more is a vocabulary.
  const offenders = sources()
    .filter(([path]) => !ALLOWED_TO_NAME_MANY.has(path))
    .filter(([path]) => !path.endsWith(".test.mjs"))
    .map(([path, source]) => [path, namesKeys(source)])
    .filter(([, keys]) => keys.length >= 4)
    .map(([path, keys]) => `${path}: [${keys.join(", ")}]`);

  assert.deepEqual(
    offenders,
    [],
    `a second disposition vocabulary. The tenant's set lives in the dispositions table and is ` +
      `editable; a hardcoded list cannot follow it:\n  ${offenders.join("\n  ")}`,
  );
});

test("the allowlist names only files that still exist and still hold a vocabulary", () => {
  // Fails in the other direction. A stale exemption is how one of these quietly stops being
  // reviewed — and if a dialer file drops its hardcoded enum, that is the LA-2.x fix landing and
  // this list should shrink.
  const byPath = new Map(sources());
  const stale = [...ALLOWED_TO_NAME_MANY].filter(
    (path) => !byPath.has(path) || namesKeys(byPath.get(path)).length < 4,
  );

  assert.deepEqual(
    stale,
    [],
    `allowlisted file(s) that no longer hold a disposition vocabulary — remove them from ` +
      `ALLOWED_TO_NAME_MANY:\n  ${stale.join("\n  ")}`,
  );
});

test("no flow logic is compiled into the disposition wizard", () => {
  // LA-1.12 criterion 3, and the named trap: "reading steps by array position".
  const path = join(ROOT, "components", "app", "disposition-wizard.tsx");
  if (!existsSync(path)) return;
  const code = readFileSync(path, "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const byPosition = /(steps|nodes|path|answers|options)\s*\[\s*\d+\s*\]/.exec(code);
  assert.equal(
    byPosition,
    null,
    `the wizard reads the flow by array position (${byPosition?.[0]}). The graph is configuration; ` +
      `walk it by id`,
  );

  // `callback_scheduled` is deliberately excepted, and the distinction matters.
  //
  // The criterion targets FLOW logic — a particular tenant's decision tree baked into a component
  // every tenant shares. The wizard walks the configured graph by id, which the assertion above
  // proves. What it also does is reveal a date, an assignee and an idempotency key when the chosen
  // outcome is a callback, because that is the one disposition in the seeded set that creates
  // future work: LA-1.12's own write-target table lists "callback sub-type" on the lead, and
  // `lib/dispositions/service.ts` branches on the same key for the same reason.
  //
  // A disposition that needs extra fields is not a flow. Any OTHER key appearing here would be.
  const named = namesKeys(code).filter((key) => key !== "callback_scheduled");
  assert.deepEqual(
    named,
    [],
    `the wizard branches on specific disposition keys [${named.join(", ")}], so one tenant's flow ` +
      `is compiled into a component every tenant shares`,
  );
});

test("no lead screen renders its form with product-specific code", () => {
  // LA-1.11 criterion 4 ("the panel renders any product's form without product-specific code") and
  // LA-1.20 criterion 4 ("the form renders for any product with no product-specific code"). One
  // rule, three screens that all render from the same LA-1.4 definition — "one source of truth,
  // two views".
  //
  // Two discriminators, because either alone lets the other through:
  //
  //   a named product     — `product === "term_life"`, the obvious form;
  //   a branch on the field — `if (lead.product_line === chosen)`, which names no product at all.
  //
  // The second is borrowed from `scripts/verify-lead-workspace.mjs`, which had the better test: a
  // renderer can decide what to draw from `product_line` without ever writing a product name, and a
  // literal-only check would call that clean. Its own comment says why it matters — "the failure is
  // invisible for every product that still happens to be handled".
  //
  // Kept here as well as there because that suite needs a live server; this runs in `npm test`.
  const products = ["term_life", "final_expense", "whole_life", "medicare", "annuity"];
  const productBranch = /(?:if|\?|&&|switch)[^\r\n]{0,80}(?:product_line|product_code)\s*(?:===|==|!==|!=|\.includes|case )/;

  const offenders = [];
  for (const file of [
    "components/app/verification-panel.tsx",
    "components/app/disposition-wizard.tsx",
    "components/app/lead-detail-workspace.tsx",
  ]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const code = readFileSync(path, "utf8")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    for (const product of products) {
      if (code.includes(`'${product}'`) || code.includes(`"${product}"`)) offenders.push(`${file}: names ${product}`);
    }
    const branch = productBranch.exec(code);
    if (branch) offenders.push(`${file}: decides from the product field — ${branch[0].trim()}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `product-specific rendering in a screen that must draw every product from its form ` +
      `definition:\n  ${offenders.join("\n  ")}`,
  );
});
