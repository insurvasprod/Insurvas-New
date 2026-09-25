import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../app/partner/(portal)/layout.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("../../components/partner/partner-sidebar.tsx", import.meta.url), "utf8");

test("partner mobile navigation wraps without horizontal overflow", () => {
  // clip, not hidden: `hidden` makes <main> a scroll container and breaks the sticky top bar.
  assert.match(source, /<main className=\"min-w-0 flex-1 overflow-x-clip/);
  assert.match(sidebar, /fixed inset-0 z-40 md:hidden/);
  assert.match(sidebar, /absolute inset-y-0 left-0 flex w-80 max-w-\[88vw\] flex-col overflow-y-auto/);
  assert.match(sidebar, /portal-agent-nav/);
  assert.doesNotMatch(sidebar, /overflow-x-auto/);
});
