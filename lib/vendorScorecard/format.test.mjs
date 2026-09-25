import assert from "node:assert/strict";
import test from "node:test";

const { csvCell, scorecardCsv } = await import("./format.ts");
const { vendorReturnCsv } = await import("./returnFormat.ts");

test("scorecard CSV quotes cells and neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"https://evil.test\")"), "\"'=HYPERLINK(\"\"https://evil.test\"\")\"");
  const csv = scorecardCsv([{
    campaign_id: "campaign-1", vendor_id: "vendor-1", vendor_name: "=Vendor", campaign_name: "Campaign, A", product_code: "term_life",
    total_spend_cents: 10000, records_purchased: 100, credits_received_cents: 1000, net_spend_cents: 9000,
    leads_received: 10, attempts: 20, contacted_leads: 5, applications: 2, issued_policies: 1, attribution_warnings: 0,
    effective_cost_per_lead_cents: 900, effective_cost_per_application_cents: 4500, effective_cost_per_issued_policy_cents: 9000, contact_rate_percent: 50,
  }]);
  assert.match(csv, /"'=Vendor"/);
  assert.match(csv, /"Campaign, A"/);
  assert.match(csv, /"90"/);
});

test("vendor return evidence export includes a summary and safe evidence rows", () => {
  const csv = vendorReturnCsv({
    claim: { id: "claim-1", tenant_id: "tenant-1", campaign_id: "campaign-1", vendor_id: "vendor-1", reason: "wrong_number", lead_count: 1, amount_claimed_cents: 350, status: "draft", submitted_at: null, resolved_at: null, amount_credited_cents: 0, replacement_leads_count: 0, rejection_reason: null, notes: null, created_at: "2026-09-13T00:00:00Z" },
    items: [{ id: "item-1", lead_id: "lead-1", reason: "wrong_number", evidence: { source: "disposition", phone: "5551234567", state: "AZ", disposition: "wrong_number", attempted_at: "2026-09-12T00:00:00Z" }, created_at: "2026-09-13T00:00:00Z" }],
  });
  assert.match(csv, /"claim_id","claim-1"/);
  assert.match(csv, /"evidence"/);
  assert.match(csv, /"5551234567"/);
});
