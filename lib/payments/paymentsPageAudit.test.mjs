// SA-4.2 audit (2026-10-15): key storage is not built (decision), so the payment setup page must say
// how keys and mode ARE changed, and both viewing and testing it leave an audit row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the page records each view, with the mode and never a credential", () => {
  const page = read("../../app/admin/(protected)/payments/page.tsx");
  assert.match(page, /action: "payment_provider\.config_viewed"/);
  assert.match(page, /metadata: \{ mode: deriveMode\(process\.env\.WHOP_API_BASE_URL\) \}/);
  assert.doesNotMatch(page, /WHOP_API_KEY|WHOP_WEBHOOK_SECRET/, "no secret is read on the page");
  const actions = read("../audit/actions.ts");
  assert.match(actions, /"payment_provider\.config_viewed": "Payment setup viewed"/);
});

test("a connection test is still audited", () => {
  const route = read("../../app/api/admin/payments/test-connection/route.ts");
  assert.match(route, /action: "payment_provider\.connection_tested"/);
});

test("the panel says changes need the environment and a redeploy", () => {
  const panel = read("../../components/admin/payment-status-panel.tsx");
  assert.match(panel, /change these environment variables in the hosting project and redeploy/);
});
