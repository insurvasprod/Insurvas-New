// Book of business › Setup (owner 2026-11-02, round 2; docs/la4/BUILD-ROUND2.md): the tabs, the pipeline
// rules engine and its migration, as source contracts. DB-free and network-free: reads source text only.
// Run with: node --experimental-strip-types --test lib/pipelineRules/setupContract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const SHELL = "app/app/(shell)/book-setup";

test("Setup is five tabs that fit, each its own address, each inside the frame under the Setup step", () => {
  const tabs = read("components/app/book/setup/setup-tabs.tsx");
  // Board 8 (mockups r5): How files arrive and Bring your existing book are the two sections of Files in.
  const listed = [["Rate card", "/app/book-setup"], ["Carrier rules", "/app/book-setup/carrier-rules"], ["Pipeline rules", "/app/book-setup/pipeline-rules"], ["Agent codes", "/app/book-setup/agent-codes"], ["Files in", "/app/book-setup/how-files-arrive"]];
  for (const [label, href] of listed) assert.ok(tabs.includes(`label: "${label}", href: "${href}"`), label);
  assert.equal([...tabs.matchAll(/\{ key: "[a-z-]+", label: "/g)].length, listed.length, "five tabs, no more");
  // Each tab's count is what is missing there, read the same way on every tab.
  assert.match(tabs, /const counts = await setupTabCounts\(tenantId\);/);
  for (const [page, active] of [["page.tsx", "rate-card"], ["carrier-rules/page.tsx", "carrier-rules"], ["pipeline-rules/page.tsx", "pipeline-rules"], ["agent-codes/page.tsx", "agent-codes"], ["how-files-arrive/page.tsx", "files-in"]]) {
    const source = read(`${SHELL}/${page}`);
    assert.match(source, /<DataInPage step="setup" lead=\{<SetupTabs active="/, page);
    assert.ok(source.includes(`<SetupTabs active="${active}"`), page);
    assert.doesNotMatch(source, /<PageHeader\b/, `${page}: the frame draws the one title`);
  }
  // The Setup step keeps its own gate; every other tab passes the same gate plus owner or bookkeeper.
  assert.match(read(`${SHELL}/page.tsx`), /guardPage\("statement_ingestion"\)[\s\S]*actAsPagePermission\(guard, "statements\.view"\)[\s\S]*actAsPage\(guard, \["owner", "bookkeeper"\]\)/);
  // Written in each page (the producer-isolation audit reads the page's own gate).
  for (const page of ["carrier-rules/page.tsx", "carrier-rules/[carrierId]/page.tsx", "agent-codes/page.tsx", "pipeline-rules/page.tsx", "pipeline-rules/new/page.tsx", "pipeline-rules/[ruleId]/page.tsx", "how-files-arrive/page.tsx"]) {
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

test("carrier rules: the agency's own dated rule over Insurvas's, edited in the row on the carrier's page, on the agency plane", () => {
  const route = read("app/api/app/carrier-rules/route.ts");
  assert.match(route, /requireFeatureRole\("statement_ingestion", roles\)/);
  assert.match(route, /requireFeatureRole\("statement_ingestion", roles, \{ write: true \}\)/);
  assert.match(route, /runCarrierRulesAction\(\{ plane: "agency", tenantId: auth\.context\.tenantId/);
  assert.match(route, /loadCarrierRuleSides\(auth\.context\.tenantId\)/);
  const sides = read("lib/pipelineRules/carrierRuleSides.ts");
  assert.match(sides, /\.or\(`tenant_id\.eq\.\$\{tenantId\},tenant_id\.is\.null`\)/, "only this agency's rows and Insurvas's");
  assert.match(sides, /resolveRule\(mine\.filter\(\(r\) => r\.tenantId === null\)/, "Insurvas's value resolved on its own");
  // Board 9: the coverage list reads only this agency's rows and Insurvas's, and opens a carrier's page.
  const coverage = read("lib/pipelineRules/carrierCoverage.ts");
  assert.match(coverage, /from\("carrier_retention_rule"\)\.select\("\*"\)\.or\(`tenant_id\.eq\.\$\{tenantId\},tenant_id\.is\.null`\)/);
  assert.match(coverage, /from\("carrier_operating_settings"\)\.select\("\*"\)\.or\(`tenant_id\.eq\.\$\{tenantId\},tenant_id\.is\.null`\)/);
  assert.match(read(`${SHELL}/carrier-rules/page.tsx`), /<CarrierCoverageList rows=\{rows\} \/>/);
  assert.match(read("components/app/book/setup/carrier-coverage-list.tsx"), /<LinkRow key=\{row\.carrierId\} href=\{carrierRulesHref\(row\.carrierId\)\}>/, "the whole row opens the carrier");
  // Board 9b/9c: a window is edited in its row; each save is a new dated rule; verifying asks first.
  const windows = read("components/app/book/setup/carrier-rule-windows.tsx");
  assert.match(windows, /action: "add_rule"/);
  assert.match(windows, /action: "clear_override"/);
  assert.match(windows, /action: "verify", rule_id: row\.rule\.id/);
  assert.match(windows, /title: "Mark it verified\?"/);
  assert.doesNotMatch(windows, /<Dialog\b/, "edited in the row, no pop-up (the verify confirm is the shared ConfirmDialog)");
  assert.match(read("components/app/book/setup/carrier-facts.tsx"), /action: "save_settings"/);
  assert.ok(!existsSync(join(process.cwd(), "components/app/book/setup/carrier-rules-editor.tsx")), "the carrier page replaced the one-carrier editor");
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

test("round 3: Setup › Files in — the upload, email and bucket doors moved from Carrier files, and the existing book", () => {
  const tabs = read("components/app/book/setup/setup-tabs.tsx");
  assert.ok(tabs.includes('{ key: "files-in", label: "Files in", href: "/app/book-setup/how-files-arrive" }'));
  const page = read(`${SHELL}/how-files-arrive/page.tsx`);
  assert.match(page, /<DataInPage step="setup" lead=\{<SetupTabs active="files-in" tenantId=\{tenantId\} \/>\} actions=\{upload\}>/);
  // Board 8: two sections, How files arrive and Bring your existing book; /app/book-import renders this page.
  assert.match(page, />How files arrive<\/h2>/);
  assert.match(page, />Bring your existing book<\/h2>/);
  assert.match(page, /<BookImport carriers=\{view\.carriers\}/);
  assert.match(read("app/app/(shell)/book-import/page.tsx"), /import SetupFilesInPage from "\.\.\/book-setup\/how-files-arrive\/page";[\s\S]*if \(!actAsPagePermission\(guard, "statements\.view"\) \|\| !actAsPage\(guard, \["owner", "bookkeeper"\]\)\) return <RoleGateNotice [\s\S]*return <SetupFilesInPage \{\.\.\.props\} \/>;/);
  assert.doesNotMatch(page, /Three doors/, "no explainer card (round 3): Upload is the page's action");
  assert.match(page, /guardPage\("statement_ingestion"\)/);
  assert.match(page, /if \(!actAsPagePermission\(guard, "statements\.view"\) \|\| !actAsPage\(guard, \["owner", "bookkeeper"\]\)\) return <RoleGateNotice /);
  assert.doesNotMatch(page, /<PageHeader\b/);
  // The same components and loaders the Carrier files view used.
  for (const part of ["<CarrierFileDoors", "<CarrierBucket", "<CarrierFileUploadButton", "getInboundAddress(tenantId)", "listSenders(tenantId)", "loadBucketView(tenantId, bucketDate)"]) assert.ok(page.includes(part), part);
  // Writing stays paused while read-only, as before.
  assert.match(page, /canWrite=\{!readOnly\}/);
  assert.match(page, /readOnly \? "Receiving files is paused while the account is read-only\." : null/);
  // Registered with the trace registry, as every LA-4 screen that reads carrier data.
  assert.match(read("lib/ingestion/trace.ts"), /"app\/app\/\(shell\)\/book-setup\/how-files-arrive\/page\.tsx": \{ label: "Setup › Files in", sources: \["policy_current"\] \}/);
});

test("round 3: no explainer cards in Setup — the rules list's callouts are one summary line, the rule page has no 'This rule is live' card", () => {
  const pages = ["page.tsx", "carrier-rules/page.tsx", "carrier-rules/[carrierId]/page.tsx", "pipeline-rules/page.tsx", "pipeline-rules/new/page.tsx", "pipeline-rules/[ruleId]/page.tsx", "agent-codes/page.tsx", "how-files-arrive/page.tsx"];
  for (const page of pages) assert.doesNotMatch(read(`${SHELL}/${page}`), /<Callout\b[^>]*tone="info"/, page);
  const list = read(`${SHELL}/pipeline-rules/page.tsx`);
  // One line, most urgent first, each part a link where there is a page to open.
  const keys = [...list.matchAll(/\{ key: "([a-z-]+)", text:/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["capped", "held", "off", "read-only", "forecast", "none-on"]);
  assert.match(list, /href: "\/app\/needs-you\?view=agency"/);
  assert.match(list, /href: rulePage\(forecast\[0\]\.id, "forecast"\)/);
  assert.equal([...list.matchAll(/<Callout\b/g)].length, 2, "the pending note and the one summary line");
  const rule = read(`${SHELL}/pipeline-rules/[ruleId]/page.tsx`);
  assert.doesNotMatch(rule, /This rule is live/);
  // Its warnings are one line each: a title and at most one action.
  for (const [, body] of rule.matchAll(/<Callout\b[^>]*>([\s\S]*?)<\/Callout>/g)) assert.equal([...body.matchAll(/<Link\b/g)].length, 1);
});
