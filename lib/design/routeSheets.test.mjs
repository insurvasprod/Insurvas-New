// Run with: npm test
//
// "New…" and "Invite…" open as a panel from the right (owner 2026-11-12): each is an intercepting route in its shell's
// `@sheet` slot, drawn in the one RouteSheet, gated like its full page, and listed in lib/navigation/sheetRoutes.ts so
// the shell's chrome keeps reading the page underneath. DB-free.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const { SHEET_ROUTES, isSheetRoute } = await import("../navigation/sheetRoutes.ts");

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const SLOTS = [["app/app/(shell)/@sheet", "/app"], ["app/admin/(protected)/@sheet", "/admin"]];

function interceptPages(slot) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") out.push(full);
    }
  };
  walk(join(ROOT, slot));
  return out.filter((file) => relative(join(ROOT, slot), file).startsWith("(.)"));
}

test("every panel route is listed, and every listed route has its panel and its full page", () => {
  const found = [];
  for (const [slot, base] of SLOTS) {
    for (const file of interceptPages(slot)) {
      const route = relative(join(ROOT, slot), file).split(sep).slice(0, -1).join("/").replace(/^\(\.\)/, "");
      found.push(`${base}/${route}`);
    }
  }
  assert.deepEqual([...found].sort(), [...SHEET_ROUTES].sort());
  for (const route of SHEET_ROUTES) {
    const full = route.startsWith("/admin/") ? `app/admin/(protected)${route.slice("/admin".length)}/page.tsx` : `app/app/(shell)${route.slice("/app".length)}/page.tsx`;
    assert.ok(existsSync(join(ROOT, full)), `${route}: a refresh or a shared link still opens the full page (${full})`);
  }
});

test("each panel is gated like its page, drawn in the one RouteSheet, with a sheet-shaped loading state", () => {
  for (const [slot] of SLOTS) {
    for (const file of interceptPages(slot)) {
      const source = readFileSync(file, "utf8");
      const name = relative(ROOT, file);
      assert.match(source, /guardPage\(|getCurrentAdmin\(/, `${name}: the same gate as its page`);
      assert.match(source, /<RouteSheet\b/, `${name}: the one panel`);
      assert.ok(existsSync(join(file, "..", "loading.tsx")), `${name}: a loading state shaped like the panel`);
    }
    assert.match(read(`${slot}/default.tsx`), /return null/, "nothing open on a page load");
    assert.match(read(`${slot}/[...rest]/page.tsx`), /return null/, "any other address closes the panel");
  }
  assert.match(read("app/app/(shell)/layout.tsx"), /\{sheet\}/);
  assert.match(read("app/admin/(protected)/layout.tsx"), /\{sheet\}/);
});

test("the shell's chrome reads the page under an open panel", () => {
  assert.equal(isSheetRoute("/app/producers/invite"), true);
  assert.equal(isSheetRoute("/app/producers/invite/"), true);
  assert.equal(isSheetRoute("/app/producers"), false);
  for (const file of ["components/portal/portal-page-transition.tsx", "components/ui/page-trail.tsx", "components/app/agent-sidebar.tsx", "components/admin/admin-sidebar.tsx"]) {
    const source = read(file);
    assert.match(source, /usePagePathname\(\)/, file);
    assert.doesNotMatch(source, /usePathname\(\)/, `${file}: never the raw address`);
  }
});
