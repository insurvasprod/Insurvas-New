// LA-5.10 (Notion sprint) · income capture: the rules, who can reach it, and where it may never go.
// Run with: node --experimental-strip-types --test lib/retention/income.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { coverageText, incomeTypeFromDraft, INTERVIEW_PROMPT, IncomeRuleError, toRecord } from "./income.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const ROUTES = ["app/api/app/applications/attempts/[id]/income/route.ts", "app/api/app/retention/income/route.ts"];

test("a stated figure is kept as stated; an agent's estimate is kept, and marked as one", () => {
  assert.deepEqual(toRecord({ monthlyDollars: "$1,450", incomeType: "ssa", householdTotal: false, estimate: false }, "interview"),
    { monthlyIncomeCents: 145000, incomeType: "ssa", householdTotal: false, source: "interview", confidence: "stated" });
  assert.equal(toRecord({ monthlyDollars: "900", incomeType: null, householdTotal: false, estimate: false }, "draft_date_setup").source, "draft_date_setup");
  assert.equal(toRecord({ monthlyDollars: "900", incomeType: null, householdTotal: false, estimate: false }, "save_queue").source, "retention_call");
  const guess = toRecord({ monthlyDollars: "1200.50", incomeType: "pension", householdTotal: true, estimate: true }, "save_queue");
  assert.equal(guess.source, "agent_estimate");
  assert.equal(guess.confidence, "estimated");
  assert.equal(guess.monthlyIncomeCents, 120050);
  for (const bad of ["", "abc", "0", "-5", "100000"]) assert.throws(() => toRecord({ monthlyDollars: bad, incomeType: null, householdTotal: false, estimate: false }, "interview"), IncomeRuleError, bad);
  // The radar weighs an estimate at half a stated figure (LA-5.2).
  assert.match(read("lib/retention/score.ts"), /if \(s\.incomeConfidence === "estimated"\) weight = weight \/ 2;/);
});

test("LA-3.9's income type maps onto the income record's", () => {
  assert.equal(incomeTypeFromDraft("ssa_ssi"), "mixed");
  assert.equal(incomeTypeFromDraft("none"), null);
  assert.equal(incomeTypeFromDraft(null), null);
  assert.equal(incomeTypeFromDraft("pension"), "pension");
});

test("the prompt keeps the spec's wording: a reason the client benefits from", () => {
  assert.match(INTERVIEW_PROMPT, /comfortable in six months/);
});

