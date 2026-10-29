import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { checkComparisonPeriods, matchPeriodTo, periodDays, comparisonErrorText } = await import("./comparePeriods.ts");
const { calendarDaysLeft, closesLabel, zonedDay } = await import("./returnModel.ts");
const { vendorReturnCsv } = await import("./returnFormat.ts");
const { normalizeScorecard } = await import("./normalize.ts");
const { scorecardCsv } = await import("./format.ts");

const read = (path) => readFileSync(path, "utf8");

test("LA-2.18-2: unmatched periods are refused in words, with the matched period offered", () => {
  const a = { from: "2026-09-07", to: "2026-09-13" }; // Mon to Sun, 7 days
  const longer = checkComparisonPeriods(a, { from: "2026-09-01", to: "2026-09-20" }, "2026-09-29");
  assert.equal(longer.ok, false);
  assert.equal(longer.problem, "length");
  assert.match(longer.message, /7 days and period B is 20 days/);
  assert.doesNotMatch(longer.message, /campaign_comparison_/);
  assert.deepEqual(longer.suggestion, { from: "2026-08-31", to: "2026-09-06" }, "B starts on A's weekday, on or before the day asked for");
  assert.equal(periodDays(longer.suggestion), 7);

  const weekday = checkComparisonPeriods(a, { from: "2026-09-17", to: "2026-09-23" }, "2026-09-29");
  assert.equal(weekday.problem, "weekday");
  assert.match(weekday.message, /Monday and period B on a Thursday/);
  assert.deepEqual(weekday.suggestion, { from: "2026-09-14", to: "2026-09-20" });

  // A matched period never ends after today: it moves back a week at a time.
  assert.deepEqual(matchPeriodTo(a, { from: "2026-09-24", to: "2026-09-30" }, "2026-09-25"), { from: "2026-09-14", to: "2026-09-20" });
  assert.equal(checkComparisonPeriods(a, { from: "2026-09-14", to: "2026-09-20" }, "2026-09-29").ok, true);
  assert.equal(checkComparisonPeriods({ from: "2026-09-10", to: "2026-09-01" }, a, "2026-09-29").problem, "order");
  assert.match(comparisonErrorText("Could not compare: campaign_comparison_weekdays_must_align"), /same weekday/);
  assert.equal(comparisonErrorText("something else"), null);
});

