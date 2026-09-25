// Run with: npm test
//
// The design contract, as a drift guard.
//
// `docs/design/` specifies every page in the product. Prose cannot stop a redesign from quietly
// breaking navigation, widening a gate, or shipping internal vocabulary — so the invariants that
// are mechanically checkable are checked here instead of trusted.
//
// Every test carries a KNOWN list. It is empty: all nineteen defects in
// `docs/design/05-DEFECT-REGISTER.md` are fixed, so any violation now is a new one. If a future
// change has to land a violation deliberately, add it to the relevant list with its reason — the
// assertion fails in BOTH directions, so a list entry that is no longer true is itself a failure,
// and a detector that silently stops matching is caught by its own list going missing.
//
// DB-free and network-free by design: this reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const tsx = [...walk("app"), ...walk("components")].filter((f) => f.endsWith(".tsx"));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const sources = new Map(tsx.map((f) => [f, read(f)]));

const routes = walk("app")
  .filter((f) => f.endsWith("/page.tsx"))
  .map((f) => f.replace(/^app/, "").replace(/\/page\.tsx$/, "").replace(/\/\([^)]+\)/g, ""))
  .map((r) => (r === "" ? "/" : r));

/**
 * Whether a link actually lands somewhere.
 *
 * `/app/[section]` is a catch-all, so a naive route match says every `/app/anything` exists. It does
 * not: the page looks the segment up in the menu and calls notFound() when it is absent. That is
 * exactly how `/app/team` and `/app/audit-log` used to reach a 404 while looking like valid routes.
 */
const CATCH_ALL = "/app/[section]";
const staticMatchers = routes
  .filter((r) => r !== CATCH_ALL)
  .map((r) => new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`));
const menuSource = readFileSync(join(ROOT, "lib/menu/definition.ts"), "utf8");
const menuSegments = new Set([...menuSource.matchAll(/path: "\/app\/([a-z-]+)"/g)].map((m) => m[1]));

const routeExists = (href) => {
  if (staticMatchers.some((re) => re.test(href))) return true;
  const segment = href.match(/^\/app\/([a-z-]+)$/)?.[1];
  return segment !== undefined && menuSegments.has(segment);
};

/** Asserts a KNOWN list is exactly the set of violations — no new ones, and none already fixed. */
function assertKnown(found, known, what) {
  const foundSet = new Set(found);
  const knownSet = new Set(known);
  assert.deepEqual(
    [...foundSet].filter((v) => !knownSet.has(v)),
    [],
    `NEW ${what}. The design contract in docs/design/ forbids this.`,
  );
  assert.deepEqual(
    [...knownSet].filter((v) => !foundSet.has(v)),
    [],
    `${what} listed as known but no longer present — delete these from the KNOWN list in this test.`,
  );
}

// ── 1 · Navigation must not point at a route that does not exist (D-03, D-04) ────────────────
test("every internal link points at a route that exists", () => {
  const KNOWN = [];
  const found = [];
  for (const [file, src] of sources) {
    for (const match of src.matchAll(/href=\{?["'`](\/[^"'`{}\s]*)["'`]/g)) {
      const href = match[1].split(/[?#]/)[0].replace(/\/$/, "") || "/";
      if (href.includes("${")) continue; // runtime id; not statically checkable
      if (href.startsWith("/api/")) continue; // endpoints are checked against app/api separately
      if (!routeExists(href)) found.push(`${file} -> ${href}`);
    }
  }
  assertKnown(found, KNOWN, "dead internal link(s)");
});

