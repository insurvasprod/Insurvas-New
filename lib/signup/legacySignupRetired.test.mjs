import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// Audit 2026-10-15: every sign-up door goes through /signup (verification, legal acceptance,
// disposable-address check, Whop checkout). The legacy /api/app/signup skipped all of it.

test("/api/app/signup is retired: 410 pointing to /signup, and it creates nothing", () => {
  const route = read("app/api/app/signup/route.ts");
  assert.match(route, /status: 410/);
  assert.match(route, /redirectTo: "\/signup"/);
  assert.doesNotMatch(route, /\.rpc\(|issueTenantSession|hashPassword/, "no account, no session");
});

test("the agent sign-in links to /signup and has no sign-up form of its own", () => {
  const login = read("components/app/tenant-auth-workspace.tsx");
  // The link no longer names a trial length: it depends on the plan chosen later (signup-flow, 2026-10-27).
  assert.match(login, /<Link href="\/signup"[^>]*>\s*Create an account\s*<\/Link>/);
  assert.doesNotMatch(login, /\/api\/app\/signup/);
  assert.doesNotMatch(read("app/app/signup/page.tsx"), /TenantAuthWorkspace/);
  assert.match(read("app/app/signup/page.tsx"), /redirect\("\/signup"\)/);
});

test("no sign-in copy promises a trial without a card: Whop takes one", () => {
  const login = read("components/app/tenant-auth-workspace.tsx");
  // The sign-up panel says what Payment will ask for, from the payment mode that is on: "No card
  // needed" only when CHECKOUT_PAYMENT_MODE=none, otherwise the card on Whop's checkout.
  assert.match(login, /noPayment \? "No card needed" : "Card on Whop's secure checkout/);
  assert.equal((login.match(/no card/gi) ?? []).length, 1, "the only 'no card' is the no-payment branch");
});

test("the legacy function is dropped by migration, and nothing calls it", () => {
  const migration = read("supabase/migrations/20261015580000_onboarding_audit_fixes.sql");
  assert.match(migration, /^drop function if exists public\.self_serve_signup_with_subscription\(text, text, text, text, uuid, public\.billing_cycle\);$/m);
  assert.doesNotMatch(read("app/api/app/signup/route.ts"), /self_serve_signup_with_subscription"/);
});

test("the business profile can be corrected while checkout is pending", () => {
  const route = read("app/api/app/onboarding/business-profile/route.ts");
  assert.match(route, /\["business_profile", "ready_for_checkout", "awaiting_payment"\]\.includes\(context\.onboardingState\)/);
  const migration = read("supabase/migrations/20261015580000_onboarding_audit_fixes.sql");
  assert.match(migration, /v_state not in \('business_profile', 'ready_for_checkout', 'awaiting_payment'\)/);
  assert.match(migration, /case when v_state = 'awaiting_payment' then 'awaiting_payment' else 'ready_for_checkout' end/, "an open checkout stays open");
  assert.match(read("app/app/onboarding/business-profile/page.tsx"), /new Set\(\["business_profile", "ready_for_checkout", "awaiting_payment"\]\)/);
});
