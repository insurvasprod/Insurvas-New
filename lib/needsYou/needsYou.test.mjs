// Book of business › Needs you (owner 2026-11-02, round 2): one list of every decision, one item page for every
// kind, each kind decided through the API its own screen already uses.
// Run with: node --experimental-strip-types --test lib/needsYou/needsYou.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { agentItemId, byOldest, daysSince, fromFile, groupCounts, isItemId, isNeedsYouKind, itemHref, KIND_META, NEEDS_YOU_GROUPS, NEEDS_YOU_KINDS, neighbours, parseAgentItemId, QUEUE_KIND, viewItems } from "./kinds.ts";
import { QUEUE_TYPES, RESOLUTIONS } from "../ingestion/exceptionQueues.ts";
import { exceptionsRequest } from "../ingestion/exceptionsRequest.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const STORE = "lib/needsYou/store.ts";
const DECIDE = "components/app/book/needs-you/item-decide.tsx";
const LIST_PAGE = "app/app/(shell)/needs-you/page.tsx";
const ITEM_PAGE = "app/app/(shell)/needs-you/[kind]/[id]/page.tsx";
const CARRIER = "11111111-2222-4333-8444-555555555555";

const item = (kind, id, ageDays, extra = {}) => ({ kind, id, about: id, why: "", who: "", ownerUserId: null, since: `2026-11-${String(10 - Math.min(ageDays, 9)).padStart(2, "0")}`, ageDays, href: itemHref(kind, id), tone: "neutral", ...extra });

