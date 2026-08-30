// Run with: npm test
//
// Nothing downstream enforces any of this — Whop refunds whatever an authenticated key asks for —
// so these rules are the only thing standing between a compromised account and the bank balance.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  needsSecondApprover,
  requestRefusalReason,
  approvalRefusalReason,
  creditBalanceDelta,
  creditToFreeDays,
  REFUND_APPROVAL_THRESHOLD_CENTS,
} from "./rules.ts";

const ALICE = "admin-alice";
const BOB = "admin-bob";

test("the ticket's $600 refund needs a second approver", () => {
  assert.equal(needsSecondApprover("refund", 60_000), true);
});

test("a refund at exactly the threshold does NOT need one", () => {
  // $500 is "up to", not "above". An off-by-one here either blocks routine work or lets the
  // threshold be stepped over by a cent.
  assert.equal(needsSecondApprover("refund", REFUND_APPROVAL_THRESHOLD_CENTS), false);
  assert.equal(needsSecondApprover("refund", REFUND_APPROVAL_THRESHOLD_CENTS + 1), true);
});

test("credits and waivers are never gated on amount", () => {
  // They cost revenue but cannot move money out of the bank, which is what the threshold guards.
  // Gating them would teach people to issue a credit to dodge the approval queue.
  assert.equal(needsSecondApprover("credit", 1_000_000), false);
  assert.equal(needsSecondApprover("waiver", 1_000_000), false);
});

test("a support agent cannot issue refunds or credits at all", () => {
  assert.ok(requestRefusalReason("support_agent", "refund", 1000));
  assert.ok(requestRefusalReason("support_agent", "credit", 1000));
  assert.ok(requestRefusalReason("platform_config", "refund", 1000));
});

test("a billing admin can request a large refund — it just goes to approval", () => {
  // Requesting and approving are different permissions. Blocking the request would mean a billing
  // admin has to ask someone else to type it, which is worse and teaches shared logins.
  assert.equal(requestRefusalReason("billing_admin", "refund", 60_000), null);
  assert.equal(needsSecondApprover("refund", 60_000), true);
});

test("a zero or negative amount is refused", () => {
  assert.ok(requestRefusalReason("billing_admin", "refund", 0));
  assert.ok(requestRefusalReason("billing_admin", "refund", -100));
});

test("waivers are refused with a reason, not silently accepted", () => {
  const reason = requestRefusalReason("billing_admin", "waiver", 1000);

  assert.ok(reason);
  assert.match(reason, /not available yet/i);
});

test("THE rule: the requester can never approve their own request", () => {
  // Even as super_admin. A compromised super_admin account would otherwise approve itself and the
  // entire control would be worth nothing.
  const reason = approvalRefusalReason("super_admin", ALICE, ALICE);

  assert.ok(reason);
  assert.match(reason, /cannot approve/i);
});

test("a different super admin can approve", () => {
  assert.equal(approvalRefusalReason("super_admin", BOB, ALICE), null);
});

test("a billing admin cannot approve an above-threshold refund", () => {
  const reason = approvalRefusalReason("billing_admin", BOB, ALICE);

  assert.ok(reason);
  assert.match(reason, /super admin/i);
});

test("self-approval is refused BEFORE the role check", () => {
  // Order matters for the message: a super_admin approving their own request should be told the
  // real reason, not "you need to be a super admin" — which they are.
  const reason = approvalRefusalReason("super_admin", ALICE, ALICE);

  assert.match(reason, /you raised this/i);
});

test("only a credit adds to the balance", () => {
  // A refund returns money to the card. Crediting the balance as well would hand the customer the
  // same money twice.
  assert.equal(creditBalanceDelta("credit", 12_450), 12_450);
  assert.equal(creditBalanceDelta("refund", 12_450), 0);
  assert.equal(creditBalanceDelta("waiver", 12_450), 0);
});

test("a credit converts to free days, floored", () => {
  // $124.50 credit on a $249 / 31-day plan is 15.5 days of value.
  assert.equal(creditToFreeDays(12_450, 24_900, 31), 15);
});

test("free days round DOWN, never up", () => {
  // Giving 15 days for 15.5 days of value leaves a little owed, which is recoverable. Rounding up
  // gives away money that is not.
  const days = creditToFreeDays(12_450, 24_900, 31);
  const valueGiven = days * (24_900 / 31);

  assert.ok(valueGiven <= 12_450, `gave ${valueGiven} cents of value for a ${12_450} cent credit`);
});

test("a credit smaller than a single day is zero days, not one", () => {
  assert.equal(creditToFreeDays(100, 24_900, 31), 0);
});

test("a nonsensical plan cannot produce free days", () => {
  assert.equal(creditToFreeDays(10_000, 0, 31), 0);
  assert.equal(creditToFreeDays(10_000, 24_900, 0), 0);
});
