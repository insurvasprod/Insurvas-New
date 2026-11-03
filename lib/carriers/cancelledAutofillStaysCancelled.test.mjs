// Run with: npm test
//
// LA-2.15 (carrier autofill browser extension) and LA-2.16 (per-carrier field maps) are
// **Cancelled**. Decision 16 of "Sixteen Open Questions, Answered" retired both as duplicates of
// LA-3.12 / LA-3.13 / LA-3.14, written during the outbound module before the Sell module existed.
//
// Verified on 2026-09-22 that nothing was built against either. Since 2026-09-28 the LA-3 version
// exists: `extension/` (Manifest V3) against LA-3.12's grant model, and LA-3.13's
// `carrier_field_map*` tables. This file now guards that the LA-3 version stays the LA-3 version.
//
// ── Why this needs a guard rather than just a note ─────────────────────────────────────────────
//
// Decision 16 ends with a live obligation: *"anything already built against LA-2.15/2.16 needs
// reviewing against LA-3.12's auth model before it ships."* The risk is the next person, who finds
// a tidy retired spec with a schema block in it and builds from that — and the LA-2 design is the
// one that was rejected, on security grounds:
//
//   · LA-2.15 still carries "decide the auth model before writing code" as an OPEN QUESTION.
//     LA-3.12 answered it: short-lived scoped grants, origin-bound, store-checked revocation,
//     SSN and bank numbers never in the bulk payload.
//   · LA-2.16's maps are hand-built and unversioned in review. LA-3.13's are versioned, human-
//     approved, immutable once published, and refuse to publish while any SSN or banking entry is
//     unverified.
//
// A `carrier_forms` / `carrier_field_maps` table appearing in this repository is therefore not a
// feature landing early. It is the retired design landing, and this fails when it does. So does a
// manifest that asks for `<all_urls>` or broad host access, and any code citing LA-2.15/2.16.
//
// The test names the LA-3 tables it *does* expect, so building the right thing passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = process.cwd();

/** The schema block LA-2.16 specifies. Its presence means somebody built the cancelled version. */
const RETIRED_TABLES = ["carrier_forms", "carrier_field_maps"];
/** LA-3.13's, for contrast — these are what a correct implementation creates. */
const SUPERSEDING_TABLES = ["carrier_field_map", "carrier_field_map_step", "carrier_field_map_entry"];

