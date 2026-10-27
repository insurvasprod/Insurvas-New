// Run with: npm test
//
// The design docs are only useful if people can find them and they do not lie. These tests hold the
// signposts in place (a README in every component and route folder, the AGENTS.md block), keep every
// relative link and anchor in the design docs resolvable, and make sure each v3 rule in
// UI-CONSISTENCY.md says whether it is live yet (docs/design/foundation-v3/SPEC-design-foundation.md).
//
// DB-free and network-free: reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const AUTHORITY = "docs/design/UI-CONSISTENCY.md";

const POINTER_READMES = [
  "components/ui",
  "components/app",
  "components/portal",
  "components/partner",
  "components/admin",
  "components/public",
  "components/marketing",
  "components/shared",
  "app/app",
  "app/partner",
  "app/admin",
].map((dir) => `${dir}/README.md`);

const read = (path) => readFileSync(join(ROOT, path), "utf8");
const mdIn = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".md")).map((f) => `${dir}/${f}`);

/** Markdown without fenced code blocks, so example snippets are not checked as live links. */
const prose = (text) => text.replace(/```[\s\S]*?```/g, "");

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

const anchorsOf = (text) =>
  new Set([...prose(text).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1].replace(/`/g, ""))));

function links(path) {
  return [...prose(read(path)).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((href) => !/^(?:[a-z]+:|\/\/)/i.test(href));
}

const DOCS = [...mdIn("docs/design"), ...mdIn("docs/design/foundation-v3"), ...POINTER_READMES, "AGENTS.md", "README.md"];

test("every component and route folder has a pointer README that links the authority", () => {
  for (const path of POINTER_READMES) {
    assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);
    const target = links(path).map((href) => resolve(ROOT, dirname(path), href.split("#")[0]));
    assert.ok(
      target.includes(join(ROOT, AUTHORITY)),
      `${path} must link ${AUTHORITY} (it is how people find the rules)`,
    );
  }
});

test("every relative link and anchor in the design docs resolves", () => {
  const broken = [];
  for (const path of DOCS) {
    for (const href of links(path)) {
      const [file, anchor] = href.split("#");
      const target = file ? resolve(ROOT, dirname(path), decodeURI(file)) : join(ROOT, path);
      if (!existsSync(target)) {
        broken.push(`${path} → ${href} (no such file)`);
        continue;
      }
      if (anchor && target.endsWith(".md") && !anchorsOf(readFileSync(target, "utf8")).has(anchor)) {
        broken.push(`${path} → ${href} (no heading #${anchor} in ${relative(ROOT, target)})`);
      }
    }
  }
  assert.deepEqual(broken, [], `broken links:\n${broken.join("\n")}`);
});

test("every v3 rule in UI-CONSISTENCY.md says whether it is live", () => {
  const text = prose(read(AUTHORITY));
  assert.match(text, /^## 0\. Foundation v3/m, "§0 (the v3 rules and their status) is missing");
  const sections = text.split(/^(?=#{2,3}\s)/m).filter((s) => /^#{2,3}\s.*\(v3\)/.test(s));
  assert.ok(sections.length >= 8, `expected the v3 sections (§4a–§14), found ${sections.length}`);
  for (const section of sections) {
    const heading = section.split("\n")[0];
    assert.match(
      section,
      /\*\*Status:\*\* (?:Live\.|Decided, lands in `[a-z-]+`)/,
      `"${heading}" needs a status line: **Status:** Live. or **Status:** Decided, lands in \`<module>\``,
    );
  }
});

test("AGENTS.md points at the design rules outside the block next dev rewrites", () => {
  const text = read("AGENTS.md");
  const nextEnd = text.indexOf("<!-- END:nextjs-agent-rules -->");
  const start = text.indexOf("<!-- BEGIN:design-rules -->");
  const end = text.indexOf("<!-- END:design-rules -->");
  assert.ok(start !== -1 && end > start, "the design-rules block is missing from AGENTS.md");
  assert.ok(nextEnd === -1 || start > nextEnd, "the design-rules block must sit outside the nextjs-agent-rules markers");
  assert.ok(text.slice(start, end).includes(AUTHORITY), `the design-rules block must link ${AUTHORITY}`);
});
