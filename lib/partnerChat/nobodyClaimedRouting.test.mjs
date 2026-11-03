/**
 * LA-1.16-4: new_lead … call_outcome go to the partner's channel; nobody_claimed goes to Ray only.
 * The card type decides the destination inside the one writer, so every caller (the SLA ladder, and
 * anything added later) lands on the agency side without changing its call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const service = readFileSync(join(process.cwd(), "lib", "partnerChat", "service.ts"), "utf8");
const writer = service.slice(service.indexOf("export async function postPartnerSystemCard"), service.indexOf("export async function postChannelText"));
const ownerAlert = service.slice(service.indexOf("async function alertOwnersNobodyClaimed"), service.indexOf("export async function postPartnerSystemCard"));

test("the writer routes nobody_claimed away before it looks up the partner channel", () => {
  const route = writer.indexOf('if (input.cardType === "nobody_claimed") return alertOwnersNobodyClaimed(supabase, input);');
  assert.ok(route > 0, "nobody_claimed is routed by card type");
  assert.ok(route < writer.indexOf("channelFor("), "…before the partner channel is resolved");
  assert.match(writer, /export async function postPartnerSystemCard\(input: CardInput\)/, "call signature unchanged");
});

test("the agency-side record is an owner-only alert, never a partner message or partner alert", () => {
  assert.match(ownerAlert, /roles: \["owner"\]/);
  assert.match(ownerAlert, /kind: NOBODY_CLAIMED_ALERT_KIND/);
  assert.doesNotMatch(ownerAlert, /partner_messages/);
  assert.doesNotMatch(ownerAlert, /notifyPartnerUsers/);
  assert.match(service, /export const NOBODY_CLAIMED_ALERT_KIND = "unclaimed_sla_escalation";/);
});

test("the owner alert is idempotent per work item", () => {
  assert.match(service, /`unclaimed-sla:\$\{input\.workItemId\}:nobody-claimed`/);
  assert.match(ownerAlert, /sourceKey: nobodyClaimedSourceKey\(input\)/);
});

test("a partner channel no longer shows nobody_claimed cards stored before the routing", () => {
  assert.match(service, /channel\.channel_type === "partner" \? stored\.filter\(\(row\) => row\.card_type !== "nobody_claimed"\) : stored/);
});
