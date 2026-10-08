// LA-4.19 (Notion sprint) · the orchestrated run and the agent framework.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FILE_STAGES, runPipeline, runStatus } from "./dailyRun.ts";
import { AGENTS, assertPromptSafe, batches, findingRow, promptProblems, providerStatus, runBatched, stopsStage, UnsafePromptError, weeklyAccuracy } from "./agents.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261008280000_la_4_19_daily_run.sql", import.meta.url), "utf8");
const agentsSource = readFileSync(new URL("./agents.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("./dailyRunStore.ts", import.meta.url), "utf8");

/**
 * A world the run works on: files with their state, and the "database" writes each stage makes,
 * keyed the way the real unique constraints key them (so a second write of the same thing is a no-op).
 */
function world(files, options = {}) {
  const state = new Map(files.map((f) => [f.fileId, { ...f, parsed: false, complete: false }]));
  const snapshots = new Map();      // (file, policy) → row: policy_snapshot's key
  const ledger = new Map();         // fingerprint → line: commission_entry's key
  const stageRuns = [];
  const runs = [];
  let clock = 0;
  let failReconcileOnce = new Set(options.failReconcileOnce ?? []);
  const ctx = { forget: false };
  const deps = {
    now: () => clock,
    recoverInterrupted: async () => 0,
    collect: async () => [],
    pending: async ({ arrived }) => [...state.values()].filter((f) => !f.complete).map((f) => ({
      tenantId: f.tenantId, fileId: f.fileId, fileType: f.fileType, arrivedThisRun: arrived.has(f.fileId), parsed: f.parsed,
      completed: ctx.forget ? [] : FILE_STAGES.filter((stage) => stageRuns.some((s) => s.fileId === f.fileId && s.stage === stage && s.status === "succeeded" && s.at >= (f.parsedAt ?? 0) && runs.find((r) => r.id === s.runId)?.closed)),
    })),
    startRun: async (tenantId, trigger) => { const id = `run${runs.length + 1}`; runs.push({ id, tenantId, trigger, closed: false }); return id; },
    finishRun: async (runId, summary) => Object.assign(runs.find((r) => r.id === runId), summary, { closed: true }),
    startStage: async (runId, tenantId, fileId, stage) => { stageRuns.push({ id: stageRuns.length, runId, tenantId, fileId, stage, status: "running", at: ++clock }); return stageRuns.length - 1; },
    finishStage: async (id, result) => Object.assign(stageRuns[id], result),
    parse: async (file) => {
      const f = state.get(file.fileId);
      if (f.blocked) return { result: { status: "blocked", error: "No layout map for this carrier yet" }, passed: null };
      f.parsed = true; f.parsedAt = clock;
      return { result: { status: "succeeded", rowsIn: f.rows.length, rowsOut: f.rows.length }, passed: f.rows.map((policy, i) => ({ rowNumber: i + 1, values: { policy } })) };
    },
    store: async (file, passed) => { for (const r of passed) snapshots.set(`${file.fileId}|${r.values.policy}`, r); return { status: "succeeded", rowsIn: passed.length, rowsOut: passed.length }; },
    match: async () => ({ status: "succeeded" }),
    reconcile: async (file, passed) => {
      if (failReconcileOnce.has(file.fileId)) { failReconcileOnce.delete(file.fileId); throw new Error("the database went away"); }
      if (file.fileType === "commissions") for (const r of passed) ledger.set(`${file.fileId}|${r.values.policy}`, r);
      return { status: "succeeded", rowsOut: passed.length };
    },
    complete: async (file) => { state.get(file.fileId).complete = true; },
    analyse: async () => ({ status: "succeeded", note: "computed live" }),
  };
  return { deps, ctx, state, snapshots, ledger, stageRuns, runs, tick: (n) => { clock += n; } };
}

const files = () => [
  { tenantId: "t1", fileId: "p1", fileType: "policies", rows: ["A", "B", "C"] },
  { tenantId: "t1", fileId: "c1", fileType: "commissions", rows: ["A", "B"] },
  { tenantId: "t2", fileId: "p2", fileType: "policies", rows: ["X"] },
];

test("a run takes every pending file through every stage and records a row for each", async () => {
  const w = world(files());
  const out = await runPipeline(w.deps, { trigger: "file_arrival", deadline: Infinity, concurrency: 2 });
  assert.deepEqual(out.map((r) => [r.tenantId, r.status, r.total, r.succeeded]), [["t1", "succeeded", 2, 2], ["t2", "succeeded", 1, 1]]);
  for (const id of ["p1", "c1", "p2"]) assert.deepEqual(w.stageRuns.filter((s) => s.fileId === id).map((s) => s.stage), [...FILE_STAGES]);
  assert.equal(w.stageRuns.filter((s) => s.stage === "analyse").length, 2, "one analyse per agency's run");
  assert.equal(w.stageRuns.find((s) => s.fileId === "c1" && s.stage === "store").status, "skipped", "a commission file has no snapshots");
});

test("running it twice on the same files leaves no duplicates", async () => {
  const w = world(files());
  await runPipeline(w.deps, { trigger: "file_arrival", deadline: Infinity, concurrency: 3 });
  const counts = [w.snapshots.size, w.ledger.size];
  // Force every file through again, as a crash-and-rerun or an over-eager scheduler would.
  // Every stage writes again, as if its records were lost: the keys make the second write a no-op.
  for (const f of w.state.values()) f.complete = false;
  w.ctx.forget = true;
  await runPipeline(w.deps, { trigger: "file_arrival", deadline: Infinity, concurrency: 3 });
  assert.deepEqual([w.snapshots.size, w.ledger.size], counts);
  assert.deepEqual(counts, [4, 2]);
  assert.ok(w.stageRuns.filter((s) => s.runId === "run3" && s.stage === "store" && s.status === "succeeded").length >= 1, "the stores really ran again");
  // And a third run finds nothing pending at all.
  const third = await runPipeline(w.deps, { trigger: "file_arrival", deadline: Infinity, concurrency: 3 });
  assert.deepEqual(third, []);
});

test("a crashed stage resumes from the last completed stage, not from the start", async () => {
  const w = world(files(), { failReconcileOnce: ["p1"] });
  const first = await runPipeline(w.deps, { trigger: "file_arrival", deadline: Infinity, concurrency: 1 });
  assert.equal(first.find((r) => r.tenantId === "t1").status, "partial");
  assert.equal(w.stageRuns.find((s) => s.runId === "run1" && s.fileId === "p1" && s.stage === "reconcile").status, "failed");
  assert.match(w.stageRuns.find((s) => s.runId === "run1" && s.fileId === "p1" && s.stage === "reconcile").error, /database went away/);
  assert.equal(w.snapshots.has("p1|A"), true, "the failure left the stored snapshots in place");

  await runPipeline(w.deps, { trigger: "scheduled", deadline: Infinity, concurrency: 1 });
  const second = w.stageRuns.filter((s) => s.fileId === "p1" && s.runId === "run3");
  assert.deepEqual(second.map((s) => [s.stage, s.status]), [["collect", "skipped"], ["ingest", "skipped"], ["parse", "succeeded"], ["store", "skipped"], ["match", "skipped"], ["reconcile", "succeeded"]]);
  assert.match(second.find((s) => s.stage === "parse").note, /to resume/);
  assert.match(second.find((s) => s.stage === "store").note, /earlier run/);
  assert.equal(w.state.get("p1").complete, true);
});

test("a blocked parse stops its file and keeps the registry and raw rows; the other files go on", async () => {
  const w = world([{ tenantId: "t1", fileId: "p1", fileType: "policies", rows: ["A"], blocked: true }, { tenantId: "t1", fileId: "p9", fileType: "policies", rows: ["Z"] }]);
  const [run] = await runPipeline(w.deps, { trigger: "file_arrival", deadline: Infinity, concurrency: 1 });
  assert.deepEqual([run.status, run.succeeded, run.failed], ["partial", 1, 1]);
  const p1 = w.stageRuns.filter((s) => s.fileId === "p1");
  assert.deepEqual(p1.map((s) => s.status), ["skipped", "skipped", "blocked", "skipped", "skipped", "skipped"]);
  assert.match(p1[3].note, /Not run: the parse is blocked/);
  assert.equal(w.state.get("p1").complete, false, "still pending: it is read once a layout map exists");
  assert.equal(w.snapshots.has("p9|Z"), true);
});

test("files not started before the deadline wait for the next run; a started file is finished", async () => {
  const w = world(files());
  const deps = { ...w.deps, store: async (file, passed) => { w.tick(1000); return w.deps.store(file, passed); } };
  const out = await runPipeline(deps, { trigger: "file_arrival", deadline: 500, concurrency: 1 });
  assert.equal(out.reduce((sum, r) => sum + r.total, 0), 1);
  assert.equal(out.reduce((sum, r) => sum + r.leftForNextRun, 0), 2);
  assert.match(w.runs.find((r) => r.tenantId === "t1").error, /left for the next run/);
  assert.deepEqual([runStatus(3, 0), runStatus(2, 1), runStatus(0, 2)], ["succeeded", "partial", "failed"]);
});

test("agents: blocking stops a stage, a warning doesn't; findings keep their model and prompt", () => {
  assert.deepEqual([...AGENTS], ["file_monitor", "parser_guardian", "pdf_extractor", "matching_agent", "commission_reconciler", "insights_analyst"]);
  assert.equal(stopsStage([{ severity: "warning" }, { severity: "info" }]), false);
  assert.equal(stopsStage([{ severity: "warning" }, { severity: "blocking" }]), true);
  assert.equal(providerStatus(null).configured, false);
  const provider = { modelId: "model-x", promptVersion: "match-v3", complete: async (b) => b };
  const draft = { agent: "matching_agent", findingType: "match_decision", severity: "info", payload: { name: "Ann Lee", dob: "1950-02-03" }, reasoning: "Same name and date of birth", confidence: 0.92, dedupeKey: "k" };
  const row = findingRow("t", draft, provider);
  assert.deepEqual([row.model_id, row.prompt_version, row.confidence], ["model-x", "match-v3", 0.92]);
  assert.throws(() => findingRow("t", draft, null), /needs a model, and none is configured/);
  const det = findingRow("t", { ...draft, agent: "file_monitor", findingType: "missing_file", confidence: null }, null);
  assert.deepEqual([det.model_id, det.prompt_version], [null, null], "a deterministic finding names no model");
  assert.throws(() => findingRow("t", { ...draft, confidence: 1.5 }, provider), /between 0 and 1/);
});

test("no prompt ever carries an SSN, a bank account or routing number, or a card number", async () => {
  const bad = [
    { ssn: "123-45-6789" },
    { notes: "client SSN 123-45-6789 on file" },
    { notes: "SSN 123456789" },
    { bank_account_number: "000123456789" },
    { memo: "routing 021000021" },
    { memo: "card 4111 1111 1111 1111" },
    { nested: [{ deep: { card: "5555555555554444" } }] },
  ];
  for (const payload of bad) {
    assert.ok(promptProblems(payload).length > 0, JSON.stringify(payload));
    assert.throws(() => assertPromptSafe(payload), UnsafePromptError);
  }
  const allowed = { name: "Ann Lee", dob: "1950-02-03", phone: "(555) 010-2030", policy_number: "123456789", premium: "61.00", carrier: "Americo" };
  assert.deepEqual(promptProblems(allowed), [], "the matching exception: name, date of birth, phone; a policy number is not an SSN");
  // runBatched checks each batch before it leaves.
  const provider = { modelId: "m", promptVersion: "p", complete: async () => { throw new Error("must not be called"); } };
  await assert.rejects(runBatched(provider, [{ notes: "SSN 123-45-6789" }], { batchSize: 5, perMinute: 60, sleep: async () => {}, now: () => 0 }), UnsafePromptError);
});

test("model calls are batched and paced, never one per row at once", async () => {
  let t = 0;
  const sleeps = [];
  const calls = [];
  const provider = { modelId: "m", promptVersion: "p", complete: async (batch) => { calls.push(batch.length); return batch.map((x) => x * 2); } };
  const out = await runBatched(provider, Array.from({ length: 55 }, (_, i) => i), { batchSize: 20, perMinute: 6, sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t });
  assert.deepEqual(calls, [20, 20, 15], "55 rows, three calls");
  assert.equal(out.calls, 3);
  assert.deepEqual(sleeps, [10000, 10000], "six a minute: ten seconds apart");
  assert.equal(out.results[54], 108);
  assert.throws(() => batches([1], 0), /at least one/);
});

test("weekly accuracy per agent, from people's corrections only", () => {
  const rows = weeklyAccuracy([
    { agent: "parser_guardian", status: "approved", reviewedAt: "2026-10-05T10:00:00Z" },
    { agent: "parser_guardian", status: "approved", reviewedAt: "2026-10-07T10:00:00Z" },
    { agent: "parser_guardian", status: "rejected", reviewedAt: "2026-10-11T23:00:00Z" },
    { agent: "parser_guardian", status: "approved", reviewedAt: "2026-10-12T09:00:00Z" },
    { agent: "file_monitor", status: "auto_resolved", reviewedAt: null },
    { agent: "file_monitor", status: "open", reviewedAt: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.agent, r.week, r.approved, r.rejected, r.accuracyPct]), [["parser_guardian", "2026-10-12", 1, 0, 100], ["parser_guardian", "2026-10-05", 2, 1, 67]]);
});

test("agents never write Layer 1 or the ledger: in the code, and in the database", () => {
  for (const source of [agentsSource, storeSource]) {
    assert.doesNotMatch(source, /from\("raw_rows"\)\.(update|delete|upsert|insert)/);
    assert.doesNotMatch(source, /from\("commission_entry"\)\.(update|delete|upsert|insert)/);
  }
  assert.doesNotMatch(agentsSource, /anthropic|openai|fetch\(/i, "no provider is wired in yet");
  assert.match(sql, /revoke insert, update, delete, truncate on public\.raw_rows, public\.commission_entry from insurvas_agent/);
  assert.match(sql, /set local role insurvas_agent;/);
  assert.match(sql, /create index if not exists agent_findings_model_idx on public\.agent_findings \(tenant_id, agent_name, model_id, prompt_version\)/);
  assert.match(sql, /when 'weekly' then r\.last_at::date \+ 7/);
  assert.match(sql, /where e\.cadence in \('daily', 'weekly', 'monthly'\)/, "an ad-hoc or unset carrier never raises a missing file");
});
