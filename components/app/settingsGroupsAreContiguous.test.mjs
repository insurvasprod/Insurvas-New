// Run with: npm test
//
// AgentSettingsTabs groups by consecutive runs, on purpose: the rail's order is the caller's order,
// so the rail and the page can never drift apart. The cost of that choice is that an interleaved
// list silently renders the same heading twice.
//
// It had. `lead-posting` sat inside the "How you call" block and `queue-sla` inside the other, so
// the settings rail showed both headings twice, React saw two children with the same key, and the
// reconciler then threw NotFoundError from insertBefore — which aborted hydration for the page and
// left the whole rail unclickable. A list order caused a dead page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The list moved out of the page into its own module (search reads it too), so that is where the
// groups are checked.
const page = readFileSync(join(process.cwd(), "lib", "settings", "sections.ts"), "utf8");

test("every settings group is listed in one unbroken run", () => {
  const groups = [...page.matchAll(/\{ group: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(groups.length > 6, `only found ${groups.length} tabs — the parser has lost the list`);

  // Collapse to the runs the component will build, then check no name opens twice.
  const runs = groups.filter((g, i) => g !== groups[i - 1]);
  const seen = new Set();
  for (const group of runs) {
    assert.equal(
      seen.has(group),
      false,
      `"${group}" starts a second run, so the rail renders that heading twice and React sees a duplicate key`,
    );
    seen.add(group);
  }
});

test("the rail keys a group by its position, not by its name", () => {
  // Belt to the braces above. Even with the list correct, a name is not an identity — two runs may
  // legitimately share one. Keying on position makes a repeat a cosmetic problem rather than a
  // crash that takes hydration down with it.
  const tabs = readFileSync(join(process.cwd(), "components", "app", "agent-settings-tabs.tsx"), "utf8");
  assert.match(
    tabs,
    /grouped\.map\(\(\{ group, items \}, index\)/,
    "the group runs are no longer indexed, so their keys depend on the group name again",
  );
  assert.match(
    tabs,
    /key=\{`\$\{group \?\? "ungrouped"\}-\$\{index\}`\}/,
    "a group run is keyed by name alone again — a repeated name will crash hydration",
  );
});
