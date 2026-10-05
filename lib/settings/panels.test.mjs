// UX-4 · settings are data: every section has a panel, every panel has a section, and the tabs
// component no longer switches on ids.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { SETTINGS_SECTIONS } = await import("./sections.ts");
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const panels = read("components/app/settings/panels.tsx");
const block = panels.slice(panels.indexOf("export const SETTINGS_PANELS"), panels.indexOf("\n};", panels.indexOf("export const SETTINGS_PANELS")));
const panelIds = [...block.matchAll(/^\s*"?([a-z-]+)"?: \(/gm)].map((m) => m[1]);
const sectionIds = SETTINGS_SECTIONS.map((section) => section.id);

test("every settings section has a panel, and every panel is reachable from a section", () => {
  assert.ok(panelIds.length >= 20, `the registry parsed (${panelIds.length} panels)`);
  assert.deepEqual(sectionIds.filter((id) => !panelIds.includes(id)), [], "sections with no panel render 'not available'");
  assert.deepEqual(panelIds.filter((id) => !sectionIds.includes(id)), [], "panels with no section are unreachable");
  assert.equal(new Set(sectionIds).size, sectionIds.length, "section ids are unique (they are the #hash deep links)");
});

test("the tabs component renders from the registry and keeps search and deep links working", () => {
  const tabs = read("components/app/agent-settings-tabs.tsx");
  assert.doesNotMatch(tabs, /switch \(active\.id\)|case "/, "the tabs are switching on ids again");
  assert.match(tabs, /const panel = SETTINGS_PANELS\[active\.id\];/);
  assert.match(tabs, /window\.location\.hash\.slice\(1\)/, "#id deep links still select a tab");
  assert.match(tabs, /description: active\.short \?\? active\.description/);
  // Search reads the same list, so it can never offer a section the page lacks.
  assert.match(read("lib/search/service.ts"), /SETTINGS_SECTIONS/);
  assert.match(read("app/app/(shell)/settings/page.tsx"), /tabs=\{SETTINGS_SECTIONS\}/);
});

test("groups stay contiguous, so the rail never shows a heading twice", () => {
  const seen = new Set();
  let last;
  for (const section of SETTINGS_SECTIONS) {
    if (section.group !== last) {
      assert.ok(!seen.has(section.group), `group "${section.group}" opens a second run at ${section.id}`);
      seen.add(section.group);
      last = section.group;
    }
  }
});
