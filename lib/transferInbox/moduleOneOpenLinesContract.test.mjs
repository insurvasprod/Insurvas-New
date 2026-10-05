/**
 * Module 1 lines that were open in the 2026-09-29 readiness list and are met in code without a new
 * migration. Source-level contracts, so a later edit that undoes one fails here first.
 *
 *   LA-1.11-7  completed verification sections fold
 *   LA-1.14-6  the five transfer states, read from what the database stores
 *   LA-1.14-7  a buffer claim posts a "connected" card, not "transferred"
 *   LA-1.20-4  the lead page claims, hands off, dispositions, and only an owner moves a stage directly
 *   LA-1.20-5  deal flow links every row to the lead workspace
 *   LA-1.20-6  the lead page renders any product's form, with no product-specific branch
 *   LA-1.25-6  do not disturb is visible in the top bar, and never mutes the escalation email
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const panel = await read("components/app/verification-panel.tsx");
const constants = await read("lib/transferInbox/constants.ts");
const service = await read("lib/transferInbox/service.ts");
const leadPage = await read("components/app/lead-detail-workspace.tsx");
const leadService = await read("lib/leadWorkspace/service.ts");
const dealFlow = await read("components/app/deal-flow-workspace.tsx");
const topBar = await read("components/app/app-top-bar.tsx");
const alertFeed = await read("lib/agentAlerts/useAgentAlertFeed.ts");

test("LA-1.11-7: a section whose required fields are all answered folds, and can be opened again", () => {
  assert.match(panel, /function sectionComplete\(fields: Array<\{ is_required: boolean; state: VerificationState \}>\) \{\n  if \(fields\.length === 0\) return false;/);
  assert.match(panel, /return counted\.every\(\(field\) => field\.state !== "outstanding"\);/);
  assert.match(panel, /const folded = complete && !reopened\[section\.section_key\];/);
  assert.match(panel, /hidden=\{folded\}/);
});

test("LA-1.14-6: the five states are read from the stored status, both licensed-agent words as one", () => {
  assert.match(constants, /export const TRANSFER_PHASES = \["unclaimed", "buffer_active", "handed_pending", "la_active", "closed"\] as const;/);
  assert.match(constants, /if \(status === "claimed" \|\| status === "la_active"\) return "la_active";/);
  assert.match(service, /phase: transferPhase\(row\.status\),/, "the inbox rows carry the phase");
  assert.match(leadService, /phase: transferPhase\(queue\.status\),/, "the lead page carries it too");
});

test("LA-1.14-7: every claim card is a 'connected' card, a buffer claim included", () => {
  assert.match(service, /cardType: "connected", message: options\.message \?\? `\$\{customer\} is connected to the agent`/);
  assert.match(service, /message: `\$\{customer\} is connected to the buffer agent`/);
});

test("LA-1.20-4: claim, hand off and disposition are on the lead page, and a direct stage move is the owner's only", () => {
  for (const endpoint of ["/api/app/inbound/claim", "/api/app/inbound/handoff"]) assert.ok(leadPage.includes(endpoint), `the lead page never calls ${endpoint}`);
  assert.match(leadPage, /<DispositionWizardDialog workItemId=\{data\.queue\.id\}/);
  assert.match(leadService, /canChangeStage: isOwnerRole,/);
  assert.match(leadPage, /data\.stage && data\.actions\.canChangeStage &&/);
});

test("LA-1.20-5: every deal-flow row, and the selected one, opens the lead workspace", () => {
  assert.match(dealFlow, /<Link href=\{`\/app\/leads\/\$\{row\.lead_id\}`\} onClick=\{\(event\) => event\.stopPropagation\(\)\}>Open lead<\/Link>/);
  assert.match(dealFlow, /<Link href=\{`\/app\/leads\/\$\{selectedRow\.lead_id\}`\}>Open lead<\/Link>/);
});

test("LA-1.20-6: the lead page draws the form from the stored definition and never branches on the product", () => {
  // The same rule scripts/verify-lead-workspace.mjs applies live.
  assert.doesNotMatch(leadPage, /(?:if|\?|&&|switch)[^\n]{0,80}(?:product_line|product_code)\s*(?:===|==|!==|!=|\.includes|case )/);
  assert.match(leadPage, /form_definition: \{ sections: Array</);
});

test("LA-1.25-6: do not disturb shows in the top bar; it mutes sound and browser alerts, not the email", () => {
  assert.match(topBar, /doNotDisturb: source\.settings\?\.do_not_disturb === true,/);
  assert.match(topBar, /\{feed\?\.doNotDisturb && <span className="[^"]*text-\[12px\][^"]*" title="Sound and browser alerts are muted\. Escalation emails are still sent\.">Do not disturb<\/span>\}/);
  assert.match(topBar, /feed\.doNotDisturb \? <BellOff /);
  assert.match(topBar, /\$\{feed\.doNotDisturb \? ", do not disturb is on" : ""\}/, "screen readers hear it on the bell too");
  assert.match(alertFeed, /if \(response\.settings\.do_not_disturb \|\| typeof Notification === "undefined"\) return;/, "DND skips the browser notification");
});
