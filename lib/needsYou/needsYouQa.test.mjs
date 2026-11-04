// Needs you, the QA walk of 2026-11-03: a search on the list and the Review queue (kept in ?q=), the question
// pane following the search, "The client cancelled — the chargeback is right" on a chargeback finding, and
// "Paid on a policy we don't have" for commission lines no policy file has after ORPHAN_NOTICE_DAYS.
// Run with: node --experimental-strip-types --test lib/needsYou/needsYouQa.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  acceptsChargeback, CHARGEBACK_ACCEPTED_NOTE, chargebackAcceptedNote, fromFile, isItemId, itemHref, KIND_META, moneyClosedWords, NEEDS_YOU_KINDS, ORPHAN_NOTICE_DAYS,
  orphanSubjectKey, parseUnknownPolicyItemId, reviewFocus, searchItems, searchParam, searchText, unknownPolicies, unknownPolicyItemId,
} from "./kinds.ts";
import { RESOLUTIONS } from "../ingestion/exceptionQueues.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const CARRIER = "11111111-2222-4333-8444-555555555555";
const item = (kind, id, extra = {}) => ({ kind, id, about: id, why: "", who: "", ownerUserId: null, since: "2026-11-01", ageDays: 2, href: itemHref(kind, id), tone: "neutral", ...extra });

test("search: policy number, client name, agent code and file name; every word, any case", () => {
  const items = [
    item("pick-client", "a", { about: "ACC9896101 · Aetna / CVS", why: "2 sales could be it", search: "Jason Anderson americo-2026-10-30.csv" }),
    item("no-sale", "b", { about: "0119990099 · Americo", why: "Maria Lopez · no sale or application on record", ref: { policyNumber: "0119990099" } }),
    item("agent", "c", { about: "Agent code 44810 · Americo", why: "3 policies", ref: { agentCode: "44810" } }),
  ];
  assert.deepEqual(searchItems(items, "acc9896101").map((i) => i.id), ["a"]);
  assert.deepEqual(searchItems(items, "  jason  ANDERSON ").map((i) => i.id), ["a"]);
  assert.deepEqual(searchItems(items, "americo-2026").map((i) => i.id), ["a"]);
  assert.deepEqual(searchItems(items, "lopez").map((i) => i.id), ["b"]);
  assert.deepEqual(searchItems(items, "44810").map((i) => i.id), ["c"]);
  assert.deepEqual(searchItems(items, "americo").map((i) => i.id), ["a", "b", "c"]);
  assert.deepEqual(searchItems(items, "").length, 3);
  assert.deepEqual(searchItems(items, "nobody").length, 0);
  assert.equal(searchParam("  x  "), "x");
  assert.equal(searchParam("   "), null);
  assert.equal(searchParam("y".repeat(300)).length, 100);
  assert.match(searchText(items[1]), /0119990099/);
});

test("Review: the question follows the search — keep the chosen item while listed, else the first unanswered match", () => {
  const anderson = { kind: "no-sale", id: "1" }, lopez = { kind: "no-sale", id: "2" }, kim = { kind: "money", id: "3" };
  const done = new Set();
  assert.equal(reviewFocus([lopez, kim], "no-sale:1", done), lopez, "the oldest unfiltered item is not kept");
  assert.equal(reviewFocus([lopez, kim], "money:3", done), kim, "the chosen item stays while listed");
  assert.equal(reviewFocus([anderson, lopez], null, new Set(["no-sale:1"])), lopez);
  assert.equal(reviewFocus([anderson], null, new Set(["no-sale:1"])), null);

  const ws = read("components/app/book/needs-you/review-workspace.tsx");
  assert.match(ws, /const current = reviewFocus\(shown, currentKey, done\);/);
  assert.match(ws, /const \[query, setQuery\] = useState\(initialQuery\);/);
  assert.match(ws, /<ToolbarSearch value=\{query\} onChange=\{search\}/);
  assert.match(ws, /url\.searchParams\.set\("q", q\)/);
  // The next walks the queue as searched.
  assert.match(ws, /const at = shown\.findIndex/);
  const page = read("app/app/(shell)/needs-you/review/page.tsx");
  assert.match(page, /initialQuery=\{searchParam\(search\.q\) \?\? ""\}/);
  assert.match(page, /search: searchText\(item\)/);
});

