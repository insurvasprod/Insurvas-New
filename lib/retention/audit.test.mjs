// LA-5 audit fixes (2026-10-15): each test holds one defect the audit against the Notion tasks found.
// Run with: node --experimental-strip-types --test lib/retention/audit.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PLATFORM_DEFAULT_SETTINGS as SETTINGS } from "./constants.ts";
import { buildQueue } from "./queue.ts";
import { mapLimit } from "./batch.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const card = (over = {}) => ({ key: "c|1", score: 80, band: "critical", confidence: "high", status: "active", daysPastDue: 0, boardReason: null, lastAttempt: null, hold: null, atRiskCents: 40000, nextDraftDays: 5, monthsSinceIssue: 2, failedFix: null, failedAt: null, ...over });

test("5.3 · a failed fix can be snoozed or dismissed once it has failed; an older hold or the call's cooldown never hides it", () => {
  const failedAt = "2026-10-10T09:00:00Z";
  const q = buildQueue([
    card({ key: "dismissed-after", failedFix: "…", failedAt, hold: { kind: "dismiss", until: null, score: 90, since: "2026-10-11T09:00:00Z" } }),
    card({ key: "snoozed-after", failedFix: "…", failedAt, hold: { kind: "snooze", until: "2026-10-20", score: 90, since: "2026-10-11T09:00:00Z" } }),
    card({ key: "dismissed-before", failedFix: "…", failedAt, hold: { kind: "dismiss", until: null, score: 90, since: "2026-10-01T09:00:00Z" } }),
    card({ key: "worked-recently", failedFix: "…", failedAt, lastAttempt: { at: "2026-10-12T09:00:00Z", score: 90 } }),
  ], SETTINGS, "2026-10-14");
  assert.deepEqual(q.cards.map((c) => c.key).sort(), ["dismissed-before", "worked-recently"]);
});

test("5.3 · the card says how sure the score is, and what each sign added (the audit trail)", () => {
  const board = read("components/app/save-queue-board.tsx");
  assert.match(board, /predicted · \{card\.confidence\} confidence · based on \{card\.signalsAvailable\} of 7 signals/);
  assert.match(board, /card\.contributions\.map\(\(c\) => `\$\{SIGNAL_LABELS\[c\.signal\]\}: \+\$\{c\.contribution\}`\)/);
});

test("no screen offers a raw tel: link — a call goes through the dialer's gates (calling window, do-not-call, attempt record)", () => {
  const walk = (dir) => readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".tsx") ? [`${dir}/${e.name}`] : []));
  const offenders = [...walk("components"), ...walk("app")].filter((f) => /href=\{?[`"']tel:/.test(read(f)));
  assert.deepEqual(offenders, []);
});

test("5.3 · a snooze counts from the agency's day the queue compares against, not UTC", () => {
  assert.match(read("lib/retention/queueStore.ts"), /Date\.parse\(`\$\{card\.today\}T00:00:00Z`\) \+ \(input\.days \?\? 7\) \* 86_400_000/);
});

test("5.2 · rescoring one policy can't make a stale book look fresh: freshness reads the OLDEST score", () => {
  assert.match(read("lib/retention/radarStore.ts"), /from\("policy_risk_score"\)\.select\("as_of, computed_at"\)\.eq\("tenant_id", tenantId\)\.order\("computed_at", \{ ascending: true \}\)/);
});

test("5.1–5.3 · chunked reads run a few at a time, never all at once", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n * 2;
  });
  assert.equal(peak, 3);
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  for (const f of ["lib/retention/radarStore.ts", "lib/retention/queueStore.ts"]) assert.doesNotMatch(read(f), /Promise\.all\(chunks\(/, f);
});

test("5.4 · from the save queue the call is logged after the request exists, and a failed log cancels the request", () => {
  const store = read("lib/retention/servicingStore.ts");
  const insert = store.indexOf(`from("servicing_request").insert(`);
  const log = store.indexOf("await logSaveAttempt(");
  assert.ok(insert > 0 && log > insert, "the request is inserted before the call is logged");
  assert.match(store, /servicingRequestId: data\.id/);
  // The cancel carries cancelled_at (the servicing_request_cancelled check refuses it otherwise —
  // found by the live E2E, 2026-10-16), and a card the queue won't take is refused before any insert.
  assert.match(store, /update\(\{ status: "cancelled", cancelled_at: new Date\(\)\.toISOString\(\), note: "Cancelled: the call could not be logged\." \}\)/);
  const precheck = store.indexOf("await assertQueueCard(");
  assert.ok(precheck > 0 && precheck < insert, "the queue card is checked before the request is inserted");
});

test("5.5 · a switch still being proven stays on the campaign; only a verified one counts as converted", () => {
  const store = read("lib/retention/campaignStore.ts");
  assert.match(store, /const requestedKeys = \[\.\.\.newestRequest\.values\(\)\]\.filter\(\(r\) => r\.status !== "cancelled"\)/);
  assert.match(store, /const convertedKeys = \[\.\.\.newestRequest\.values\(\)\]\.filter\(\(r\) => r\.status === "verified_in_file"\)/);
  assert.match(store, /convertedPolicies\.filter\(\(p\) => convertedSet\.has\(keyOf\(p\)\)\)/);
});

test("5.4 / 5.6 / 5.7 · the database fixes are in one migration, rehearsed", () => {
  const sql = read("supabase/migrations/20261015100000_la_5_audit_fixes.sql");
  assert.match(sql, /if v_all_match and v_proven > 0 then/);
  assert.match(sql, /and v_snap\.snapshot_date >= coalesce\(r\.expected_effective_date/);
  assert.match(sql, /public\.servicing_norm_address\(v_have\) = public\.servicing_norm_address\(v_want\)/);
  assert.match(sql, /c\.deadline < public\.la5_agency_today\(c\.tenant_id\)/);
  assert.match(sql, /where c\.deadline is null and c\.status in/);
  assert.match(sql, /p_text !~\* '\\mdeath benefits\?\\M'/);
  // The reinstatement sync no longer reads UTC's day anywhere.
  const sync = sql.slice(sql.indexOf("function public.sync_reinstatement_cases"), sql.indexOf("function public.winback_reason_category"));
  assert.doesNotMatch(sync, /current_date/);
});

test("5.6 · the countdown and the banner count from the agency's day; a case that moved meanwhile says so", () => {
  const store = read("lib/retention/reinstatementStore.ts");
  // Both the board and the banner read the agency's day (each now beside its other reads, so not awaited inline).
  assert.equal(store.split("agencyToday(viewer.tenantId)").length - 1, 2);
  assert.match(store, /throw new ReinstatementError\("This case changed while you had it open\. Reload it and try again\.", 409\)/);
});

test("5.7 · two release runs at once never both create a lead; the system releases, not whoever opened the page", () => {
  const store = read("lib/retention/winbackStore.ts");
  const claim = store.indexOf("release_blocked_reason: `${RELEASING}${claimedAt}`");
  const insert = store.indexOf(`from("agent_leads").insert(`);
  assert.ok(claim > 0 && insert > claim, "the claim is taken before the lead is created");
  assert.match(store, /if \(!claim\.data\?\.length\) continue;/);
  assert.match(store, /created_by: author,/);
  assert.match(store, /if \(options\.release\) lastRun = await releaseDueWinbacks\(viewer\.tenantId, null\);/);
  assert.match(read("app/app/(shell)/reinstatement/page.tsx"), /loadWinback\(viewer, \{ release: !readOnly \}\)/);
});