function sources(dir) {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sources(child));
    else if ([".ts", ".tsx", ".mjs", ".sql", ".js", ".json", ".html"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

const tracked = ["lib", "app", "components", "scripts", "supabase/migrations", "extension"]
  .flatMap(sources)
  // The pre-2026-09-11 snapshot is a record of the legacy CRM, not something this product builds.
  .filter((path) => !path.startsWith("supabase/backups/"))
  // And this file, which has to name what it forbids in order to forbid it.
  .filter((path) => !path.endsWith("cancelledAutofillStaysCancelled.test.mjs"))
  .map((path) => [path, readFileSync(join(ROOT, path), "utf8")]);

test("the retired LA-2.16 field-map schema is not built", () => {
  const offenders = [];
  for (const [path, source] of tracked) {
    for (const table of RETIRED_TABLES) {
      // Word-bounded, so LA-3.13's `carrier_field_map_entry` does not trip the `carrier_field_maps`
      // pattern and a correct implementation is not punished for resembling the wrong one.
      if (new RegExp(`\\b${table}\\b`).test(source)) offenders.push(`${path}: ${table}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `LA-2.16 is cancelled and its schema is the version that was rejected. Build LA-3.13's ` +
      `(${SUPERSEDING_TABLES.join(", ")}) against LA-3.12's grant model instead:\n  ${offenders.join("\n  ")}`,
  );
});

/** Every manifest.json under the places an extension could live. */
function manifests() {
  const found = [];
  const walk = (dir) => {
    const absolute = join(ROOT, dir);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name === "manifest.json") found.push(child);
    }
  };
  for (const top of ["extension", "extensions", "browser-extension", "apps", "packages", "public"]) walk(top);
  return found;
}

test("no browser extension manifest requests <all_urls>", () => {
  // LA-3.12: "host permissions come from configured carrier origins only", and LA-2.15's own rule
  // was that the extension is inert off the allowlist.
  for (const manifest of manifests()) {
    const body = readFileSync(join(ROOT, manifest), "utf8");
    assert.doesNotMatch(body, /<all_urls>/, `${manifest} requests <all_urls>. Carrier origins are requested at runtime, one at a time.`);
  }
});

test("the LA-3.12 extension manifest keeps to its allowlist", () => {
  // The one extension this repository ships. If it moves, this test moves with it.
  const path = join(ROOT, "extension", "manifest.json");
  if (!existsSync(path)) return;
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(manifest.manifest_version, 3, "Manifest V3 only");

  const broad = (pattern) => /^(\*|https?):\/\/\*(\/|\.|$)/.test(pattern) || pattern === "<all_urls>";
  const insurvas = (pattern) => /^(http:\/\/localhost:\d+|https:\/\/[a-z0-9.-]*insurvas\.com)\/\*$/.test(pattern);

  // Permissions: exactly what LA-3.12 needs, no tabs/webRequest/cookies/history.
  assert.deepEqual([...(manifest.permissions ?? [])].sort(), ["activeTab", "scripting", "sidePanel", "storage"]);
  // Fixed host access is the Insurvas origin only; carrier origins are optional and asked for at runtime.
  for (const pattern of manifest.host_permissions ?? []) assert.ok(insurvas(pattern), `host_permissions may name the Insurvas origin only, not ${pattern}`);
  // Optional hosts are the pool a per-origin runtime request is drawn from: https only.
  for (const pattern of manifest.optional_host_permissions ?? []) assert.match(pattern, /^https:\/\//, `optional_host_permissions must be https, not ${pattern}`);
  // Content scripts run on Insurvas only — the carrier script is injected on demand, never declared.
  for (const script of manifest.content_scripts ?? []) {
    for (const pattern of script.matches ?? []) assert.ok(insurvas(pattern) && !broad(pattern), `a declared content script runs on ${pattern}`);
  }
  // A CSP that limits where extension pages may connect.
  const csp = manifest.content_security_policy?.extension_pages ?? "";
  assert.match(csp, /connect-src [^;]+/, "extension pages need a connect-src limited to the Insurvas API");
  assert.doesNotMatch(csp, /connect-src[^;]*(\*|https:(?!\/\/))/, "connect-src must list origins, not wildcards");
});

test("the extension never keeps its token in storage", () => {
  // LA-3.12: the grant lives in the service worker's memory. chrome.storage and localStorage are
  // persistent and readable by every extension page; a token there outlives its purpose.
  // The files that hold or pass the token may not touch persistent storage at all.
  const offenders = tracked
    .filter(([path]) => path.startsWith("extension/") && path.endsWith(".js"))
    // Code only: the comments explaining the rule name the APIs they forbid.
    .map(([path, source]) => [path, source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")])
    .filter(([, code]) => /\btoken\b/.test(code) && /(chrome\.storage\.\w|localStorage\b|sessionStorage\b|indexedDB\b|document\.cookie)/.test(code))
    .map(([path]) => path);
  assert.deepEqual(offenders, [], `a file that handles the grant token also uses browser storage:\n  ${offenders.join("\n  ")}`);
});

test("nothing claims LA-2.15 or LA-2.16 as work in progress", () => {
  // Both are retired. A source file citing one as its ticket means somebody is building the
  // cancelled scope — which is different from a document explaining that they were cancelled, so
  // only code is scanned.
  const offenders = tracked
    .filter(([path]) => !path.endsWith(".md"))
    .filter(([, source]) => /LA-2\.1[56]\b/.test(source))
    .map(([path]) => path);

  assert.deepEqual(
    offenders,
    [],
    `source files attributing work to a cancelled task:\n  ${offenders.join("\n  ")}`,
  );
});
