// Run with: npm test
//
// The 2026 brand (docs/design/BRAND.md) as arithmetic. The bright green #07d6a0 is a superb fill and
// a terrible text colour: 1.8:1 on white. These tests read the token values from app/globals.css, in
// both themes, and hold the pairs the product depends on to WCAG AA, so a palette tweak that quietly
// breaks a button label, a link or the focus ring fails here instead of on a customer's screen.
//
// DB-free and network-free: reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");

/** The custom properties declared in the first block that opens with `selector {`. */
function block(selector) {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} block not found in globals.css`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
}

const light = block(":root");
const dark = { ...light, ...block(".dark") };

function rgb(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(value);
  if (fn) return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], alpha: fn[4] === undefined ? 1 : Number(fn[4]) };
  return null;
}

/** A token as an opaque colour; a translucent one is composited over `ground`. */
function colour(theme, name, ground) {
  const raw = theme[name];
  assert.ok(raw, `${name} is not defined`);
  const parsed = rgb(raw);
  assert.ok(parsed, `${name} is not a colour this test reads: ${raw}`);
  if (Array.isArray(parsed)) return parsed;
  const base = ground ?? [255, 255, 255];
  return parsed.rgb.map((c, i) => Math.round(c * parsed.alpha + base[i] * (1 - parsed.alpha)));
}

function luminance([r, g, b]) {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum, why]
const PAIRS = [
  ["--on-primary", "--primary", 4.5, "a primary button's label"],
  ["--on-primary", "--accent-hover", 4.5, "the label while hovered"],
  ["--on-primary", "--accent-pressed", 4.5, "the label while pressed"],
  ["--accent-ink", "--surface", 4.5, "brand-coloured text on a card"],
  ["--accent-ink", "--canvas", 4.5, "brand-coloured text on the page"],
  ["--accent-ink", "--surface-alt", 4.5, "brand-coloured text on a grouped band"],
  ["--accent-ink", "--primary-soft", 4.5, "an action chip's label"],
  ["--ink", "--surface", 7, "headings"],
  ["--body", "--canvas", 4.5, "body text"],
  ["--muted", "--surface-alt", 4.5, "secondary text on a band"],
  ["--ring-color", "--canvas", 3, "the focus ring on the page"],
  ["--ring-color", "--surface", 3, "the focus ring on a card"],
  ["--ring-color", "--surface-alt", 3, "the focus ring on a band"],
  ["--border-strong", "--surface", 3, "a control's edge"],
  ["--nav-ink", "--nav-bg", 4.5, "rail links"],
  ["--nav-muted", "--nav-bg", 4.5, "rail headings"],
  ["--nav-active-icon", "--nav-bg", 3, "the active rail icon"],
  ["--primary", "--nav-bg", 3, "the active rail bar"],
  // v3 gloss (UI-CONSISTENCY.md §4a): the stat card's surface runs from --gloss-top to --gloss-bottom.
  ["--ink", "--gloss-top", 7, "a stat card's value, top of the gradient"],
  ["--ink", "--gloss-bottom", 7, "a stat card's value, bottom of the gradient"],
  ["--muted", "--gloss-top", 4.5, "a stat card's label"],
  ["--muted", "--gloss-bottom", 4.5, "a stat card's footer text"],
  ["--accent-ink", "--stat-icon-bottom", 4.5, "the icon on the glossy tile"],
  ["--warning-ink", "--warning-surface", 4.5, "the amber footer of a card that needs action"],
  // The toast (lib/notify via Sileo) is an inverted pill, so its tokens hold the other theme's values.
  ["--toast-text", "--toast-fill", 7, "a toast's detail heading"],
  ["--toast-muted", "--toast-fill", 4.5, "a toast's detail line"],
  ["--toast-success", "--toast-fill", 4.5, "a done toast's title"],
  ["--toast-warning", "--toast-fill", 4.5, "a warn toast's title"],
  ["--toast-error", "--toast-fill", 4.5, "a block or fail toast's title"],
  ["--toast-info", "--toast-fill", 4.5, "an arrive toast's title"],
  ["--toast-win", "--toast-fill", 4.5, "a win toast's title"],
];

for (const [name, theme] of [["light", light], ["dark", dark]]) {
  test(`brand contrast holds in the ${name} theme`, () => {
    const failures = [];
    for (const [fg, bg, min, why] of PAIRS) {
      const ground = colour(theme, bg);
      const ratio = contrast(colour(theme, fg, ground), ground);
      if (ratio < min) failures.push(`${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1 (${why})`);
    }
    // The active rail link: its text on the translucent chip, composited over the rail.
    const rail = colour(theme, "--nav-bg");
    const chip = colour(theme, "--nav-active-bg", rail);
    const activeText = contrast(colour(theme, "--nav-active-ink", chip), chip);
    if (activeText < 4.5) failures.push(`active rail text is ${activeText.toFixed(2)}:1, needs 4.5:1`);
    assert.deepEqual(failures, []);
  });
}

test("the bright green is a fill, never text on a light ground", () => {
  // Measured, so the rule below is not folklore.
  assert.ok(contrast(colour(light, "--primary"), [255, 255, 255]) < 3, "if this ever passes, the rule can relax");

  // Allowed: places where the green sits on the ink rail or a dark panel, or carries ink on a fill.
  const DARK_GROUND = new Set([
    "components/app/tenant-auth-workspace.tsx", // icon tiles on the --nav-line brand panel
    "components/partner/partner-auth-frame.tsx", // the lock icon on the partner sign-in brand panel (--nav-bg)
    "app/admin/login/page.tsx", // the shield icon on the sign-in brand panel (--nav-bg)
    "components/marketing/landing-hero.tsx", // the hero is on --footer-bg (deep olive) in both themes (2026-10-13)
    "components/app/plan-choice.tsx", // the sign-up plan summary sits on the brand panel in place of the story (2026-10-26)
  ]);
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
      else if (rel.endsWith(".tsx")) out.push(rel);
    }
    return out;
  };
  const offenders = [];
  for (const file of [...walk("app"), ...walk("components")]) {
    if (DARK_GROUND.has(file)) continue;
    const source = readFileSync(join(ROOT, file), "utf8");
    if (/(^|["'`\s])text-(primary|\[var\(--(portal-)?primary\)\])(?=["'`\s])/m.test(source)) offenders.push(file);
  }
  const textRules = [...css.matchAll(/(^|[;{\s])color:\s*var\(--(portal-)?primary\)/g)];
  assert.deepEqual(offenders, [], "bright green as text/icon colour on a light ground — use --accent-ink");
  assert.equal(textRules.length, 0, "a CSS rule sets the bright green as a text colour — use --accent-ink");
});

test("every gloss token is declared in both themes, under the same name", () => {
  const ownDark = block(".dark");
  const gloss = (tokens) => Object.keys(tokens).filter((n) => /^--(gloss|stat-icon)-/.test(n)).sort();
  assert.ok(gloss(light).length >= 16, "the v3 gloss tokens are missing from :root");
  assert.deepEqual(gloss(ownDark), gloss(light), "the gloss tokens in .dark must match :root one for one");
});

test("no token is named after a colour the brand no longer uses", () => {
  const names = Object.keys(light).concat(Object.keys(block(".dark")));
  assert.deepEqual(names.filter((n) => /orange|blue/i.test(n)), []);
  assert.equal(light["--primary"].toLowerCase(), "#07d6a0", "the brand green (docs/design/BRAND.md)");
  assert.equal(light["--ink"].toLowerCase(), "#0d4037", "the brand ink");
});
