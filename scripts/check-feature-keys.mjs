// SA-2.1: every non-archived feature_key must be referenced by at least one requireFeature()
// guard. Where the catalog, the guards and the menu drift apart is where entitlement bugs live.
//
// Self-activating: while NO requireFeature() call exists anywhere (the entitlement engine is
// SA-2.8, and the agent-facing app doesn't exist yet), this reports and exits 0 rather than
// failing a build over work that hasn't started. The moment the first guard appears it becomes
// a hard check — so it can be wired into CI today without producing noise.
//
// Run with: npm run check:features
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const SEARCH_ROOTS = ["app", "components", "lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);
// Matches requireFeature('key'), requireFeature("key"), requireFeature(`key`).
const GUARD_PATTERN = /requireFeature\(\s*['"`]([a-z0-9_]+)['"`]\s*\)/g;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Directory doesn't exist yet — fine.
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      yield* walk(path);
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      yield path;
    }
  }
}

const referenced = new Set();
let guardCallCount = 0;

for (const root of SEARCH_ROOTS) {
  for await (const file of walk(root)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(GUARD_PATTERN)) {
      referenced.add(match[1]);
      guardCallCount++;
    }
  }
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const { data: features, error } = await supabase
  .from("features")
  .select("feature_key, label, module, is_archived")
  .eq("is_archived", false)
  .order("module");

if (error) {
  console.error("Could not read the feature catalog:", error.message);
  process.exit(1);
}

// --- Menu coverage (SA-2.3) -------------------------------------------------
// The Basic Idea doc's Appendix A: every feature key must correspond to one requireFeature()
// guard AND one required_feature on a menu node. Unlike the guards, the menu exists today, so
// this half is enforced immediately — a feature nobody can navigate to is invisible in practice.
const menuSource = await readFile("lib/menu/definition.ts", "utf8");
const menuKeys = new Set([...menuSource.matchAll(/requiredFeature:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]));

console.log(`Catalog: ${features.length} active features`);
console.log(`Guards:  ${guardCallCount} requireFeature() call(s) referencing ${referenced.size} key(s)`);
console.log(`Menu:    ${menuKeys.size} key(s) referenced by menu nodes\n`);

const missingFromMenu = features.filter((f) => !menuKeys.has(f.feature_key));
const menuKeysNotInCatalog = [...menuKeys].filter((k) => !features.some((f) => f.feature_key === k));

let menuFailed = false;

if (missingFromMenu.length > 0) {
  menuFailed = true;
  console.log(`FAIL — ${missingFromMenu.length} feature(s) have no menu node:`);
  for (const f of missingFromMenu) console.log(`  ${f.module}/${f.feature_key}  (${f.label})`);
  console.log("");
}

if (menuKeysNotInCatalog.length > 0) {
  menuFailed = true;
  console.log(`FAIL — ${menuKeysNotInCatalog.length} menu node(s) require a key not in the catalog:`);
  for (const key of menuKeysNotInCatalog) console.log(`  ${key}`);
  console.log("");
}

if (!menuFailed) {
  console.log("OK — every active feature has a menu node.\n");
}

const unguarded = features.filter((f) => !referenced.has(f.feature_key));
const unknownGuards = [...referenced].filter((key) => !features.some((f) => f.feature_key === key));

let failed = menuFailed;

// --- Guards referencing keys that don't exist: ALWAYS a bug ------------------
// A typo'd guard silently protects nothing, so this fails regardless of how complete the app is.
if (unknownGuards.length > 0) {
  failed = true;
  console.log(`FAIL — ${unknownGuards.length} guard(s) reference a key that isn't in the catalog:`);
  for (const key of unknownGuards) console.log(`  ${key}`);
  console.log("");
}

// --- Features with no guard: coverage, reported not enforced -----------------
// Deliberately NOT a failure yet. The agent-facing app is scaffolding (SA-2.8 built two routes to
// prove enforcement works); the other features have no API to guard because they don't exist.
// Failing here would mean a red check for months, which trains people to ignore it.
//
// Flip GUARD_COVERAGE_MUST_BE_COMPLETE to true once LA-0.1 has built the agent app — from then
// on an unguarded feature IS a security hole, because it means a real route shipped without one.
const GUARD_COVERAGE_MUST_BE_COMPLETE = false;

const covered = features.length - unguarded.length;
const pct = features.length === 0 ? 100 : Math.round((covered / features.length) * 100);

if (unguarded.length > 0) {
  const level = GUARD_COVERAGE_MUST_BE_COMPLETE ? "FAIL" : "TODO";
  if (GUARD_COVERAGE_MUST_BE_COMPLETE) failed = true;

  console.log(`${level} — guard coverage ${covered}/${features.length} (${pct}%). Unguarded:`);
  for (const f of unguarded) console.log(`  ${f.module}/${f.feature_key}  (${f.label})`);
  console.log("");
  if (!GUARD_COVERAGE_MUST_BE_COMPLETE) {
    console.log("  Not a failure yet — most of these have no agent-facing route to guard (LA-0.1).");
    console.log("  Set GUARD_COVERAGE_MUST_BE_COMPLETE in this script once the agent app is built.\n");
  }
} else {
  console.log(`OK — every active feature has a requireFeature() guard (${covered}/${features.length}).\n`);
}

console.log(failed ? "Catalog, guards and menu are out of sync." : "No drift between catalog, guards and menu.");
// Let Node close its handles normally on Windows. Calling process.exit() here can race the
// runtime's async cleanup and produce UV_HANDLE_CLOSING after an otherwise valid check.
process.exitCode = failed ? 1 : 0;
