// LA-8.5 (Notion sprint, Module 8 — Settings) · Subscription self-service.
// Run with: node --experimental-strip-types --test lib/billing/selfService.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { dunningView, nextAttemptFromPayload, PROVIDER_RETRY_DAYS, retentionEndsAt, retrySchedule, selfServeActions, tierWarns, usageTier, USAGE_CRITICAL_FRACTION } from "./selfServiceRules.ts";
import { SETTING_DEFS } from "../settings/constants.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = read("supabase/migrations/20261015330000_la_8_5_subscription_self_service.sql");

function walk(dir, out = []) {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** Each exported write handler's body, so a guard on GET cannot pass for POST. */
function handlers(file) {
  const source = read(file);
  const out = [];
  const re = /export async function (GET|POST|PUT|PATCH|DELETE)\b/g;
  let m;
  const starts = [];
  while ((m = re.exec(source))) starts.push({ method: m[1], at: m.index });
  starts.forEach((s, i) => out.push({ method: s.method, body: source.slice(s.at, starts[i + 1]?.at ?? source.length) }));
  return { source, out };
}

test("limits warn at the platform threshold and at 95%, and the upgrade sits beside every warning", () => {
  assert.equal(USAGE_CRITICAL_FRACTION, 0.95);
  assert.equal(usageTier(79, 100, 0.8), "ok");
  assert.equal(usageTier(80, 100, 0.8), "warning");
  assert.equal(usageTier(94, 100, 0.8), "warning");
  assert.equal(usageTier(95, 100, 0.8), "critical");
  assert.equal(usageTier(100, 100, 0.8), "full", "at the limit is full, not over");
  assert.equal(usageTier(101, 100, 0.8), "over");
  assert.equal(usageTier(5_000, null, 0.8), "ok", "unlimited is never warned about");
  assert.equal(usageTier(0, 0, 0.8), "ok");
  assert.equal(usageTier(1, 0, 0.8), "over");
  assert.equal(usageTier(70, 100, 0.7), "warning", "the first tier is the platform's setting, not a constant");
  assert.ok(["warning", "critical", "full", "over"].every(tierWarns) && !tierWarns("ok"));
  const panel = read("components/app/settings/billing-settings.tsx");
  assert.match(panel, /warned\.length && actions\?\.canChangePlan && \(view\.options\.length \|\| view\.planChangeBySupport\) \? \(/);
  assert.match(panel, /<Button type="button" variant="outline" onClick=\{toPlan\}>Upgrade<\/Button>/);
  // Metered limits say when they reset; counted ones (seats, partners) do not reset.
  assert.match(panel, /const reset = l\.metered && l\.resetsAt \? ` Resets \$\{day\(l\.resetsAt\)\}\.` : "";/);
  assert.match(read("lib/billing/selfService.ts"), /metered: true, resetsAt, hardCap/);
});

test("a failed payment shows the dunning state and the date access changes", () => {
  assert.equal(PROVIDER_RETRY_DAYS, 5);
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  // Whop's own retry dates, from its payment.failed events: the first failure, the retries made, the next one named.
  const schedule = retrySchedule([
    { at: "2026-10-16T09:00:00.000Z", nextAttemptAt: "2026-10-18T09:00:00.000Z" },
    { at: "2026-10-15T09:00:00.000Z", nextAttemptAt: "2026-10-16T09:00:00.000Z" },
  ], now);
  assert.deepEqual(schedule, { failedAt: "2026-10-15T09:00:00.000Z", triedAgainOn: ["2026-10-16T09:00:00.000Z"], nextRetryAt: "2026-10-18T09:00:00.000Z" });
  assert.deepEqual(dunningView("past_due", schedule, null), { state: "retrying", failedAt: "2026-10-15T09:00:00.000Z", triedAgainOn: ["2026-10-16T09:00:00.000Z"], nextRetryAt: "2026-10-18T09:00:00.000Z", accessChangesAt: "2026-10-20T09:00:00.000Z" });
  // A retry Whop names after the cut-off never happens; a past one is not "next".
  assert.equal(dunningView("past_due", { failedAt: "2026-10-15T09:00:00.000Z", triedAgainOn: [], nextRetryAt: "2026-10-21T00:00:00.000Z" }, null).nextRetryAt, null);
  assert.equal(retrySchedule([{ at: "2026-10-15T09:00:00.000Z", nextAttemptAt: "2026-10-16T09:00:00.000Z" }], now).nextRetryAt, null);
  assert.deepEqual(dunningView("past_due", null, null), { state: "retrying", failedAt: null, triedAgainOn: [], nextRetryAt: null, accessChangesAt: null });
  assert.equal(nextAttemptFromPayload({ data: { next_payment_attempt: "2026-10-18T09:00:00.000Z" } }), "2026-10-18T09:00:00.000Z");
  assert.equal(nextAttemptFromPayload({ data: { next_payment_attempt_at: 1792310400 } }), new Date(1792310400 * 1000).toISOString());
  assert.equal(nextAttemptFromPayload({ data: {} }), null);
  // The screen says it the spec's way: failed on, retry on, access pauses on.
  const panel = read("components/app/settings/billing-settings.tsx");
  assert.match(panel, /Payment failed \{day\(view\.dunning\.failedAt\)\}/);
  assert.match(panel, /We will retry on <strong>\{day\(view\.dunning\.nextRetryAt\)\}<\/strong>/);
  assert.deepEqual(dunningView("suspended", null, "2026-10-21T00:00:00.000Z"), { state: "read_only", since: "2026-10-21T00:00:00.000Z" });
  assert.equal(dunningView("active", null, null), null);
  // The retry window starts at the first failure since the last payment that went through.
  assert.match(read("lib/billing/selfService.ts"), /if \(e\.event_type === "payment\.succeeded"\) break;/);
});

test("cancelling offers a pause once, states the retention window and date, and offers the export", () => {
  const fresh = selfServeActions("active", null);
  assert.equal(fresh.offerPauseFirst, true);
  assert.equal(selfServeActions("active", "2026-10-01T00:00:00Z").offerPauseFirst, false, "offered once");
  assert.equal(selfServeActions("past_due", null).offerPauseFirst, false, "only where a pause is possible");
  assert.deepEqual(selfServeActions("paused", null), { canChangePlan: false, canPause: false, canResume: true, canCancel: true, offerPauseFirst: false });
  assert.deepEqual(selfServeActions("cancelled", null), { canChangePlan: false, canPause: false, canResume: false, canCancel: false, offerPauseFirst: false });
  // The server refuses a cancel that has not been offered the pause; the screen shows the offer.
  const lib = read("lib/billing/selfService.ts");
  // Recorded by the server when it shows the offer — a client cannot skip it by claiming it declined.
  assert.match(lib, /if \(actions\.offerPauseFirst\) \{\n\s+await markPauseOffered\(sub\.id\);\n\s+throw new BillingActionError\("[^"]+", 409, "offer_pause"\);/);
  // Whop cannot switch a membership's plan, and the settlement stops the old one renewing: a card-billed
  // agency's plan change goes through support, so an upgrade never ends in read-only at renewal.
  assert.match(lib, /if \(sub\.whop_membership_id\) throw new BillingActionError\("[^"]+", 409, "plan_change_by_support"\);/);
  assert.match(lib, /!sub\.whop_membership_id && \(sub\.status === "trialing"/);
  assert.match(lib, /update\(\{ pause_offered_at: new Date\(\)\.toISOString\(\) \}\)\.eq\("id", subscriptionId\)\.is\("pause_offered_at", null\)/);
  assert.match(MIGRATION, /alter table public\.subscriptions add column if not exists pause_offered_at timestamptz;/);
  // The retention window: 90 days by default, one setting, read by SQL and the screen.
  assert.equal(SETTING_DEFS.find((d) => d.key === "billing.cancelled_retention_days")?.default, 90);
  assert.match(MIGRATION, /where s\.key = 'billing\.cancelled_retention_days'[\s\S]{0,80}\n\s+90\);/);
  assert.equal(retentionEndsAt("2026-10-31T00:00:00.000Z", 90), "2027-01-29T00:00:00.000Z");
  const panel = read("components/app/settings/billing-settings.tsx");
  assert.match(panel, /can be read and exported until <strong>\{sub\.periodEnd \? day\(retentionEndsAt\(sub\.periodEnd, view\.retention\.days\)\)/);
  assert.match(panel, /href="\/api\/app\/billing\/export\?part=policies"/);
  assert.match(panel, /href="\/api\/app\/billing\/export\?part=commissions"/);
  // Cancelling is at the period end, never immediate, from this screen.
  assert.match(lib, /admin_cancel_subscription", \{ p_subscription_id: sub\.id, p_reason: reason, p_immediate: false \}/);
});

test("a downgrade names the features lost, counted from the agency's own records", () => {
  const lib = read("lib/billing/selfService.ts");
  assert.match(lib, /const lost = \(entitlement\.features \?\? \[\]\)\.filter\(\(key\) => !next\.has\(key\)\);/);
  // Every count is the agency's own: a tenant filter on each.
  assert.match(lib, /\.select\("id", \{ count: "exact", head: true \}\)\.eq\("tenant_id", tenantId\)/);
  for (const key of ["book_of_business", "statement_ingestion", "commission_ledger", "winback", "payment_repair", "applications"]) {
    assert.match(lib, new RegExp(`\\n  ${key}: \\{ table: "`), `${key} is counted`);
  }
  // And the limits it would be over.
  assert.match(lib, /return newLimit !== null && used !== undefined && used > newLimit \? \[\{ key, label, used, newLimit \}\] : \[\];/);
  assert.match(read("components/app/settings/billing-settings.tsx"), /you would no longer reach <strong>\{f\.records\}<\/strong>/);
});

test("no pricing, proration or entitlement logic in LA-8.5 — it calls SA-2/SA-3", () => {
  const files = [
    "lib/billing/selfService.ts", "lib/billing/selfServiceRules.ts", "lib/billing/bookExport.ts",
    "components/app/settings/billing-settings.tsx", "app/app/billing/invoices/[id]/page.tsx",
    ...walk("app/api/app/billing").filter((f) => f.endsWith(".ts")),
  ];
  const forbidden = [
    /\bprorate\(/, /periodLengthInDays|daysElapsedBetween/, /priceForCycle|price_(monthly|quarterly|yearly)_cents/, /plan_prices/,
    /refresh_tenant_entitlement|entitlement_access_for_status|accessLevelForStatus/, /tenant_entitlements/, /pending_charges/,
    /\w*[Cc]ents\s*[-+*/]\s*\w|\w\s*[-+*/]\s*\w*[Cc]ents\b/,
  ];
  for (const file of files) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} matches ${pattern}`);
  }
  // Every change goes through the SA-2 functions the admin console uses, then the same rebuild.
  const lib = read("lib/billing/selfService.ts");
  for (const fn of ["admin_change_subscription_plan", "admin_set_subscription_pause_state", "admin_cancel_subscription"]) assert.ok(lib.includes(`rpc("${fn}"`), fn);
  assert.match(lib, /await settleMidPeriodPlanChange\(\{ subscriptionId: sub\.id, fromPlanId: sub\.plan_id, toPlanId, createdBy: actorId \}\)/);
  assert.match(lib, /previewPlanChange\(\{ subscriptionId: sub\.id, fromPlanId: sub\.plan_id, toPlanId/);
});

test("Plan & billing is the owner's, and works while the account is read-only", () => {
  for (const file of ["app/api/app/billing/route.ts", "app/api/app/billing/payment-method/route.ts", "app/api/app/billing/export/route.ts"]) {
    const { out } = handlers(file);
    for (const h of out) {
      assert.match(h.body, /requireTenant\(\["owner"\]\)/, `${file} ${h.method}`);
      assert.doesNotMatch(h.body, /requireWriteAccess|write: true/, `${file} ${h.method}: a paused agency must be able to resume`);
    }
  }
  assert.match(read("app/api/app/billing/route.ts"), /if \(!idempotency\.key\) return NextResponse\.json\(\{ error: "Idempotency-Key is required" \}, \{ status: 400 \}\);/);
  assert.match(read("app/app/billing/invoices/[id]/page.tsx"), /\.eq\("tenant_id", context\.tenantId\)/);
  assert.match(read("app/app/billing/invoices/[id]/page.tsx"), /if \(!invoice \|\| invoice\.status === "draft"\) notFound\(\);/);
  assert.match(read("components/app/agent-settings-tabs.tsx"), /const READ_ONLY_EXEMPT = new Set\(\["billing"\]\);/);
  assert.match(read("components/app/settings/panels.tsx"), /billing: \(\) => <BillingSettings \/>,/);
  assert.ok(!existsSync(join(root, "components/app/settings/managed-settings.tsx")), "the managed-elsewhere stub is gone");
  // Card details never pass through us: the card is updated on the provider's own page.
  assert.match(read("lib/payments/whop/provider.ts"), /async membershipManageUrl\(membershipId: string\)/);
});

/* ── a paused or cancelled agency reads, and does not do ────────────────── */

// Read-only is `access: "read_only"`, refused by `write: true` (requireFeature) or requireWriteAccess.
// Cancelled is read-only now, the same as paused (owner decision 2026-10-15).
test("cancelled is read-only like paused, in the database and the application", () => {
  assert.match(MIGRATION, /when 'cancelled'  then 'read_only'/);
  // The restated engine keeps LA-4.10's in-place plan_name line; the first apply lost it, 330100 restores it.
  assert.match(MIGRATION, /'plan_code', v_plan\.code,\n\s+'plan_name', v_plan\.name,/);
  assert.match(read("supabase/migrations/20261015330100_la_8_5_restore_plan_name.sql"), /execute replace\(v_def, v_anchor, v_anchor \|\| E'\\n      ''plan_name'', v_plan\.name,'\);/);
  assert.match(read("lib/subscriptions/access.ts"), /case "paused":\n[\s\S]{0,300}case "cancelled":\n\s+return "read_only";/);
  assert.match(read("lib/entitlements/types.ts"), /return entitlement\.access === "full";/);
});

const CANNOT = {
  dial: ["app/api/app/dial", "app/api/app/dialer"],
  "submit applications": ["app/api/app/applications", "app/api/app/outbound/application"],
  "process statements": ["app/api/app/statements", "app/api/app/carrier-files"],
  "import leads": ["app/api/app/leads/import"],
};
// Writes that are reads in disguise: an audited reveal shows data the agency already holds, and a
// statement preview parses a file without saving anything.
const READS_BY_POST = new Set([
  "app/api/app/applications/attempts/[id]/reveal/route.ts",
  "app/api/app/outbound/application/reveal/route.ts",
  "app/api/app/statements/preview/route.ts",
]);

for (const [what, dirs] of Object.entries(CANNOT)) {
  for (const file of dirs.flatMap((d) => walk(d)).filter((f) => f.endsWith("route.ts")).sort()) {
    const { out, source } = handlers(file);
    for (const h of out.filter((x) => x.method !== "GET")) {
      if (READS_BY_POST.has(file)) continue;
      test(`a paused or cancelled agency cannot ${what}: ${h.method} ${file.replace("app/api/app", "")}`, () => {
        // The context helper may take more arguments after `write` (lead import's product, 2026-10-28).
        const viaHelper = /context\(true[,)]/.test(h.body) && /async function context\(write = false[,)][\s\S]*\{ write(?:, prefetchScope: true)? \}/.test(source);
        const viaShared = /await context\((?:\{[^)]*\})?\)/.test(h.body) && /async function context\([^)]*\)[\s\S]{0,200}write: true/.test(source);
        assert.ok(/write: true|requireWriteAccess\(/.test(h.body) || viaHelper || viaShared, "the handler does not refuse a read-only account");
      });
    }
  }
}

const CAN_READ = {
  "its book": ["app/api/app/policies/route.ts", "app/api/app/policies/issued/route.ts"],
  "its statements": ["app/api/app/statements/route.ts", "app/api/app/statements/[id]/route.ts"],
  "its commission history": ["app/api/app/ledger/route.ts"],
  "its billing and exports": ["app/api/app/billing/route.ts", "app/api/app/billing/export/route.ts"],
};
for (const [what, files] of Object.entries(CAN_READ)) {
  for (const file of files) {
    test(`a paused or cancelled agency can still read ${what}: GET ${file.replace("app/api/app", "")}`, () => {
      const get = handlers(file).out.find((h) => h.method === "GET");
      assert.ok(get, "no GET");
      assert.doesNotMatch(get.body, /write: true|requireWriteAccess\(/, "the read refuses a read-only account");
    });
  }
}
