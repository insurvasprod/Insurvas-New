// SA-2.1 / LA-0.1: every existing feature-bearing agent API must be referenced by a
// requireFeature() guard. Where the catalog, the guards and the menu drift apart is where
// entitlement bugs live.
//
// Features whose module/API does not exist yet are reported as deferred rather than treated as
// unguarded routes. A future module ticket must add its API to agentApiPolicy.ts before shipping.
//
// Run with: npm run check:features
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { AGENT_API_POLICIES } from "../lib/entitlements/agentApiPolicy.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const SEARCH_ROOTS = ["app", "components", "lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);
// Matches requireFeature('key') with or without the optional write/read-only options object.
const GUARD_PATTERN = /requireFeature\(\s*['"`]([a-z0-9_]+)['"`](?:\s*,[^)]*)?\)/g;

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
const sourceByFile = new Map();

for (const root of SEARCH_ROOTS) {
  for await (const file of walk(root)) {
    const source = await readFile(file, "utf8");
    sourceByFile.set(file.replaceAll("\\", "/"), source);
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
// The agent menu contract uses the product/document spelling `required_feature`, so this check
// tests the same data shape the agent shell renders.
const menuKeys = new Set(
  [...menuSource.matchAll(/required_feature:\s*["'`]([a-z0-9_]+)["'`]/g)].map((m) => m[1]),
);

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

const unknownGuards = [...referenced].filter((key) => !features.some((f) => f.feature_key === key));

// --- Every existing agent API must declare and enforce its policy -------------
const agentApiFiles = new Set();
for await (const file of walk("app/api/app")) {
  if (file.endsWith("/route.ts") || file.endsWith("\\route.ts")) {
    agentApiFiles.add(file.replaceAll("\\", "/"));
  }
}
const policyByFile = new Map(AGENT_API_POLICIES.map((policy) => [policy.sourceFile, policy]));
const missingPolicies = [...agentApiFiles].filter((file) => !policyByFile.has(file));
const stalePolicies = AGENT_API_POLICIES.filter((policy) => !agentApiFiles.has(policy.sourceFile));
let policyFailed = false;

if (missingPolicies.length > 0) {
  policyFailed = true;
  console.log(`FAIL — ${missingPolicies.length} agent API route(s) have no authorization policy:`);
  for (const file of missingPolicies) console.log(`  ${file}`);
  console.log("");
}
if (stalePolicies.length > 0) {
  policyFailed = true;
  console.log(`FAIL — ${stalePolicies.length} authorization polic(y/ies) name a missing route:`);
  for (const policy of stalePolicies) console.log(`  ${policy.sourceFile}`);
  console.log("");
}

const policyGuardFailures = AGENT_API_POLICIES.filter((policy) => {
  if (!policy.featureKey) return false;
  const source = sourceByFile.get(policy.sourceFile) ?? "";
  return !new RegExp(`requireFeature(?:Role)?\\(\\s*[\\"']${policy.featureKey}[\\"']`).test(source);
});
if (policyGuardFailures.length > 0) {
  policyFailed = true;
  console.log(`FAIL — ${policyGuardFailures.length} feature API route(s) do not call their declared guard:`);
  for (const policy of policyGuardFailures) console.log(`  ${policy.sourceFile} -> ${policy.featureKey}`);
  console.log("");
}

let failed = menuFailed || policyFailed;

// --- Guards referencing keys that don't exist: ALWAYS a bug ------------------
// A typo'd guard silently protects nothing, so this fails regardless of how complete the app is.
if (unknownGuards.length > 0) {
  failed = true;
  console.log(`FAIL — ${unknownGuards.length} guard(s) reference a key that isn't in the catalog:`);
  for (const key of unknownGuards) console.log(`  ${key}`);
  console.log("");
}

const apiFeatureKeys = new Set(AGENT_API_POLICIES.map((policy) => policy.featureKey).filter(Boolean));
const deferred = features.filter((feature) => !apiFeatureKeys.has(feature.feature_key));
console.log(`OK — every existing feature-bearing agent API is covered (${apiFeatureKeys.size} feature keys).\n`);
if (deferred.length > 0) {
  console.log(`Deferred — ${deferred.length} catalog feature(s) have no agent API yet; their module ticket owns the API guard:`);
  for (const f of deferred) console.log(`  ${f.module}/${f.feature_key}  (${f.label})`);
  console.log("");
}

console.log(failed ? "Catalog, guards and menu are out of sync." : "No drift between catalog, guards and menu.");
// Let Node close its handles normally on Windows. Calling process.exit() here can race the
// runtime's async cleanup and produce UV_HANDLE_CLOSING after an otherwise valid check.
process.exitCode = failed ? 1 : 0;