test("Needs you list: a search box in the toolbar, in ?q=, carried to every Review link", () => {
  const list = read("components/app/book/needs-you/needs-you-list.tsx");
  assert.match(list, /<ToolbarSearch value=\{query\} onChange=\{search\}/);
  assert.match(list, /const items = useMemo\(\(\) => searchItems\(every, query\), \[every, query\]\);/);
  assert.match(list, /window\.history\.replaceState/);
  assert.match(list, /&q=\$\{encodeURIComponent\(q\)\}/);
  assert.match(list, /if \(q\) query\.set\("q", q\);/);
  // Still the table foundation: TableCard with the fitted pager.
  assert.match(list, /<TableCard toolbar=\{toolbar\}/);
  assert.match(list, /useFittingPageSize\(/);
  const page = read("app/app/(shell)/needs-you/page.tsx");
  assert.match(page, /initialQuery=\{searchParam\(q\) \?\? ""\}/);
  assert.match(page, /<ReviewOldest fileId=\{file\?\.fileId \?\? null\} view=\{view\} \/>/);
  const oldest = read("components/app/book/needs-you/review-oldest.tsx");
  assert.match(oldest, /if \(q\) query\.set\("q", q\);/);
  assert.match(oldest, /if \(q\) back\.set\("q", q\);/);
});

test("a chargeback on an active policy can be accepted: dismissed (stays closed) with the reason, never marked lapsed", () => {
  assert.ok(acceptsChargeback("unexpected_chargeback"));
  assert.ok(!acceptsChargeback("short_paid"));
  assert.equal(chargebackAcceptedNote(""), CHARGEBACK_ACCEPTED_NOTE);
  assert.equal(chargebackAcceptedNote(" called 11/02 "), `${CHARGEBACK_ACCEPTED_NOTE} called 11/02`);
  assert.equal(moneyClosedWords("dismissed", chargebackAcceptedNote("x")), "Chargeback accepted: the client cancelled");
  assert.equal(moneyClosedWords("dismissed", "bad rate"), "Written off");
  assert.equal(moneyClosedWords("resolved", null), "Settled");

  const decide = read("components/app/book/needs-you/item-decide.tsx");
  assert.match(decide, /acceptsChargeback\(f\.type\) \? \[\{ key: "accept" as const, label: "The client cancelled — the chargeback is right"/);
  assert.match(decide, /choice === "accept"\) void send\(how, "\/api\/app\/commission-discrepancies", "POST", \{ action: "set_status", id: f\.id, status: "accepted", note: chargebackAcceptedNote\(note\) \}/);
  // Nothing here touches the policy's status.
  assert.doesNotMatch(decide, /lapsed.*set_status|policy_status/);
  // The Closed view names it from the note the store now reads.
  const store = read("lib/needsYou/store.ts");
  assert.match(store, /closedAs: moneyClosedWords\(r\.status, r\.resolution_note\)/);
  assert.match(store, /resolution, resolution_note, resolved_at";/);
});

test("Paid on a policy we don't have: lines no policy file has, past ORPHAN_NOTICE_DAYS, with no orphan item yet", () => {
  assert.equal(ORPHAN_NOTICE_DAYS, 7);
  assert.ok(NEEDS_YOU_KINDS.includes("unknown-policy"));
  assert.equal(KIND_META["unknown-policy"].group, "money");
  assert.equal(KIND_META["unknown-policy"].label, "Paid on a policy we don’t have");
  assert.ok(KIND_META["unknown-policy"].keeperOnly);

  const line = (policyNumber, seenOn, amountCents, extra = {}) => ({ carrierId: CARRIER, policyNumber, entryType: "advance", correctsType: null, amountCents, seenOn, fileId: "f1", agentCode: "44810", ...extra });
  const lines = [
    line("0119990099", "2026-10-20", 18000),
    line("0119990099", "2026-10-25", 500, { entryType: "held" }),
    line("NEW-1", "2026-11-01", 9000), // 2 days: not yet
    line("KNOWN-1", "2026-09-01", 9000), // a policy file has it
    line("RAISED-1", "2026-09-01", 9000), // the sweep (or a person) raised it already
  ];
  const known = new Set([`${CARRIER}|KNOWN-1`]);
  const raised = new Set([orphanSubjectKey(CARRIER, "RAISED-1")]);
  const out = unknownPolicies(lines, known, raised, "2026-11-03");
  assert.deepEqual(out.map((p) => p.policyNumber), ["0119990099"]);
  assert.equal(out[0].amountCents, 18000);
  assert.equal(out[0].heldCents, 500);
  assert.equal(out[0].lines, 2);
  assert.equal(out[0].firstSeen, "2026-10-20");
  assert.deepEqual(out[0].agentCodes, ["44810"]);
  // Exactly 7 days is enough.
  assert.equal(unknownPolicies([line("P7", "2026-10-27", 100)], new Set(), new Set(), "2026-11-03").length, 1);
  assert.equal(unknownPolicies([line("P6", "2026-10-28", 100)], new Set(), new Set(), "2026-11-03").length, 0);
  // The sweep's own key, so an item raised early is the one it refreshes.
  assert.equal(orphanSubjectKey(CARRIER, "X"), `orphan:${CARRIER}:X`);
  const sql = read("supabase/migrations/20261008240000_la_4_14_orphans_and_accounts.sql");
  assert.match(sql, /'orphan:' \|\| r\.carrier_id::text \|\| ':' \|\| r\.policy_number/);

  const id = unknownPolicyItemId(CARRIER, "0119990099");
  assert.ok(isItemId("unknown-policy", id));
  assert.deepEqual(parseUnknownPolicyItemId(id), { carrierId: CARRIER, policyNumber: "0119990099" });
  assert.ok(!isItemId("unknown-policy", CARRIER));
  // Files › Open all in Needs you: by the file's commission lines, as Commission, no policy.
  const file = { fileId: "f1", name: "x", carrierId: CARRIER, rowItemsDate: null, policies: new Set(), commissionPolicies: new Set([`${CARRIER}|0119990099`]), codes: new Set(), words: new Set() };
  assert.ok(fromFile({ kind: "unknown-policy", ref: { carrierId: CARRIER, policyNumber: "0119990099" } }, file));
});

test("Paid on a policy we don't have: read from existing rows; answers raise the sweep's item and use the queue's own answers", () => {
  const store = read("lib/needsYou/store.ts");
  assert.match(store, /guarded\("Paid on a policy we don’t have", ORPHANS_PENDING_MESSAGE, \(\) => unknownPolicyItems\(scope, names, today\)\)/);
  assert.match(store, /from\("commission_orphan_summary"\)/);
  assert.match(store, /eq\("queue_type", "orphan_commission"\)/);
  const raise = read("lib/needsYou/raise.ts");
  assert.match(raise, /rpc\("open_queue_item", \{/);
  assert.match(raise, /p_queue_type: "orphan_commission", p_subject_key: orphanSubjectKey\(found\.carrierId, found\.policyNumber\)/);
  assert.match(raise, /resolveItem\(/);
  // No new resolution value: the answers are exactly the orphan queue's.
  const answers = raise.match(/UNKNOWN_POLICY_ANSWERS = \[([^\]]+)\]/)[1].split(",").map((s) => s.trim().replace(/"/g, ""));
  assert.deepEqual(answers, [...RESOLUTIONS.orphan_commission]);
  // A refused answer writes nothing.
  assert.ok(raise.indexOf("Say what you asked the carrier.") < raise.indexOf('rpc("open_queue_item"'));
  const route = read("app/api/app/needs-you/item/route.ts");
  assert.match(route, /requireFeatureRole\("statement_ingestion", \["owner", "bookkeeper"\] as const, \{ write: true \}\)/);
  assert.match(route, /action: z\.literal\("answer_unknown_policy"\)/);
  assert.match(route, /await audit\(/);
  const decide = read("components/app/book/needs-you/item-decide.tsx");
  assert.match(decide, /case "unknown-policy": return <UnknownPolicyDecide/);
  assert.match(decide, /\{ key: "wait", label: "Wait for the policy file"/);
  // No migration in this change.
  assert.doesNotMatch(raise, /create table|alter table|insert into/i);
});
