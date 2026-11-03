/**
 * No admin page turns a failed query into an empty screen.
 *
 * ## The rule this enforces
 *
 * Rule 3 of `docs/design/README.md`: **an error must never render as an empty state.** This
 * codebase has shipped that mistake repeatedly and expensively — `/app/campaigns` rendered
 * "No vendors yet" for an HTTP 500, `/api/admin/features` answered `200 {groups: []}` with its
 * table absent, and `/api/admin/invoices` answered `200 {invoices: []}` while querying columns that
 * did not exist.
 *
 * The mechanism is always the same one line:
 *
 *     const { data } = await supabase.from("x").select();   // error discarded
 *     return <Table rows={data ?? []} />;                    // failure renders as "nothing here"
 *
 * On 2026-09-21 nine such sites were live across seven admin pages, including the audit log (the
 * evidence of record), the credit-note approval queue (where emptiness reads as "nothing is waiting
 * on you") and the legal acceptance lookup (where it reads as "this customer never agreed").
 *
 * ## Why a test and not a code review
 *
 * Because the wrong version is shorter than the right one, and it is what an editor autocompletes.
 * Prose in a design document cannot stop the next page from being written that way; this can.
 *
 * ## What it does not catch
 *
 * Only the direct `const { data } = await …` form. A destructure inside a ternary or assigned from
 * a helper is invisible to it, and a page can still discard an error it explicitly reads. It is a
 * floor: it makes the common mistake impossible to commit without noticing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN = join(fileURLToPath(new URL("../../", import.meta.url)), "app", "admin");

/** `const { data } = await …` / `const { data: rows, count } = await …` — no `error` in the list. */
const SWALLOWED = /const\s*\{\s*data(?::\s*\w+)?\s*(?:,\s*count\s*)?\}\s*=\s*await\s/g;

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) found.push(path);
  }
  return found;
}

const files = sourceFiles(ADMIN).map((path) => ({
  file: path.slice(path.indexOf(`app${sep}admin`)).split(sep).join("/"),
  source: readFileSync(path, "utf8"),
}));

/**
 * Sites that may discard an error, each with the reason it is safe.
 *
 * Empty on purpose. Any entry added here is a claim that emptiness and failure are genuinely
 * indistinguishable *to the reader of that screen* — which on an admin page is rarely true, so the
 * reason has to say why rather than name the field.
 */
const ALLOWED = {};

test("no admin page discards a query error", () => {
  const found = files
    .flatMap(({ file, source }) =>
      [...source.matchAll(SWALLOWED)].map((match) => `${file}:${source.slice(0, match.index).split("\n").length}`),
    )
    .sort();

  assert.deepEqual(
    found.filter((site) => !(site in ALLOWED)),
    [],
    "NEW admin page(s) discarding a query error. Destructure `error` and throw — the route's error " +
      "boundary shows 'This page could not load' with a Try again, which is the honest answer. " +
      "Rendering `?? []` tells the reader the platform is empty. See docs/design/README.md rule 3.",
  );

  assert.deepEqual(
    Object.keys(ALLOWED).filter((site) => !found.includes(site)),
    [],
    "Site(s) listed as allowed but no longer present — delete these entries. A stale allowlist is " +
      "how a guard stops guarding, and line numbers move.",
  );
});

test("the scan actually reads the admin pages", () => {
  // A pattern that matches nothing passes the assertion above. Pin the input so a refactor cannot
  // silently turn this file into a no-op.
  assert.ok(files.length > 25, `expected >25 files under app/admin, found ${files.length}`);
  assert.ok(
    files.some(({ source }) => /const\s*\{\s*data[^}]*,\s*error/.test(source)),
    "no admin page destructures `error` at all — the pattern this test relies on has changed shape",
  );
});
