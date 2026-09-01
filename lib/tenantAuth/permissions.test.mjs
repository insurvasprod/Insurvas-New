import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentMenu } from "../menu/definition.ts";
import { hasTenantPermission, roleCanViewCommission, rolePermissions } from "./permissions.ts";

const keys = (role) => rolePermissions(role);
const menuKeys = (role) => buildAgentMenu([
  "book_of_business", "statement_ingestion", "commission_ledger", "appointment_vault", "discrepancy_report",
  "inbound_transfers", "outbound_dialing", "lead_import", "duplicate_detection", "quoting", "applications",
  "draft_date_optimizer", "callback_calendar", "daily_deal_flow", "chargeback_radar", "payment_repair", "winback",
  "true_cpa", "cohort_persistency", "publisher_records", "payout_runs", "partner_portal", "profit_and_loss",
  "tax_summaries", "tcpa_checker", "consent_locker", "litigation_packet",
], role).flatMap((section) => section.items.map((item) => item.key));

test("assistant has no money capability and no money menu", () => {
  assert.equal(hasTenantPermission("assistant", "money.view"), false);
  assert.equal(hasTenantPermission("assistant", "commission.view.all"), false);
  assert.ok(!menuKeys("assistant").includes("book.ledger"));
  assert.ok(!menuKeys("assistant").includes("accounting.pnl"));
});

test("bookkeeper sees money but cannot dial or listen to recordings", () => {
  assert.equal(hasTenantPermission("bookkeeper", "money.view"), true);
  assert.equal(hasTenantPermission("bookkeeper", "dialer.use"), false);
  assert.equal(hasTenantPermission("bookkeeper", "recordings.listen"), false);
  assert.ok(!menuKeys("bookkeeper").includes("leads.dialer"));
});

test("producer commission access is own-producer scoped", () => {
  assert.equal(roleCanViewCommission("producer", "producer-a", "producer-a"), true);
  assert.equal(roleCanViewCommission("producer", "producer-a", "producer-b"), false);
  assert.equal(roleCanViewCommission("bookkeeper", "bookkeeper-a", "producer-b"), true);
});

test("owner retains the full menu and permission set", () => {
  assert.ok(keys("owner").includes("team.manage"));
  assert.ok(menuKeys("owner").includes("settings.root"));
  assert.ok(menuKeys("owner").includes("leads.dialer"));
});