test("every kind has its words, a group and a verb; every exception queue is a kind", () => {
  for (const kind of NEEDS_YOU_KINDS) {
    const meta = KIND_META[kind];
    assert.ok(meta.label && meta.verb && meta.source, kind);
    assert.ok(NEEDS_YOU_GROUPS.includes(meta.group), kind);
  }
  for (const type of QUEUE_TYPES) assert.ok(isNeedsYouKind(QUEUE_KIND[type]), type);
  // Two rules disagree: the live holds of the pipeline-rules engine, keeper-only, a pending note before its migration.
  const store = read(STORE);
  assert.match(store, /async function ruleHolds\([^)]*\)[^{]*\{\s*if \(!scope\.keeper\) return EMPTY;\s*const read = await listRuleHolds\(scope\.tenantId/);
  assert.match(store, /if \(!read\.available\) return \{ \.\.\.EMPTY, notes: \[PIPELINE_RULES_PENDING_MESSAGE\] \};/);
  assert.match(store, /guarded\("Two rules disagree", PIPELINE_RULES_PENDING_MESSAGE, \(\) => ruleHolds\(scope, names, today\)\)/);
});

test("Files › Open all in Needs you: the file page's rule — its reviews, its no-sale items by carrier and file date, never Same person? or Sale no carrier has", () => {
  const file = { fileId: "f1", name: "americo.csv", carrierId: "c1", rowItemsDate: "2026-10-30", policies: new Set(["c1|AM-1"]), commissionPolicies: new Set(["c1|AM-9"]), codes: new Set(["c1|44810"]), words: new Set(["PNDLAP"]) };
  assert.ok(fromFile({ kind: "pick-client", ref: { fileId: "f1", carrierId: "c1", policyNumber: "AM-1" } }, file));
  // A review of another file of the same policy is not this file's.
  assert.ok(!fromFile({ kind: "pick-client", ref: { fileId: "f2", carrierId: "c1", policyNumber: "AM-1" } }, file));
  // "Policy with no sale": by carrier and file date, never by the policy number alone (every daily file lists it).
  assert.ok(fromFile({ kind: "no-sale", ref: { carrierId: "c1", policyNumber: "AM-7", fileDate: "2026-10-30" } }, file));
  assert.ok(!fromFile({ kind: "no-sale", ref: { carrierId: "c1", policyNumber: "AM-1", fileDate: "2026-10-29" } }, file));
  assert.ok(!fromFile({ kind: "no-sale", ref: { carrierId: "c1", policyNumber: "AM-1", fileDate: "2026-10-30" } }, { ...file, rowItemsDate: null }));
  // A client, and a sale with no carrier policy at all, never belong to a file.
  assert.ok(!fromFile({ kind: "same-person", ref: { carrierId: "c1", policyNumber: "AM-1", fileId: "f1" } }, file));
  assert.ok(!fromFile({ kind: "no-carrier", ref: { carrierId: "c1", policyNumber: "AM-1", fileId: "f1" } }, file));
  assert.ok(fromFile({ kind: "money", ref: { carrierId: "c1", policyNumber: "AM-9" } }, file));
  assert.ok(!fromFile({ kind: "money", ref: { carrierId: "c1", policyNumber: "AM-1" } }, file));
  assert.ok(fromFile({ kind: "agent", ref: { carrierId: "c1", agentCode: "44810" } }, file));
  assert.ok(fromFile({ kind: "status-word", ref: { carrierId: "c1", word: "PNDLAP" } }, file));
  assert.ok(!fromFile({ kind: "status-word", ref: { carrierId: "c2", word: "PNDLAP" } }, file));
  assert.ok(!fromFile({ kind: "credit" }, file));
  const page = read(LIST_PAGE);
  assert.match(page, /loadFileFilter\(scope\.tenantId, fileId\)/);
  // The filter reuses the file page's own reads: its head (which counts the row items) and ROW_QUEUE_TYPE.
  const store = read(STORE);
  assert.match(store, /import \{ loadFileHead, ROW_QUEUE_TYPE \} from "@\/lib\/ingestion\/fileOutcomeStore";/);
  assert.match(store, /const rowItemsDate = \(head\.facts\.noSaleItems \?\? 0\) > 0 \? head\.fileDate : null;/);
  assert.match(store, /const fileDate = r\.queue_type === ROW_QUEUE_TYPE \? \(r\.payload\?\.file_date \?\? null\) : null;/);
  assert.match(read("components/app/book/needs-you/needs-you-list.tsx"), /<ToggleChip selected onRemove=\{\(\) => router\.push\(fromFile\.clearHref\)\}>\{`From \$\{fromFile\.name\}`\}/);
});

test("the views: Mine is mine (or a keeper's own kinds), Agency is every decision, status words wait on Insurvas", () => {
  const open = [
    item("no-sale", "a", 3, { ownerUserId: "me" }),
    item("no-carrier", "b", 9, { ownerUserId: "someone" }),
    item("pick-client", "c", 1),
    item("status-word", "d", 5),
  ];
  assert.deepEqual(viewItems(open, "agency", { userId: "me", keeper: true }).map((i) => i.id), ["a", "b", "c"]);
  assert.deepEqual(viewItems(open, "mine", { userId: "me", keeper: true }).map((i) => i.id), ["a", "c"]);
  assert.deepEqual(viewItems(open, "mine", { userId: "me", keeper: false }).map((i) => i.id), ["a"]);
  assert.deepEqual(viewItems(open, "insurvas", { userId: "me", keeper: true }).map((i) => i.id), ["d"]);
  assert.deepEqual(groupCounts(open), { clients: 2, sales: 1, money: 0, credit: 0, rules: 0, files: 1 });
});

test("oldest first, and the next item is always the one after (wrapping), none when alone", () => {
  const list = [item("money", "x", 2), item("credit", "y", 31), item("agent", "z", 2)].sort(byOldest);
  assert.deepEqual(list.map((i) => i.id), ["y", "x", "z"]);
  assert.equal(neighbours(list, "money", "x").next.id, "z");
  assert.equal(neighbours(list, "agent", "z").next.id, "y");
  assert.equal(neighbours(list, "agent", "z").index, 2);
  assert.equal(neighbours([list[0]], "credit", "y").next, null);
  assert.equal(daysSince("2026-10-02T09:00:00Z", "2026-11-02"), 31);
  assert.equal(daysSince("2026-11-03", "2026-11-02"), 0);
});

test("an agent code's item id keeps any character the carrier writes, and nothing else is accepted", () => {
  for (const code of ["44810", "AB-12 / x", "Ñ7_ü"]) {
    const id = agentItemId(CARRIER, code);
    assert.ok(/^[0-9a-f.-]+$/i.test(id), id);
    assert.deepEqual(parseAgentItemId(id), { carrierId: CARRIER, code });
    assert.ok(isItemId("agent", id));
  }
  assert.equal(parseAgentItemId(`${CARRIER}.zz`), null);
  assert.equal(parseAgentItemId("not-a-uuid.3434"), null);
  assert.ok(isItemId("money", CARRIER));
  assert.ok(!isItemId("money", "1; drop"));
});

test("each source is read under the tenant, and keeper-only sources stay keeper-only", () => {
  const store = read(STORE);
  for (const table of ["policy_match_review", "queue_item", "commission_discrepancy", "agency_attribution_item", "policy_current", "unmapped_status_queue"]) {
    for (const [query] of store.matchAll(new RegExp(`from\\("${table}"\\)[^;]*`, "g"))) assert.match(query, /\.eq\("tenant_id"/, `${table} without a tenant filter`);
  }
  // Producers see only their own exception items, as the Exceptions API.
  assert.match(store, /return \(scope\.keeper \? q : q\.eq\("assigned_to_user_id", scope\.userId\)\)/);
  assert.match(store, /if \(!scope\.keeper && i\.assigned_to_user_id !== scope\.userId\) return null;/);
  // The list reads every open item (no cap), so it holds what the rail counts.
  assert.match(store, /allRows\(open, 20_000\)/);
  assert.doesNotMatch(store, /from\("queue_item"\)[^;]*\.eq\("status", "open"\)[^;]*\.limit\(/);
  for (const source of ["reviews", "agents", "statusWords"]) assert.match(store, new RegExp(`async function ${source}\\([^)]*\\)[^{]*\\{\\s*if \\(!scope\\.keeper\\) return EMPTY;`), source);
  assert.match(store, /if \(!scope\.keeper \|\| !scope\.money\) return EMPTY;/);
  assert.match(store, /if \(!scope\.keeper \|\| !scope\.credit\) return EMPTY;/);
  // Reading only: no scan or sweep runs from the list (readAttribution would run agency_attribution_scan).
  assert.doesNotMatch(store, /\.rpc\(|readAttribution|runDetection/);
  // LA-4.20: an untraceable finding is not shown here either.
  assert.match(store, /untraceableDiscrepancies\(scope\.tenantId\)/);
  // A table that isn't there yet is a pending note, not "nothing waits".
  assert.match(store, /isSchemaGap/);
});

test("both pages keep the step's gates, the AG-0.5 refusal, and the frame", () => {
  for (const file of [LIST_PAGE, ITEM_PAGE]) {
    const page = read(file);
    assert.match(page, /guardPage\("statement_ingestion"\)/, file);
    assert.match(page, /actAsPagePermission\(guard, "policies\.view"\)/, file);
    assert.match(page, /\(await scopeFor\(guard\.context\)\) !== null\) return <RoleGateNotice reason="agency"/, file);
    assert.match(page, /<DataInPage\s+step="needs-you"/, file);
    assert.doesNotMatch(page, /<PageHeader\b/, file);
  }
  assert.match(read(ITEM_PAGE), /title=\{item\.about\}/);
  // The views the list doesn't replace stay one click away.
  assert.match(read(LIST_PAGE), /href="\/app\/policy-matching\?tab=links"/);
  assert.match(read(LIST_PAGE), /href="\/app\/exceptions"/);
});

test("no side sheets or panels: an item is a page with tabs, or decided under its row; pop-ups are only for confirming", () => {
  for (const file of ["components/app/book/needs-you/needs-you-list.tsx", DECIDE, "components/app/book/needs-you/item-tabs.tsx", "components/app/book/needs-you/review-workspace.tsx", ITEM_PAGE, LIST_PAGE]) {
    const source = read(file);
    assert.doesNotMatch(source, /components\/ui\/(sheet|detail-panel|dialog)"/, file);
  }
  assert.match(read("components/app/book/needs-you/item-tabs.tsx"), /label: "Decide"[\s\S]*label: "The row as sent"/);
  // Round 4 (owner 2026-11-02): decided in place, the same form; the one dialog confirms a batch.
  // Round 5 (owner 2026-11-03): decided on the Review page, one question at a time, never under a row.
  const list = read("components/app/book/needs-you/needs-you-list.tsx");
  assert.doesNotMatch(list, /DecideInPlace|<ItemDecide/);
  assert.match(list, /\/app\/needs-you\/review\?kind=\$\{item\.kind\}&id=/);
  const review = read("components/app/book/needs-you/review-workspace.tsx");
  assert.match(review, /"\/api\/app\/exceptions"/);
  assert.match(review, /resolution: "confirm_client"/);
  assert.match(review, /"\/api\/app\/policy-matching"/);
  assert.match(review, /if \(event\.key === "s" \|\| event\.key === "S"\)/, "S skips");
  assert.match(read("app/app/(shell)/needs-you/review/page.tsx"), /\(await scopeFor\(guard\.context\)\) !== null\) return <RoleGateNotice reason="agency"/);
  assert.match(read(DECIDE), /if \(inline\) \{\s+notify\.done\(done\);/);
  const bulk = read("components/app/book/needs-you/bulk-resolve.tsx");
  assert.match(bulk, /components\/ui\/dialog"/);
  assert.match(bulk, /action: "resolve_many", item_ids: batch, resolution/);
  const id = CARRIER;
  assert.ok(exceptionsRequest.safeParse({ action: "resolve_many", item_ids: [id], resolution: "confirm_client" }).success);
  assert.ok(exceptionsRequest.safeParse({ action: "resolve_many", item_ids: [id], resolution: "not_mine" }).success);
  assert.ok(!exceptionsRequest.safeParse({ action: "resolve_many", item_ids: [id], resolution: "found_the_sale" }).success, "only answers that need nothing but the item");
  assert.ok(!exceptionsRequest.safeParse({ action: "resolve_many", item_ids: Array.from({ length: 51 }, () => id), resolution: "confirm_client" }).success, "at most 50 a batch");
  assert.match(read("app/api/app/exceptions/route.ts"), /batch: true/, "each item of a batch is audited on its own");
});

test("every kind is decided through the API its own screen already uses, with the shapes those routes accept", () => {
  const decide = read(DECIDE);
  assert.match(decide, /"\/api\/app\/policy-matching", "POST", \{ action: "resolve", review_id: detail\.reviewId, candidate:/);
  assert.match(decide, /"\/api\/app\/policy-matching", "POST", \{ action: "map_agent", carrier_id: detail\.carrierId, agent_identifier: detail\.code, user_id: userId \}/);
  assert.match(decide, /"\/api\/app\/exceptions", "POST", b,/);
  assert.match(decide, /"\/api\/app\/commission-discrepancies", "POST", \{ action: "draft_dispute", ids: \[f\.id\], recipient: null \}/);
  assert.match(decide, /"\/api\/app\/commission-discrepancies", "POST", \{ action: "set_status", id: f\.id, status: choice === "paid" \? "resolved" : "dismissed", note:/);
  assert.match(decide, /"\/api\/app\/agency\/attribution", "POST", \{ itemId: detail\.id, producerUserId: producerId, reason: reason\.trim\(\) \}/);
  // The exception choices are the queue's own, and each body the screen builds parses under the route's schema.
  assert.match(decide, /RESOLUTIONS\[q\.queueType\]/);
  const id = CARRIER;
  const bodies = [
    { resolution: "confirm_client" }, { resolution: "not_mine" }, { resolution: "same_person" }, { resolution: "different_people" }, { resolution: "reviewed" },
    { resolution: "link_existing_client", contact_id: id }, { resolution: "found_the_sale", deal_id: id }, { resolution: "found_the_policy", carrier_id: id, policy_number: "AM-1" },
    { resolution: "never_submitted", reason: "Client changed their mind" }, { resolution: "resubmitted_elsewhere", application_id: id },
    { resolution: "another_writing_number" }, { resolution: "another_writing_number", note: "44812" }, { resolution: "raised_with_carrier", note: "Asked Americo" },
  ];
  for (const body of bodies) assert.ok(exceptionsRequest.safeParse({ action: "resolve", item_id: id, ...body }).success, body.resolution);
  for (const field of ["contact_id", "deal_id", "carrier_id", "policy_number", "reason", "application_id", "note"]) assert.match(decide, new RegExp(`\\b${field}:`), field);
  for (const options of Object.values(RESOLUTIONS)) for (const resolution of options) assert.ok(bodies.some((b) => b.resolution === resolution), resolution);
  assert.match(decide, /"\/api\/app\/pipeline-rules", "POST", \{ action: "resolve_hold", hold_id: detail\.holdId, rule_id: picked \? picked\.ruleId : null \}/);
  assert.match(read("app/api/app/pipeline-rules/route.ts"), /z\.literal\("resolve_hold"\), hold_id: uuid, rule_id: uuid\.nullable\(\)/);
  // Status words: nothing to save here; Insurvas maps them (the muted line under the title says so).
  assert.match(read(ITEM_PAGE), /Waiting on Insurvas to map this word/);
});

test("round 3: no explainer cards — source notes are one line, waits are a muted line, queue items show owner and Escalated", () => {
  for (const file of [LIST_PAGE, ITEM_PAGE, DECIDE, "components/app/book/needs-you/needs-you-list.tsx", "components/app/book/needs-you/item-tabs.tsx"]) {
    assert.doesNotMatch(read(file), /<Callout\b[^>]*tone="info"/, file);
  }
  const list = read(LIST_PAGE);
  assert.match(list, /list\.notes\.length > 0 && <Callout tone="warning" title=\{list\.notes\.join\(" · "\)\} \/>/);
  assert.doesNotMatch(list, /list\.notes\.map\(/);
  assert.doesNotMatch(read(DECIDE), /A letter is out for this one|title="Waiting on Insurvas"/);
  const page = read(ITEM_PAGE);
  assert.match(page, /\{waits && <p className="m-0 text-sm text-muted-foreground">\{waits\}<\/p>\}/);
  assert.match(page, /A letter is out: record what/);
  assert.match(page, /\{item\.escalated && <StatusChip tone="danger">Escalated<\/StatusChip>\}/);
  assert.match(read("components/app/book/needs-you/needs-you-list.tsx"), /\{item\.who\}\{item\.escalated && !closed && <StatusChip tone="danger">Escalated<\/StatusChip>\}/);
  assert.match(read(STORE), /escalated: Boolean\(r\.escalated_at\)/);
});

test("the rail's Needs you badge counts what the list's Agency view holds", () => {
  const route = read("app/api/app/data-in/steps/route.ts");
  assert.match(route, /keeper \? unmappedAgentCodes\(tenantId\)/);
  assert.match(route, /keeper && money \? head\(count\("commission_discrepancy"\)[^\n]*hiddenOpenFindings\(tenantId\)/);
  assert.match(route, /keeper && credit \? head\(count\("agency_attribution_item"\)/);
  assert.match(route, /keeper \? countRuleHolds\(tenantId\)/);
  assert.match(route, /\[matching, exceptions, findings, attribution, agentCodes, ruleHolds\]/);
});
