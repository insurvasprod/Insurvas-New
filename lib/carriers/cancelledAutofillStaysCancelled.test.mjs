// Run with: npm test
//
// LA-2.15 (carrier autofill browser extension) and LA-2.16 (per-carrier field maps) are
// **Cancelled**. Decision 16 of "Sixteen Open Questions, Answered" retired both as duplicates of
// LA-3.12 / LA-3.13 / LA-3.14, written during the outbound module before the Sell module existed.
//
// Verified on 2026-09-22 that nothing was built against either: no extension directory, no
// `manifest.json`, no content script, no `carrier_forms` or `carrier_field_maps` anywhere in the
// source or in the generated types — so nothing in the live schema either.
//
// ── Why this needs a guard rather than just a note ─────────────────────────────────────────────
//
// Decision 16 ends with a live obligation: *"anything already built against LA-2.15/2.16 needs
// reviewing against LA-3.12's auth model before it ships."* Today there is nothing to review. The
// risk is the next person, who finds a tidy retired spec with a schema block in it and builds from
// that — and the LA-2 design is the one that was rejected, on security grounds:
//
//   · LA-2.15 still carries "decide the auth model before writing code" as an OPEN QUESTION.
//     LA-3.12 answered it: short-lived scoped grants, origin-bound, store-checked revocation,
//     SSN and bank numbers never in the bulk payload.
//   · LA-2.16's maps are hand-built and unversioned in review. LA-3.13's are AI-proposed,
//     human-approved, immutable once published, and refuse to publish while any SSN or banking
//     entry is unverified.
//
// A `carrier_forms` / `carrier_field_maps` table appearing in this repository is therefore not a
// feature landing early. It is the retired design landing, and this fails when it does.
//
// The test names the LA-3 tables it *does* expect, so building the right thing passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = process.cwd();

/** The schema block LA-2.16 specifies. Its presence means somebody built the cancelled version. */
const RETIRED_TABLES = ["carrier_forms", "carrier_field_maps"];
/** LA-3.13's, for contrast — these are what a correct implementation creates. */
const SUPERSEDING_TABLES = ["carrier_field_map", "carrier_field_map_step", "carrier_field_map_entry"];

function sources(dir) {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sources(child));
    else if ([".ts", ".tsx", ".mjs", ".sql"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

const tracked = ["lib", "app", "components", "scripts", "supabase/migrations"]
  .flatMap(sources)
  // The pre-2026-09-11 snapshot is a record of the legacy CRM, not something this product builds.
  .filter((path) => !path.startsWith("supabase/backups/"))
  // And this file, which has to name what it forbids in order to forbid it.
  .filter((path) => !path.endsWith("cancelledAutofillStaysCancelled.test.mjs"))
  .map((path) => [path, readFileSync(join(ROOT, path), "utf8")]);

test("the retired LA-2.16 field-map schema is not built", () => {
  const offenders = [];
  for (const [path, source] of tracked) {
    for (const table of RETIRED_TABLES) {
      // Word-bounded, so LA-3.13's `carrier_field_map_entry` does not trip the `carrier_field_maps`
      // pattern and a correct implementation is not punished for resembling the wrong one.
      if (new RegExp(`\\b${table}\\b`).test(source)) offenders.push(`${path}: ${table}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `LA-2.16 is cancelled and its schema is the version that was rejected. Build LA-3.13's ` +
      `(${SUPERSEDING_TABLES.join(", ")}) against LA-3.12's grant model instead:\n  ${offenders.join("\n  ")}`,
  );
});

test("no browser extension has been added without the LA-3.12 auth model", () => {
  // A manifest is the unambiguous signal that extension work started. Decision 16 requires it to be
  // reviewed against LA-3.12 before it ships, and LA-3.12's own rules are the ones to look for:
  // a pinned extension id, an origin-bound grant, an explicit host allowlist, never `<all_urls>`.
  const manifests = [];
  const walk = (dir) => {
    const absolute = join(ROOT, dir);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name === "manifest.json") manifests.push(child);
    }
  };
  for (const top of ["extension", "extensions", "browser-extension", "apps", "packages", "public"]) walk(top);

  for (const manifest of manifests) {
    const body = readFileSync(join(ROOT, manifest), "utf8");
    assert.doesNotMatch(
      body,
      /<all_urls>/,
      `${manifest} requests <all_urls>. LA-3.12: "host permissions come from configured carrier ` +
        `origins only", and LA-2.15's own rule was that the extension is inert off the allowlist.`,
    );
  }
});

test("nothing claims LA-2.15 or LA-2.16 as work in progress", () => {
  // Both are retired. A source file citing one as its ticket means somebody is building the
  // cancelled scope — which is different from a document explaining that they were cancelled, so
  // only code is scanned.
  const offenders = tracked
    .filter(([path]) => !path.endsWith(".md"))
    .filter(([, source]) => /LA-2\.1[56]\b/.test(source))
    .map(([path]) => path);

  assert.deepEqual(
    offenders,
    [],
    `source files attributing work to a cancelled task:\n  ${offenders.join("\n  ")}`,
  );
});
