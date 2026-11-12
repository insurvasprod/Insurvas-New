// Book of business › Setup (owner 2026-11-02, round 2; docs/la4/BUILD-ROUND2.md): the tabs, the pipeline
// rules engine and its migration, as source contracts. DB-free and network-free: reads source text only.
// Run with: node --experimental-strip-types --test lib/pipelineRules/setupContract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const SHELL = "app/app/(shell)/book-setup";

test("Setup's five tabs are Carrier sync steps on the rail, each its own address, each inside the frame (owner 2026-11-05)", () => {
  const steps = read("lib/dataIn/steps.ts");
  // Board 8 (mockups r5): How files arrive and Bring your existing book are the two sections of Files in.
  const listed = [["Rate card", "/app/book-setup"], ["Carrier terms", "/app/book-setup/carrier-rules"], ["Card moves", "/app/book-setup/pipeline-rules"], ["Agent codes", "/app/book-setup/agent-codes"], ["Files in", "/app/book-setup/how-files-arrive"]];
  for (const [label, href] of listed) assert.ok(steps.includes(`area: "sync", label: "${label}", href: "${href}"`), label);
  assert.ok(!existsSync(join(process.cwd(), "components/app/book/setup/setup-tabs.tsx")), "no tab bar: the rail holds them");
  // Each step's badge is what is missing there, read the same way as the tabs counted it.
  assert.match(read("app/api/app/data-in/steps/route.ts"), /keeper \? setupTabCounts\(tenantId\)\.catch\(\(\) => null\) : null/);
  for (const [page, step] of [["page.tsx", "rate-card"], ["carrier-rules/page.tsx", "carrier-rules"], ["pipeline-rules/page.tsx", "pipeline-rules"], ["agent-codes/page.tsx", "agent-codes"], ["how-files-arrive/page.tsx", "files-in"]]) {
    const source = read(`${SHELL}/${page}`);
    assert.match(source, new RegExp(`<DataInPage step="${step}"`), page);
    assert.doesNotMatch(source, /SetupTabs/, page);
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

test("carrier terms: the agency's own dated rule over Insurvas's, edited in a dialog from the grid or the carrier's page, on the agency plane", () => {
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
  // Round 7 board 1·B (the terms grid, owner 2026-11-10): Windows · Money · Files on the title line; a cell opens its
  // dialog, the carrier's name opens its page; "Set the next window" steps through every gap.
  const list = read(`${SHELL}/carrier-rules/page.tsx`);
  assert.match(list, /<CarrierCoverageList rows=\{rows\} tab=\{tab\} asOf=\{view\.asOf\} readOnly=\{readOnly\} \/>/);
  assert.match(list, /<DataInPage step="carrier-rules" chip=\{info\} tabs=\{tabs\} actions=\{actions\}>/);
  assert.match(list, /<WindowQueueButton queue=\{missingQueue\(view\.carriers\)\}/);
  assert.match(list, /if \(carrier && isRecordUuid\(carrier\)\) redirect\(carrierRulesHref\(carrier\)\);/, "the old ?carrier= link lands on the carrier");
  const grid = read("components/app/book/setup/carrier-coverage-list.tsx");
  assert.match(grid, /<WindowCell row=\{row\.windows\[i\]\} onOpen=\{\(\) => openWindow\(row, row\.windows\[i\]\)\} \/>/, "a cell opens that window's dialog");
  assert.match(grid, /<Link href=\{carrierHref\(row\.carrierId, tab\)\} className="font-medium text-foreground hover:underline">\{row\.carrierName\}<\/Link>/, "the name opens the carrier");
  assert.doesNotMatch(grid, /<LinkRow\b/, "the cells are their own buttons; the row is not one link");
  // Boards 1·1–1·4: the carrier page's tabs and one window dialog, never an editor in the row; each save is a new
  // dated rule; Back to Insurvas's and verifying ask first.
  const carrierPage = read(`${SHELL}/carrier-rules/[carrierId]/page.tsx`);
  assert.match(carrierPage, /const TABS: CarrierTab\[\] = \["windows", "money", "files", "history"\];/);
  assert.doesNotMatch(carrierPage, /facts=\{/, "no facts line under the title");
  const dialog = read("components/app/book/setup/carrier-terms-window-dialog.tsx");
  assert.match(dialog, /action: "add_rule"/);
  assert.match(dialog, /action: "clear_override"/);
  assert.match(dialog, /action: "verify", rule_id: row\.rule\.id/);
  assert.match(dialog, /title: "Mark it verified\?"/);
  assert.match(dialog, /title: "Back to Insurvas's\?"/);
  assert.match(dialog, /const DIALOG_SIZE = "lg" as const;[\s\S]*<DialogContent size=\{DIALOG_SIZE\}/, "the window dialog, lg 560 (board 1·4)");
  const windows = read("components/app/book/setup/carrier-rule-windows.tsx");
  assert.match(windows, /<WindowDialog /);
  assert.doesNotMatch(windows, /<input\b/, "no editor inside the row");
  const facts = read("components/app/book/setup/carrier-facts.tsx");
  assert.match(facts, /action: "save_settings"/);
  assert.match(facts, /export function FactDialog\(/);
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
  assert.match(run, /async analyse\(tenantId, runId\) \{[\s\S]*?const outcome = await runPipelineRules\(tenantId, "file"\);[\s\S]*?catch \(error\) \{\n\s*console\.error\("\[daily-run\] the card-move rules could not run"/);
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
  assert.ok(read("lib/dataIn/steps.ts").includes('{ key: "files-in", area: "sync", label: "Files in", href: "/app/book-setup/how-files-arrive", icon: "import" }'));
  const page = read(`${SHELL}/how-files-arrive/page.tsx`);
  assert.match(page, /<DataInPage step="files-in" actions=\{upload\}/);
  // r7 4·A (owner 2026-11-10): the three ways in are the sub-page bar on the title line — Your carriers · Email ·
  // Bucket — each tab its own address; the cards are gone. /app/book-import renders this page; the old ?date= lands on Bucket.
  assert.doesNotMatch(page, /<section aria-label="How files arrive"/, "the three cards are the tabs now");
  assert.match(page, /tabs=\{<FilesInTabs active="carriers"/);
  const tabs = read("components/app/book/setup/files-in-tabs.tsx");
  assert.match(tabs, /href: FILES_IN_HREF/);
  assert.match(tabs, /href: `\$\{FILES_IN_HREF\}\/email`/);
  assert.match(tabs, /href: `\$\{FILES_IN_HREF\}\/bucket`/);
  assert.match(page, /if \(date && isoDate\(date\)\) redirect\(`\$\{FILES_IN_HREF\}\/bucket\?date=\$\{date\}`\);/);
  assert.match(page, /<BookImport carriers=\{view\.carriers\}/);
  const email = read(`${SHELL}/how-files-arrive/email/page.tsx`);
  const bucket = read(`${SHELL}/how-files-arrive/bucket/page.tsx`);
  for (const sub of [email, bucket]) {
    assert.match(sub, /guardPage\("statement_ingestion"\)/);
    assert.match(sub, /if \(!actAsPagePermission\(guard, "statements\.view"\) \|\| !actAsPage\(guard, \["owner", "bookkeeper"\]\)\) return <RoleGateNotice /);
    assert.match(sub, /<DataInPage\s+step="files-in"/);
    assert.match(sub, /tabs=\{<FilesInTabs active="(?:email|bucket)"/);
  }
  assert.match(read("app/app/(shell)/book-import/page.tsx"), /import SetupFilesInPage from "\.\.\/book-setup\/how-files-arrive\/page";[\s\S]*if \(!actAsPagePermission\(guard, "statements\.view"\) \|\| !actAsPage\(guard, \["owner", "bookkeeper"\]\)\) return <RoleGateNotice [\s\S]*return <SetupFilesInPage \{\.\.\.props\} \/>;/);
  assert.doesNotMatch(page, /Three doors/, "no explainer card (round 3): Upload is the page's action");
  assert.match(page, /guardPage\("statement_ingestion"\)/);
  assert.match(page, /if \(!actAsPagePermission\(guard, "statements\.view"\) \|\| !actAsPage\(guard, \["owner", "bookkeeper"\]\)\) return <RoleGateNotice /);
  assert.doesNotMatch(page, /<PageHeader\b/);
  // The same components and loaders the Carrier files view used.
  for (const part of ["<CarrierFileUploadButton", "listSenders(tenantId)"]) assert.ok(page.includes(part), part);
  for (const part of ["<CarrierFileDoors", "getInboundAddress(tenantId)", "listSenders(tenantId)"]) assert.ok(email.includes(part), part);
  for (const part of ["<CarrierBucket", "loadBucketView(tenantId, day)"]) assert.ok(bucket.includes(part), part);
  // Writing stays paused while read-only, as before.
  assert.match(email, /canWrite=\{!readOnly\}/);
  assert.match(page, /readOnly \? "Receiving files is paused while the account is read-only\." : null/);
  // Registered with the trace registry, as every LA-4 screen that reads carrier data.
  assert.match(read("lib/ingestion/trace.ts"), /"app\/app\/\(shell\)\/book-setup\/how-files-arrive\/page\.tsx": \{ label: "Setup › Files in", sources: \["policy_current"\] \}/);
});

test("round 3 + r7: no explainer cards in Setup — the rules list's warnings became counts on its tabs and rows (mockup r7 2·A)", () => {
  const pages = ["page.tsx", "carrier-rules/page.tsx", "carrier-rules/[carrierId]/page.tsx", "pipeline-rules/page.tsx", "pipeline-rules/new/page.tsx", "pipeline-rules/[ruleId]/page.tsx", "agent-codes/page.tsx", "how-files-arrive/page.tsx"];
  for (const page of pages) assert.doesNotMatch(read(`${SHELL}/${page}`), /<Callout[^>]*tone="info"/, page);
  // Card moves: no notice card at all (owner 2026-11-02 / r7): the modes are the sub-page bar.
  for (const page of ["pipeline-rules/page.tsx", "pipeline-rules/new/page.tsx", "pipeline-rules/[ruleId]/page.tsx"]) assert.doesNotMatch(read(`${SHELL}/${page}`), /<Callout/, page);
  const list = read(`${SHELL}/pipeline-rules/page.tsx`);
  assert.match(list, /<ViewTabs label="Rules by mode" tabs=\{tabs\} value=\{bucket\} \/>/);
  assert.match(list, /const bucket: RuleBucket = isBucket\(asked\) \? asked : waiting \? "forecast" : "all";/, "opens on Forecast while a rule waits for a check");
  assert.match(list, /tone: \(b === "live" && capped !== null\)/, "a stopped run: a red count on Live");
  assert.match(list, /!view\.settings\.engineOn \? "Card moves are switched off for this agency\."/, "engine off: New rule disabled with the reason");
  const rows = read("components/app/book/setup/rules-list.tsx");
  assert.match(rows, /const HELD_HREF = "\/app\/needs-you\?view=agency";/, "held opens Needs you");
  assert.match(rows, /title="No rule is live"/, "none on: the Live tab's empty state");
  assert.match(rows, /<th className="w-\[140px\]">To check<\/th>/);
  const rule = read(`${SHELL}/pipeline-rules/[ruleId]/page.tsx`);
  assert.doesNotMatch(rule, /This rule is live/);
  assert.doesNotMatch(rule, /chip=\{/, "title alone: the mode is on the Overview's track");
});

test("round 6 (direction F, owner's pick 2026-11-06): a rule's page is getting it live — Overview · Check it · Rule · Versions", () => {
  const page = read(`${SHELL}/pipeline-rules/[ruleId]/page.tsx`);
  assert.match(page, /<RuleTabs active=\{tab\}/);
  assert.match(page, /const tab = ruleTabOf\(/);
  assert.doesNotMatch(page, /facts=\{/, "no facts line under the title");
  assert.match(page, /<RuleOverview/);
  const tabs = read("components/app/book/setup/rule-tabs.tsx");
  assert.match(tabs, /if \(asked === "preview" \|\| asked === "forecast"\) return "check";/, "the old tabs land on Check it");
  const actions = read("components/app/book/setup/rule-actions.tsx");
  assert.match(actions, /title: `Turn off “\$\{name\}”\?`/, "Turn off asks first");
  assert.match(actions, /aria-label="More"/);
  assert.match(read("components/app/book/setup/rule-form.tsx"), /<StagePicker board=\{board\} value=\{draft\.fromStageIds\}/);
  assert.match(read("components/app/book/setup/rule-overview.tsx"), /title="Before it goes live"/);
  // Round 7 (2·1–2·5): the stepper names the neighbouring rules; checking happens in a dialog, with the note the API keeps.
  assert.match(page, /<RuleStepper prev=\{step\(walk\[at - 1\]\)\} next=\{step\(walk\[at \+ 1\]\)\} \/>/);
  const check = read("components/app/book/setup/card-moves-check.tsx");
  assert.match(check, /\{ action: "check", evaluation_id: line\.id, verdict, note: note\?\.trim\(\) \|\| null \}/);
  assert.match(check, /<DialogContent size=\{"lg"\}/);
  assert.doesNotMatch(read("components/app/book/setup/forecast-table.tsx"), /onClick=\{\(\) => void check\(/, "no Right / Wrong buttons in the rows");
  assert.match(read("components/app/book/setup/preview-table.tsx"), /<DialogContent size="2xl">/, "Preview today is a dialog");
  assert.match(read("components/app/book/setup/rule-form.tsx"), /export function RuleFormActions/, "save on the title line");
});
