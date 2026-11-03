// LA-3.23 — "Dragging a card never changes an application's status." Structural: nothing on the
// board's paths (the pipeline views service, the lead routes, the board component, the move RPC)
// names an application table or the transition function, and the sync service writes no application.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APPLICATION_WRITES = /tenant_applications\b|application_transition|open_next_attempt|tenant_application_cases\b/;

function files(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [dir];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|tsx|sql)$/.test(e.name) ? [join(dir, e.name)] : []));
}

test("the board's move paths never touch an application", () => {
  const paths = [
    ...files("lib/pipelines").filter((f) => !f.endsWith(".test.mjs")),
    ...files("app/api/app/leads").filter((f) => !f.includes("reconcile-stage")),
    "components/app/lead-workspace.tsx",
    "supabase/migrations/20260925100000_pipeline_views_stage_rules_and_history.sql",
  ].filter((f) => existsSync(join(ROOT, f)));
  assert.ok(paths.length > 3, "the board's files were not found — the test is broken, not the app");
  const offenders = paths.filter((f) => APPLICATION_WRITES.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(offenders, []);
});

test("the sync service reads applications and writes only the lead's stage and its history", () => {
  const src = readFileSync(join(ROOT, "lib/applications/stageSyncService.ts"), "utf8");
  // Every write in the file: .update( / .insert( / .upsert( / .delete( on a named table.
  const writes = [...src.matchAll(/from\("([a-z_]+)"\)\s*\.(update|insert|upsert|delete)\(/g)].map((m) => m[1]);
  assert.ok(writes.length > 0);
  assert.deepEqual([...new Set(writes)].sort(), ["agent_leads", "deal_flow", "lead_queue", "tenant_lead_stage_events"]);
  assert.ok(!/rpc\("application_transition"/.test(src));
  // Automatic moves carry the system as actor and the application_sync source.
  assert.match(src, /source: "application_sync"/);
  assert.match(src, /actorUserId: null/);
});