// Owner 2026-10-28: neither the interview nor the Payment step asks it any more — the template's financial
// justification questions cover the same ground — so it is captured in the save queue (LA-5.10 asked for three).
test("captured in the save queue, not the interview or the draft date; one record per person", () => {
  assert.doesNotMatch(read("components/app/applications/workspace/steps/interview-step.tsx"), /<IncomeCapture/);
  assert.doesNotMatch(read("components/app/applications/workspace/steps/payment-step.tsx"), /<IncomeCapture/);
  assert.match(read("components/app/save-queue-board.tsx"), /\/api\/app\/retention\/income/);
  const store = read("lib/retention/incomeStore.ts");
  assert.match(store, /if \(target\.contactId\) return \{ table: "contact_income", key: "contact_id", id: target\.contactId \};/);
  assert.match(store, /from\(at\.table\)\.upsert\(\{[\s\S]*onConflict: at\.key/);
});

test("coverage: a count, a share, and what a figure is worth", () => {
  assert.equal(coverageText(204, 418, 10), "Income known for 204 of 418 policies (49%). 214 are scored without it. An income typically moves a score by up to 10 points.");
  assert.equal(coverageText(0, 0, 10), "No policy is scored yet.");
});

test("owners and producers only: setters, assistants (the buffer work) and bookkeepers get 403", () => {
  for (const route of ROUTES) {
    const source = read(route);
    const calls = [...source.matchAll(/requireFeatureRole\("(\w+)", ROLES/g)];
    assert.ok(calls.length >= 2, `${route} gates every method`);
    assert.match(source, /const ROLES = \["owner", "producer"\] as const;/);
    const policy = AGENT_API_POLICIES.find((p) => p.sourceFile === route);
    assert.deepEqual(policy?.allowedRoles, ["owner", "producer"], route);
  }
  // The writing agent only: another producer gets 403 on someone else's application; the retention route keeps producers to their own book.
  const store = read("lib/retention/incomeStore.ts");
  assert.match(store, /if \(viewer\.role === "producer" && app\.created_by !== viewer\.userId\) throw new IncomeError\([^)]*, 403\);/);
  assert.match(store, /viewer\.role === "producer" && p\.agent_user_id !== viewer\.userId/);
  // Partner users have no route to it: nothing under the partner API reads it.
  const partner = walk(join(root, "app", "api", "partner")).filter((f) => f.endsWith(".ts"));
  for (const file of partner) assert.doesNotMatch(readFileSync(file, "utf8"), /contact_income|incomeStore/, file);
});

test("every read and change by a person is logged; the audit row never carries the amount", () => {
  const store = read("lib/retention/incomeStore.ts");
  assert.match(store, /if \(data\) await log\(viewer, target, "view", surface\);/);
  assert.match(store, /await log\(viewer, target, "save", surface\);/);
  assert.match(store, /await log\(viewer, target, "clear", surface\);/);
  for (const route of ROUTES) assert.doesNotMatch(read(route), /metadata: \{[^}]*monthly/);
});

test("income never goes to an AI provider", () => {
  const files = [...walk(join(root, "lib")), ...walk(join(root, "app")), ...walk(join(root, "components"))].filter((f) => /\.(ts|tsx)$/.test(f));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/contact_income|incomeStore|IncomeCapture/.test(source)) continue;
    assert.doesNotMatch(source, /from "[^"]*(\/ai\/|anthropic|openai|aiProvider|llm)[^"]*"/i, `${relative(root, file)} reads income and imports an AI module`);
  }
  // It is not an interview answer, so no answer payload can carry it — and the assistant's page says so.
  assert.doesNotMatch(read("lib/applications/templates.ts"), /monthly_income/);
  assert.match(read("components/app/settings/sales/ai-assistant.tsx"), /const NEVER = \[[^\]]*"Income"/);
});

test("before the sale's client exists it waits on the lead, and moves to the client when one is linked", () => {
  const store = read("lib/retention/incomeStore.ts");
  // No client is created to hold it (owner, 2026-10-14): the lead holds it instead.
  assert.doesNotMatch(store, /save_contact|clientForLead|from\("contacts"\)\.insert/);
  assert.match(store, /if \(target\.leadId\) return \{ table: "lead_income", key: "lead_id", id: target\.leadId \};/);
  assert.match(store, /lead_id: target\.contactId \? null : target\.leadId/);
  const sql = read("supabase/migrations/20261014700000_la_5_10_lead_income.sql");
  assert.match(sql, /lead_id uuid primary key references public\.agent_leads\(id\) on delete cascade/);
  assert.match(sql, /after update of contact_id on public\.agent_leads\s+for each row when \(old\.contact_id is null and new\.contact_id is not null\)/);
  assert.match(sql, /where public\.contact_income\.updated_at < excluded\.updated_at;/);
  assert.match(sql, /delete from public\.lead_income where lead_id = new\.id;/);
  // The lead's copy has the same rules as the client's.
  const radar = read("supabase/migrations/20261014100000_la_5_1_3_chargeback_radar.sql");
  for (const rule of ["amount", "type", "source", "confidence", "estimate"]) {
    const client = radar.match(new RegExp(`constraint contact_income_${rule} (check .*)`))?.[1].replace(/,$/, "");
    assert.ok(client && sql.includes(`constraint lead_income_${rule} ${client}`), rule);
  }
  assert.match(read("components/app/retention/income-capture.tsx"), /view\.onLead \?/);
});

test("removed with the client: deleting a contact deletes their income", () => {
  assert.match(read("supabase/migrations/20261014100000_la_5_1_3_chargeback_radar.sql"), /contact_id uuid primary key references public\.contacts\(id\) on delete cascade/);
  assert.match(read("supabase/migrations/20261014600000_la_5_10_income_access_log.sql"), /revoke update, delete, truncate on public\.contact_income_access_log from service_role, tenant_app;/);
});

function walk(dir) {
  const out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
