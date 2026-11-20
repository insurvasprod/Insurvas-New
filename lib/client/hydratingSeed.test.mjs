// Run with: node --experimental-strip-types --test lib/client/hydratingSeed.test.mjs
//
// Walk 2026-11-20: a hydration mismatch on /app/campaigns (inside LeadsInPage). The shell's ResourceScope marks
// the app hydrated in its effect, but the page sits in (shell)/loading.tsx's Suspense boundary, which React
// hydrates in a later pass, after that effect. `seed` then handed the page the tab's kept answer from
// sessionStorage while the server's HTML had none, so the first client render (campaign counts, the toolbar)
// differed from the server's. The workspace now asks `useHydrating()` (useSyncExternalStore: the server
// snapshot while hydrating) before it seeds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("useHydrating answers true from the server snapshot and false on the client", () => {
  const source = read("lib/client/use-resource.ts");
  assert.match(source, /export function useHydrating\(\): boolean \{\s*return useSyncExternalStore\(noSubscribe, \(\) => false, \(\) => true\);/);
});

test("the shell marks hydration in an effect, and the page hydrates inside a later Suspense boundary", () => {
  assert.match(read("components/app/resource-scope.tsx"), /useEffect\(\(\) => \{ markHydrated\(\); \}, \[\]\)/);
  assert.ok(read("app/app/(shell)/loading.tsx").length > 0, "(shell)/loading.tsx wraps every page in a Suspense boundary");
});

test("the campaign workspace never seeds a kept answer while it hydrates", () => {
  const source = read("components/app/campaign-workspace.tsx");
  const hydrating = source.indexOf("const hydrating = useHydrating();");
  const kept = source.indexOf("const [kept] = useState(() => {");
  assert.ok(hydrating > 0 && kept > hydrating, "useHydrating is read before the kept-answer initializer");
  assert.match(source.slice(kept, kept + 200), /if \(hydrating\) return \{ campaigns: undefined, vendors: undefined \};/);
});

test("the campaign workspace formats numbers in one locale on the server and in the browser", () => {
  const source = read("components/app/campaign-workspace.tsx");
  assert.doesNotMatch(source, /toLocaleString\(undefined/);
  assert.doesNotMatch(source, /Number\(value\)\.toLocaleString\(\)/);
});
