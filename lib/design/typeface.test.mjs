// Run with: npm test
//
// The v3 typefaces (docs/design/UI-CONSISTENCY.md §0, BRAND.md): Inter for the apps and every auth
// page, Inter Tight for display, Geist Mono for identifiers, and Montserrat only on the marketing
// pages through .type-brand. These tests hold that wiring, so the brand face cannot creep back into
// the apps and the apps' face cannot leak onto the landing page.
//
// DB-free and network-free: reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const css = read("app/globals.css");

/** The value of a custom property in the first block that declares it. */
const token = (name) => {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(css);
  assert.ok(match, `${name} is not declared in app/globals.css`);
  return match[1].trim();
};

const walk = (dir, out = []) => {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx|ts|css)$/.test(rel)) out.push(rel);
  }
  return out;
};

test("the root layout self-hosts all four families and exposes their variables", () => {
  const layout = read("app/layout.tsx");
  for (const family of ["Inter", "Inter_Tight", "Geist_Mono", "Montserrat"]) {
    assert.match(layout, new RegExp(`\\b${family}\\(\\{`), `app/layout.tsx must load ${family} with next/font`);
  }
  for (const variable of ["--font-inter", "--font-inter-tight", "--font-geist-mono", "--font-montserrat"]) {
    assert.ok(layout.includes(`"${variable}"`), `app/layout.tsx must declare ${variable}`);
  }
  assert.match(layout, /<html[^>]*className=\{fontVariables\}/, "<html> must carry every font variable");
});

test("the UI, display and mono tokens resolve to Inter, Inter Tight and Geist Mono", () => {
  assert.match(token("--font-sans"), /^var\(--font-inter\)/);
  assert.match(token("--font-display"), /^var\(--font-inter-tight\)/);
  assert.match(token("--font-mono"), /^var\(--font-geist-mono\)/);
  assert.match(token("--font-brand"), /^var\(--font-montserrat\)/);
  assert.match(css, /\.type-brand\s*\{[^}]*font-family:\s*var\(--font-brand\)/, ".type-brand must switch to the brand face");
});

test("Montserrat appears only on the marketing pages", () => {
  const MARKETING = ["app/page.tsx", "app/pricing/page.tsx"];
  for (const page of MARKETING) assert.match(read(page), /className="type-brand\b/, `${page}'s root must carry .type-brand`);

  const APP_PLANES = ["app/app", "app/partner", "app/admin", "app/signup", "components/app", "components/partner", "components/admin", "components/portal", "components/ui"];
  const leaks = APP_PLANES.flatMap((dir) => walk(dir)).filter((file) => /type-brand|font-brand|Montserrat/.test(read(file)));
  assert.deepEqual(leaks, [], "the brand face must not reach the apps or auth pages");
});