test("LA-2.18-2: the service checks first and the route answers with the suggestion", () => {
  const service = read("lib/vendorScorecard/service.ts");
  assert.match(service, /checkComparisonPeriods\(/);
  assert.match(service, /throw new ComparisonPeriodError/);
  assert.match(read("app/api/app/true-cpa/compare/route.ts"), /suggestion: error\.suggestion/);
  assert.match(read("components/app/campaign-comparison-workspace.tsx"), /takeMatched/);
});

test("LA-2.19-2: days left are calendar days in the tenant's zone", () => {
  // Oakridge: closes 26 Sep 15:21 UTC, 23 hours away. One day left, not "closes today".
  const now = new Date("2026-09-25T16:00:00Z");
  assert.equal(calendarDaysLeft("2026-09-26T15:21:00Z", "UTC", now), 1);
  assert.equal(closesLabel(calendarDaysLeft("2026-09-26T15:21:00Z", "UTC", now)), "Closes tomorrow");
  assert.equal(calendarDaysLeft("2026-09-25T23:30:00Z", "UTC", now), 0);
  assert.equal(closesLabel(0), "Closes today");
  assert.equal(closesLabel(5), "5 days left");
  assert.equal(closesLabel(null), "Window closed");
  // The zone decides the date: 03:00 UTC on the 26th is still the 25th in New York.
  assert.equal(calendarDaysLeft("2026-09-26T03:00:00Z", "America/New_York", now), 0);
  assert.equal(calendarDaysLeft("2026-09-26T03:00:00Z", "UTC", now), 1);
  assert.equal(zonedDay("2026-09-26T03:00:00Z", "Not/AZone"), "2026-09-26", "an unknown zone reads as UTC");
  assert.equal(calendarDaysLeft("2026-09-20T00:00:00Z", "UTC", now), 0, "never negative");
  const sql = read("supabase/migrations/20260925709810_return_window_counts_calendar_days.sql");
  for (const name of ["vendor_claimable_leads", "vendor_return_candidates", "vendor_returns_candidates_summary"]) assert.match(sql, new RegExp(`array\\['${name}'`));
  assert.match(sql, /\(select public\.tenant_calendar_zone\(p_tenant_id\)\)\)::date/);
  assert.match(read("lib/vendorScorecard/returnsService.ts"), /calendarDaysLeft\(/);
});

test("LA-2.19-4: the evidence summary names the campaign and vendor, the unit price and the period", () => {
  const claim = { id: "c1", tenant_id: "t", campaign_id: "camp", vendor_id: "ven", reason: "wrong_number", lead_count: 3, amount_claimed_cents: 144, status: "draft", submitted_at: null, resolved_at: null, amount_credited_cents: 0, replacement_leads_count: 0, rejection_reason: null, notes: null, created_at: "2026-09-20T00:00:00Z" };
  const csv = vendorReturnCsv({ claim, items: [] }, { campaignName: "Oakridge Final Expense", vendorName: "Oakridge Leads", unitPriceCents: 47.765, periodFrom: "2026-09-01T10:00:00Z", periodTo: "2026-09-14T18:00:00Z", returnWindowDays: 30 });
  const lines = csv.split("\r\n");
  assert.ok(lines.includes('"campaign","Oakridge Final Expense"'));
  assert.ok(lines.includes('"vendor","Oakridge Leads"'));
  assert.ok(lines.includes('"unit_price","0.4777"'));
  assert.ok(lines.includes('"period","2026-09-01 to 2026-09-14"'));
  assert.ok(lines.includes('"return_window_days","30"'));
  assert.ok(lines.includes('"campaign_id","camp"'), "the ids stay for matching back");
  // Without a context the claim's own price per row is the fallback, never a blank amount.
  assert.ok(vendorReturnCsv({ claim, items: [] }).split("\r\n").includes('"unit_price","0.48"'));
  assert.match(read("app/api/app/vendor-returns/claims/[id]/route.ts"), /vendorReturnEvidenceContext/);
});

const baseRow = { campaign_id: "c", vendor_id: "v", vendor_name: "V", campaign_name: "C", total_spend_cents: 10000, records_purchased: 100, credits_received_cents: 0, net_spend_cents: 5000, leads_received: 50, attempts: 80, contacted_leads: 10, applications: 2, issued_policies: 1 };

test("LA-2.17-2/-3: the funnel's dialled and quoted leads and cost per contact, a dash with none", () => {
  const funnel = normalizeScorecard({ from: "2026-01-01", to: "2026-09-29", generated_at: "x", funnel_version: 2, returns_included: true, rows: [{ ...baseRow, dialed_leads: 30, quoted_leads: 3, applied_leads: 2, effective_cost_per_contact_cents: 500, undialable_leads: 5, claim_count: 1, amount_claimed_cents: 100, amount_credited_cents: 50 }], vendor_rows: [], totals: { leads_received: 50, contacted_leads: 10, dialed_leads: 30, quoted_leads: 3, net_spend_cents: 5000, effective_cost_per_contact_cents: 500 } }, new Map(), false, true);
  assert.equal(funnel.funnel, true);
  assert.equal(funnel.rows[0].dialed_leads, 30);
  assert.equal(funnel.rows[0].quoted_leads, 3);
  assert.equal(funnel.rows[0].effective_cost_per_contact_cents, 500);
  assert.equal(funnel.rows[0].dialable_leads, 45, "the report's own undialable figure is used, not the second RPC's");
  assert.equal(funnel.rows[0].claim_acceptance_rate_percent, null, "a rate the SQL did not send is not invented");
  assert.equal(funnel.totals.dialed_leads, 30);

  // Before 20260925709800: dialled and quoted are unknown (null, never 0), cost per contact is derived.
  const old = normalizeScorecard({ from: "a", to: "b", generated_at: "x", rows: [{ ...baseRow }, { ...baseRow, campaign_id: "d", contacted_leads: 0 }], vendor_rows: [], totals: { leads_received: 100, contacted_leads: 10, net_spend_cents: 10000 } }, new Map(), false, true);
  assert.equal(old.funnel, false);
  assert.equal(old.rows[0].dialed_leads, null);
  assert.equal(old.rows[0].quoted_leads, null);
  assert.equal(old.rows[0].effective_cost_per_contact_cents, 500);
  assert.equal(old.rows[1].effective_cost_per_contact_cents, null, "no contacts is a dash, never $0");
  assert.equal(old.totals.effective_cost_per_contact_cents, 1000);

  const csv = scorecardCsv(funnel.rows).split("\r\n");
  assert.match(csv[0], /"cost_rank","dialed_leads","quoted_leads","effective_cost_per_contact","effective_cost_per_application"$/);
  assert.doesNotMatch(csv[0], /talk/);
});

test("LA-2.17-7/-8: one lead-facts definition behind the report, the drill and the campaign list", () => {
  const sql = read("supabase/migrations/20260925709800_scorecard_funnel_drill_and_speed.sql");
  assert.match(sql, /create or replace function public\.tenant_vendor_scorecard_lead_facts/);
  assert.equal((sql.match(/from tenant_vendor_scorecard_lead_facts\(/g) ?? []).length, 3, "report, drill and campaign funnel read the same facts");
  assert.doesNotMatch(sql.split("tenant_vendor_scorecard_lead_facts")[1].split("$function$;")[0], /\(select count\(\*\)::integer from tenant_call_attempts/, "no per-lead correlated subqueries");
  assert.match(sql, /'has_more', \(select count\(\*\) from picked\) > v_offset \+ v_limit/);
  assert.match(sql, /'returns_included', true/);
  for (const stage of ["received", "dialable", "undialable", "dialed", "contacted", "quoted", "applied", "issued"]) assert.match(sql, new RegExp(`'${stage}'`));
  const service = read("lib/vendorScorecard/service.ts");
  assert.match(service, /tenant_vendor_scorecard_drill/);
  assert.match(service, /reportCarriesReturns \? Promise\.resolve\(null\)/, "the second RPC is skipped once the report carries its figures");
  assert.match(read("app/app/(shell)/true-cpa/page.tsx"), /initialReport/, "the page renders the report on the server");
  assert.match(read("app/api/app/campaigns/route.ts"), /tenant_campaign_funnel/);
});

test("LA-2.14-5: the dial outcome completes the outbound deal row and closes the session, retries excepted", () => {
  const sql = read("supabase/migrations/20260925709820_outbound_deal_completes_on_the_dial_outcome.sql");
  assert.match(sql, /if v_new_state <> 'retry' then/);
  assert.match(sql, /call_result = p_disposition/);
  assert.match(sql, /status = 'partial'/);
  assert.match(sql, /update public\.tenant_verification_sessions/);
  assert.match(sql, /replace\(v_src, E'\\r\\n', E'\\n'\)/, "CRLF normalised before the anchor");
  assert.doesNotMatch(sql, /update public\.tenant_application_cases/, "the case is LA-3's to decide");
});

test("LA-2.22-1/-4: limits quote live usage and the 403 names the limit", () => {
  const outbound = read("lib/metering/outbound.ts");
  assert.match(outbound, /checkMeterCapacity\(tenantId, meterKey, 0\)/, "the snapshot reads the live meter");
  assert.match(outbound, /checkMeterCapacity\(tenantId, meterKey, quantity\)/);
  assert.doesNotMatch(outbound, /meter\?\.used \?\? 0;\n\s*if \(limit !== null && usage \+ quantity > limit\)/, "no longer refuses on the cached figure");
  assert.match(outbound, /Your plan has reached its limit of/);
  assert.match(read("components/app/team-settings.tsx"), /setter-seat limit/);
  assert.match(read("app/api/app/campaigns/[id]/route.ts"), /activeCampaignCapResponse/);
});

test("LA-2.20-6 / W3.5: recycled against fresh conversion reaches the page", () => {
  const report = read("lib/nurture/report.ts");
  assert.match(report, /conversion: \{ recycled: ConversionSide; fresh: ConversionSide \} \| null/);
  assert.match(report, /Date\.parse\(cleared\) <= Date\.parse\(text\(policy\.issued_at\)\)/);
  assert.match(read("components/app/nurture-workspace.tsx"), /label="Recycled conversion"/);
});
