// Book of business › Setup (owner 2026-11-02, round 2; docs/la4/BUILD-ROUND2.md): the tabs, the pipeline
// rules engine and its migration, as source contracts. DB-free and network-free: reads source text only.
// Run with: node --experimental-strip-types --test lib/pipelineRules/setupContract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const SHELL = "app/app/(shell)/book-setup";

test("Setup is five tabs, each its own address, each inside the frame under the Setup step", () => {
  const tabs = read("components/app/book/setup/setup-tabs.tsx");
  for (const [label, href] of [["Rate card", "/app/book-setup"], ["Carrier rules", "/app/book-setup/carrier-rules"], ["Pipeline rules", "/app/book-setup/pipeline-rules"], ["Agent codes", "/app/book-setup/agent-codes"], ["Bring your existing book", "/app/book-import"]]) {
    assert.ok(tabs.includes(`label: "${label}", href: "${href}"`), label);
  }
  for (const [page, active] of [["page.tsx", "rate-card"], ["carrier-rules/page.tsx", "carrier-rules"], ["pipeline-rules/page.tsx", "pipeline-rules"], ["agent-codes/page.tsx", "agent-codes"]]) {
    const source = read(`${SHELL}/${page}`);
    assert.match(source, /<DataInPage step="setup" lead=\{<SetupTabs active="/, page);
    assert.ok(source.includes(`<SetupTabs active="${active}"`), page);
    assert.doesNotMatch(source, /<PageHeader\b/, `${page}: the frame draws the one title`);
  }
  // The Setup step keeps its own gate; every other tab passes the same gate plus owner or bookkeeper.
  assert.match(read(`${SHELL}/page.tsx`), /guardPage\("statement_ingestion"\)[\s\S]*actAsPagePermission\(guard, "statements\.view"\)[\s\S]*actAsPage\(guard, \["owner", "bookkeeper"\]\)/);
  // Written in each page (the producer-isolation audit reads the page's own gate).
  for (const page of ["carrier-rules/page.tsx", "agent-codes/page.tsx", "pipeline-rules/page.tsx", "pipeline-rules/new/page.tsx", "pipeline-rules/[ruleId]/page.tsx"]) {
    const source = read(`${SHELL}/${page}`);
    assert.match(source, /guardPage\("statement_ingestion"\)/, page);
    assert.match(source, /if \(!actAsPagePermission\(guard, "statements\.view"\) \|\| !actAsPage\(guard, \["owner", "bookkeeper"\]\)\) return <RoleGateNotice /, page);
  }
  // The older addresses keep working as they are.
  assert.ok(existsSync(join(process.cwd(), "app/app/(shell)/rate-card/page.tsx")));
  assert.ok(existsSync(join(process.cwd(), "app/app/(shell)/book-import/page.tsx")));
});

test("the rate card and agent codes reuse today's screens and data", () => {
  const rate = read(`${SHELL}/page.tsx`);
  assert.match(rate, /loadRateCard\(guard\.context\.tenantId\)/);
  assert.match(rate, /<RateCardWorkspace /);
  assert.match(read(`${SHELL}/agent-codes/page.tsx`), /loadMatching\(guard\.context\.tenantId\)/);
  const codes = read("components/app/book/setup/agent-codes.tsx");
  for (const action of ["map_agent", "unmap_agent", "add_agent"]) assert.ok(codes.includes(`action: "${action}"`), action);
  assert.ok(codes.includes('"/api/app/policy-matching"'));
});

test("carrier rules: the agency's own dated rule beside Insurvas's, edited in the row, on the agency plane", () => {
  const route = read("app/api/app/carrier-rules/route.ts");
  assert.match(route, /requireFeatureRole\("statement_ingestion", roles\)/);
  assert.match(route, /requireFeatureRole\("statement_ingestion", roles, \{ write: true \}\)/);
  assert.match(route, /runCarrierRulesAction\(\{ plane: "agency", tenantId: auth\.context\.tenantId/);
  assert.match(route, /loadCarrierRuleSides\(auth\.context\.tenantId\)/);
  const sides = read("lib/pipelineRules/carrierRuleSides.ts");
  assert.match(sides, /\.or\(`tenant_id\.eq\.\$\{tenantId\},tenant_id\.is\.null`\)/, "only this agency's rows and Insurvas's");
  assert.match(sides, /resolveRule\(mine\.filter\(\(r\) => r\.tenantId === null\)/, "Insurvas's value resolved on its own");
  const editor = read("components/app/book/setup/carrier-rules-editor.tsx");
  assert.match(editor, /action: "add_rule"/);
  assert.match(editor, /action: "clear_override"/);
  assert.doesNotMatch(editor, /<Dialog\b/, "edited in the row, no pop-up");
});

test("the API routes are registered, gated and tenant-scoped", () => {
  const policy = read("lib/entitlements/agentApiPolicy.ts");
  assert.match(policy, /"app\/api\/app\/carrier-rules\/route\.ts", featureKey: "statement_ingestion", allowedRoles: \["owner", "bookkeeper"\]/);
  assert.match(policy, /"app\/api\/app\/pipeline-rules\/route\.ts", featureKey: "statement_ingestion", allowedRoles: \["owner", "bookkeeper"\]/);
  const route = read("app/api/app/pipeline-rules/route.ts");
  assert.match(route, /requireFeatureRole\("statement_ingestion", roles/);
  assert.match(route, /const scope = \{ tenantId: auth\.context\.tenantId, userId: auth\.context\.userId \}/);
  const cron = read("app/api/cron/pipeline-rules/route.ts");
  assert.ok(cron.includes('if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)'), "fails closed on CRON_SECRET");
});

test("the store filters on the tenant, previews with the run's own checks, and moves through moveLead once", () => {
  const store = read("lib/pipelineRules/store.ts");
  // Every table the store names is read or written with the tenant on it (the global carrier library aside).
  for (const match of store.matchAll(/from\("(pipeline_rule\w*|agent_leads|tenant_lead_notes|policy_current|policy_change|commission_entry|tenant_application_cases|tenant_applications|tenant_lead_stage_events|tenant_pipelines)"\)[^;]*/g)) {
    assert.ok(/eq\("tenant_id", (tenantId|scope\.tenantId)\)|insert\(\{\s*tenant_id: (tenantId|scope\.tenantId)|insert\(versionRow\(scope|upsert\(part|insert\(row\(d|select\("tenant_id"\)\.eq\("enabled", true\)/.test(match[0]), `untenanted: ${match[0].slice(0, 120)}`);
  }
  assert.equal([...store.matchAll(/planRun\(/g)].length, 2, "one planner, for the preview and the run");
  assert.match(store, /moveLead\(tenantId, \{ leadId: d\.leadId!, [^}]*source: "pipeline_rule" \}\)/);
  assert.match(store, /insert\(row\(d, "claimed"\)\)/, "a live move is claimed before it is made");
  assert.match(store, /onConflict: "tenant_id,rule_id,version,mode,change_key", ignoreDuplicates: true/);
  assert.match(store, /export async function loadPolicyRuleEvents\(tenantId: string, carrierId: string, policyNumber: string\)/);
  assert.match(store, /export async function countRuleHolds\(tenantId: string\): Promise<number \| null>/);
  assert.match(store, /if \(isSchemaGap\(active\.error\)\) return \{ \.\.\.NOTHING, available: false/, "the run does nothing before the migration");
  assert.match(store, /if \(!active\.data\?\.length\) return \{ \.\.\.NOTHING, reason: "No rule is on" \}/, "nor with no rule on");
  const sync = read("lib/applications/stageSyncService.ts");
  assert.match(sync, /export async function moveLead\(/);
  assert.match(sync, /input\.source === "pipeline_rule" \? \{ source: "pipeline_rule" \} : \{ source: "application_sync" \}/);
});

test("the daily run evaluates the rules once its files are in, and never fails for them", () => {
  const run = read("lib/ingestion/dailyRunStore.ts");
  assert.match(run, /async analyse\(tenantId, runId\) \{[\s\S]*?const outcome = await runPipelineRules\(tenantId, "file"\);[\s\S]*?catch \(error\) \{\n\s*console\.error\("\[daily-run\] the pipeline rules could not run"/);
});

test("the migration: six tables, RLS read by tenant, write guards, the once key, the history source, the morning check", () => {
  const sql = read("supabase/migrations/20261102100000_pipeline_rules.sql");
  for (const table of ["pipeline_rule_settings", "pipeline_rule", "pipeline_rule_version", "pipeline_rule_run", "pipeline_rule_evaluation", "pipeline_rule_hold"]) {
    assert.ok(sql.includes(`create table if not exists public.${table} (`), table);
    assert.ok(sql.includes(`alter table public.${table} enable row level security;`), `${table} RLS`);
    assert.ok(sql.includes(`revoke delete, truncate on public.${table} from service_role;`) || sql.includes(`revoke update, delete, truncate on public.${table} from service_role;`), `${table} write guard`);
  }
  assert.match(sql, /mode text not null default 'forecast' check \(mode in \('draft', 'forecast', 'live'\)\)/, "a rule starts in forecast");
  assert.match(sql, /constraint pipeline_rule_evaluation_once unique \(tenant_id, rule_id, version, mode, change_key\)/);
  assert.match(sql, /revoke update, delete, truncate on public\.pipeline_rule_version from service_role;/, "a version never changes");
  assert.match(sql, /using \(tenant_id = nullif\(current_setting\(''app\.tenant_id'', true\), ''''\)::uuid\)/);
  assert.match(sql, /'application_sync', 'pipeline_rule'\]\)\) not valid;/);
  assert.match(sql, /'\/api\/cron\/pipeline-rules'\n {2}\]::text\[\];/);
  assert.match(sql, /cap_per_run integer not null default 25/);
  assert.match(sql, /hand_move_days integer not null default 7/);
});
