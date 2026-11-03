// Run with: npm test
//
// LA-2.19 criterion 5 was "dispute rate per vendor appears on the scorecard". **Decision 11 deleted
// that metric**, and the reasoning is worth keeping because it is the sharpest thing in the decision
// log: dispute rate "measures claims Ray made, not bad leads the vendor sold. A vendor who credits
// readily invites more claims and scores worse; a vendor who refuses everything scores clean." It is
// a behavioural metric about the buyer wearing the costume of a quality metric about the seller.
//
// Two metrics replaced it, and the decision is explicit that they must stay apart:
//
//   Undialable rate        Is their product any good?      LOW is good
//   Claim acceptance rate  Are they decent to deal with?   HIGH is good
//
//   "The two metrics answer two different questions and must never be blended into one score."
//   "…with their directions stated on the screen."
//
// The replacement landed; the directions did not. Two bare percentages side by side are read the
// same way — 18% undialable and 18% claim acceptance look consistent, and are bad twice. Fixed, and
// pinned here, because a column header is exactly the kind of thing a later tidy-up shortens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = process.cwd();
const WORKSPACE = "components/app/true-cpa-workspace.tsx";
const source = readFileSync(join(ROOT, WORKSPACE), "utf8");

test("the two vendor-quality metrics carry their directions on the screen", () => {
  assert.match(
    source,
    /Undialable rate<span[^>]*>Low is good/,
    "the undialable-rate column no longer says which way is good",
  );
  assert.match(
    source,
    /Claim acceptance<span[^>]*>High is good/,
    "the claim-acceptance column no longer says which way is good",
  );
  // And that they are not to be combined, which is the half a reader cannot infer from the headers.
  assert.match(
    source,
    /answer different questions and are never combined into one score/,
    "nothing on the page says the two metrics must not be blended",
  );
});

test("dispute rate has not come back", () => {
  // It is not a column that was renamed; it is a metric that was deleted. A reappearance means
  // somebody read the LA-2.19 task page, which still lists it, without reading decision 11.
  function sources(dir) {
    const absolute = join(ROOT, dir);
    const found = [];
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (["node_modules", ".next"].includes(entry.name)) continue;
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) found.push(...sources(child));
      else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(child);
    }
    return found;
  }
  const offenders = ["lib/vendorScorecard", "components/app", "app/api/app/true-cpa", "app/api/app/vendor-returns"]
    .filter((dir) => {
      try { return statSync(join(ROOT, dir)).isDirectory(); } catch { return false; }
    })
    .flatMap(sources)
    .filter(([]) => true)
    .filter((path) => /dispute[_ ]?rate/i.test(readFileSync(join(ROOT, path), "utf8")));

  assert.deepEqual(
    offenders,
    [],
    `dispute rate is back on the vendor scorecard; decision 11 replaced it with undialable rate ` +
      `and claim acceptance rate:\n  ${offenders.join("\n  ")}`,
  );
});