// ── 2 · Every icon the menu names must exist in the sidebar's map (D-05) ─────────────────────
//
// `iconFor()` falls back to a featureless Circle for an unknown name, so a missing entry is
// invisible in review and looks deliberate on screen. This recurs whenever a menu item is added.
test("every menu icon resolves to a real icon in the agent sidebar", () => {
  const KNOWN = [];
  const sidebar = read("components/app/agent-sidebar.tsx");
  const start = sidebar.indexOf("const ICONS = {");
  assert.notEqual(start, -1, "the ICONS map has moved or been renamed");
  const block = sidebar.slice(start, sidebar.indexOf("} as const;", start));
  const available = new Set([...block.matchAll(/^\s*"?([a-z-]+)"?:/gm)].map((m) => m[1]));

  const found = [];
  for (const item of menuSource.matchAll(/key: "([^"]+)"[\s\S]{0,400}?icon: "([^"]+)"/g)) {
    const [, key, icon] = item;
    if (!available.has(icon)) found.push(`${icon} (${key})`);
  }
  assertKnown(found, KNOWN, "menu icon(s) with no entry in the sidebar ICONS map");
});

// ── 3 · A gated page must gate itself (D-06) ─────────────────────────────────────────────────
//
// Enforcement point 2 of 3. The API still refuses when this is missing, so no data leaks — but the
// reader gets full page chrome and broken panels instead of the notice every other page shows.
test("every shell page whose menu item requires a feature calls guardPage", () => {
  const KNOWN = [];

  // One menu entry at a time. Scanning a fixed window ahead would find the NEXT item's
  // required_feature and wrongly mark Dashboard — ungated on purpose — as gated.
  const gatedPaths = new Set(
    [...menuSource.matchAll(/\{ key: "[^"]+",[^}]*\}/g)]
      .map((m) => m[0])
      .filter((entry) => entry.includes("required_feature:"))
      .map((entry) => entry.match(/path: "(\/app\/[a-z-]+)"/)?.[1])
      .filter(Boolean),
  );
  assert.ok(gatedPaths.size > 10, "the menu shape has changed; this test is no longer reading it");
  assert.ok(!gatedPaths.has("/app/dashboard"), "Dashboard is ungated by design and must stay so");

  const found = [];
  for (const [file, src] of sources) {
    if (!file.startsWith("app/app/(shell)/") || !file.endsWith("/page.tsx")) continue;
    const route = file.replace(/^app/, "").replace(/\/page\.tsx$/, "").replace(/\/\([^)]+\)/g, "");
    if (!gatedPaths.has(route)) continue;
    // A redirect-only alias never renders, so it needs no guard.
    if (src.includes("redirect(") && src.split("\n").length < 10) continue;
    if (!src.includes("guardPage")) found.push(file);
  }
  assertKnown(found, KNOWN, "gated page(s) missing guardPage");
});

// ── 4 · The eyebrow is the menu section, never a mockup file number (D-01) ───────────────────
//
// `docs/uiux-mockups/brex/` names its files `22-agent-policies.png`. Six screens rendered that
// index as their eyebrow. `sectionForPath()` in lib/menu/definition.ts is where it comes from now.
test("no page eyebrow is a bare number", () => {
  const KNOWN = [];
  const found = [];
  for (const [file, src] of sources) {
    for (const match of src.matchAll(/eyebrow[^>]*>\s*([^<{][^<]*)</g)) {
      const copy = match[1].trim();
      if (/^\d+\s*\//.test(copy)) found.push(`${file}: ${copy}`);
    }
  }
  assertKnown(found, KNOWN, "page eyebrow(s) rendering a mockup index number");
});

// ── 5 · Internal vocabulary must not reach a customer or an operator (D-02) ──────────────────
test("no user-visible copy contains an internal ticket id", () => {
  const KNOWN = [];
  const found = [];
  for (const [file, src] of sources) {
    for (const line of src.split("\n")) {
      const trimmed = line.trimStart();
      // Code comments are where this vocabulary belongs.
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      for (const attr of line.matchAll(/(?:title|subtitle|description|label|blurb|detail)=\{?"([^"]*)"/g)) {
        for (const id of attr[1].matchAll(/\b(?:SA|LA)-\d+(?:\.\d+)?/g)) found.push(`${file}: ${id[0]}`);
      }
      for (const jsx of line.matchAll(/>([^<>{]*\b(?:SA|LA)-\d+(?:\.\d+)?[^<>]*)</g)) {
        for (const id of jsx[1].matchAll(/\b(?:SA|LA)-\d+(?:\.\d+)?/g)) found.push(`${file}: ${id[0]}`);
      }
    }
  }
  assertKnown([...new Set(found)], KNOWN, "internal ticket id(s) in user-visible copy");
});

// ── 6 · Dark mode must reach every portal root (D-07) ──────────────────────────────
//
// The dark tokens are declared once. A root carrying only `portal-partner` used to keep the light
// tokens, so a partner with dark mode on got a white page at sign-in and a dark workspace after it.
//
// There are two ways for that to be impossible, and the test accepts either:
//
//   A. The dark tokens are re-declared under a selector that names both roots, so a
//      `portal-partner`-only root picks them up. This was the original fix.
//   B. The portal roots declare no palette at all — the themed tokens live on `:root` / `.dark` and
//      a portal root only paints a ground — so there is no light palette for such a root to keep.
//      This is what the redesign left behind, and it is the stronger guarantee: it cannot be
//      forgotten on a new root, because there is nothing to forget.
//
// If neither holds, every `portal-partner`-only root is reported, as before.
test("dark mode covers both portal roots", () => {
  const KNOWN = [];
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");

  const darkCoversBoth = /\.dark\s+:is\([^)]*portal-partner/.test(css);

  const portalRootDeclaresTokens = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(
    ([, selector, body]) =>
      selector.split(",").some((one) => /^\.portal-(agent|partner)$/.test(one.trim())) &&
      /(^|[\s;])--[a-z]/i.test(body),
  );

  const found = [];
  if (!darkCoversBoth && portalRootDeclaresTokens) {
    for (const [file, src] of sources) {
      for (const match of src.matchAll(/className="([^"]*)"/g)) {
        // Exact class tokens only: `portal-partner-pipeline-page` is a page style hook, not a root.
        const classes = match[1].split(/\s+/);
        if (classes.includes("portal-partner") && !classes.includes("portal-agent")) found.push(file);
      }
    }
  }
  assertKnown([...new Set(found)], KNOWN, "portal root(s) that dark mode does not reach");
});

// ── 7 · A control that looks actionable must do something (D-12) ─────────────────────────────
//
// A `⋯` that opens nothing is worse than no `⋯`: the reader concludes the product is broken rather
// than that the feature is absent. Dropdown triggers carry asChild on their parent and are excluded.
//
// The sanctioned alternative is `components/admin/void-invoice-dialog.tsx`: disabled, with the
// reason printed directly beneath it.
test("no button is rendered without a handler, a form, or an explanation", () => {
  const KNOWN = [];
  const found = [];
  for (const [file, src] of sources) {
    for (const match of src.matchAll(/<(button|Button)(\s[^>]*?)?>/gs)) {
      const attrs = match[2] ?? "";
      if (/onClick|asChild|onMouseDown|onPointerDown|type=["']submit["']|disabled/.test(attrs)) continue;
      const before = src.slice(Math.max(0, match.index - 3000), match.index);
      // A bare <button> inside a form defaults to type=submit, which is a handler.
      if (before.lastIndexOf("<form") > before.lastIndexOf("</form>")) continue;
      // <DropdownMenuTrigger asChild><Button …> and <DialogClose asChild><Button …>: the handler
      // belongs to the parent, which renders this element as its trigger.
      if (/asChild\s*>\s*$/.test(before)) continue;
      found.push(`${file}:${src.slice(0, match.index).split("\n").length}`);
    }
  }
  assertKnown([...new Set(found)], KNOWN, "control(s) with no handler");
});

// ── 8 · A component nothing imports is either wired or deleted (D-13, D-14, D-15) ────────────
//
// Orphans are not merely dead weight here. `dialer-preflight.tsx` was a complete, tested screen
// with no route, and `partner-hierarchy.tsx` would have shipped a Save button that discarded every
// change if anyone had wired it as it stood.
test("no component is orphaned", () => {
  const KNOWN = [];
  const importable = [...walk("app"), ...walk("components"), ...walk("lib")].filter(
    (f) => f.endsWith(".tsx") || f.endsWith(".ts"),
  );
  const bodies = new Map(importable.map((f) => [f, read(f)]));

  const found = [];
  for (const file of tsx) {
    if (!file.startsWith("components/")) continue;
    const alias = `@/${file.replace(/\.tsx$/, "")}`;
    const base = file.split("/").pop().replace(/\.tsx$/, "");
    let used = false;
    for (const [other, src] of bodies) {
      if (other === file) continue;
      if (src.includes(alias) || src.includes(`./${base}"`) || src.includes(`./${base}'`)) {
        used = true;
        break;
      }
    }
    if (!used) found.push(file);
  }
  assertKnown(found, KNOWN, "orphaned component(s)");
});

// ── 9 · The three enforcement points must agree on who may see money ─────────────────────────
//
// `/app/campaigns` shows spend and cost per lead; `/app/import` does not. The menu, the page and
// the API must draw that line in the same place, or the screen renders for a role the API refuses
// and becomes a page of error toasts.
test("the money screens are owner and producer only, in the menu and on the page", () => {
  for (const key of ["leads.campaigns", "insight.scoring"]) {
    const entry = menuSource.slice(menuSource.indexOf(`key: "${key}"`));
    const roles = entry.slice(0, entry.indexOf("})")).match(/required_roles: \[([^\]]+)\]/);
    assert.ok(roles, `${key} has no required_roles — money screens must name their roles`);
    assert.deepEqual(
      roles[1].split(",").map((r) => r.trim().replace(/"/g, "")).sort(),
      ["owner", "producer"],
      `${key} must stay owner+producer: it exposes spend, and the API enforces the same boundary`,
    );
  }

  for (const file of ["app/app/(shell)/campaigns/page.tsx", "app/app/(shell)/scoring/page.tsx"]) {
    const src = sources.get(file);
    assert.match(src, /guard\.role/, `${file} must check the role, not only the entitlement`);
    assert.match(src, /RoleGateNotice/, `${file} must refuse a wrong role with the shared notice`);
  }
});

// ── 10 · The unbuilt-destination page must keep its three properties ─────────────────────────
//
// Twenty-four menu items route through ComingSoon. It never gives a date, it says the plan already
// includes the feature, and it always offers somewhere else to go.
test("ComingSoon promises no date, confirms the plan, and offers a way out", () => {
  const src = read("components/app/coming-soon.tsx");

  assert.match(src, /Your plan includes this/, "the reassurance that this is not something to buy");
  assert.match(src, /In the meantime/, "onward links — a dead end that apologises is still a dead end");
  assert.match(src, /available\.filter/, "onward links must come from what this agent can open");

  const copy = [...src.matchAll(/>([^<>{]{4,})</g)].map((m) => m[1]).join(" ");
  assert.doesNotMatch(
    copy,
    /\bQ[1-4]\b|\bsoon\b|\bnext (?:week|month|quarter|year)\b/i,
    "ComingSoon must not promise a date",
  );

  // Entitlement is decided before build status, so a customer without the plan is told about their
  // plan rather than about our roadmap.
  const page = read("app/app/(shell)/[section]/page.tsx");
  assert.ok(
    page.indexOf("FeatureGateNotice") < page.indexOf("ComingSoon"),
    "the entitlement gate must be evaluated before the build status",
  );
});

// ── 11 · The eyebrow is derived, not typed ───────────────────────────────────────────────────
//
// The rule behind D-01. Deriving it from the menu is what stops thirty-eight hand-written
// taxonomies growing back one page at a time.
test("sectionForPath resolves every built agent destination to its menu section", async () => {
  const { sectionForPath, allMenuItems } = await import("../menu/definition.ts");

  for (const item of allMenuItems()) {
    assert.equal(
      sectionForPath(item.path),
      item.section,
      `${item.path} must resolve to its own section`,
    );
  }
  assert.equal(sectionForPath("/app/not-a-real-page"), null, "an unknown path has no section");
});
