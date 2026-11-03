// LA-5.8 / 5.9 / 5.11 (Notion sprint, Module 5 — Retention) · the retention role and its scorecard,
// effectiveness and the holdout, and the settings hub — as plain functions and source checks.
// Run with: node --experimental-strip-types --test lib/retention/la5_8_9_11.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assignOwners, ownsCard } from "./assignment.ts";
import { PLATFORM_CAPS, PLATFORM_DEFAULT_SETTINGS as SETTINGS, PLATFORM_DEFAULT_WEIGHTS, settingsFromRow, WINBACK_REASONS } from "./constants.ts";
import { bandAccuracy, draw, effectiveShareBp, exitReason, holdoutComparison, holdoutSentence, MIN_RATE_SAMPLE, outcomeOf, protectedAdvance, separation, twoProportionZ } from "./effectiveness.ts";
import { buildQueue } from "./queue.ts";
import { MIN_SAVE_SAMPLE, rateText, reasonOf, resultOf, scorecards, visibleCards } from "./scorecard.ts";
import { AFFORDABILITY_CONFIRMATION, bandMoves, diff, FIELDS, guardProblem, HOLDOUT_EXPLANATION, resetSection, thresholdConsequence, toRow, validate, weightProblem } from "./settingsHub.ts";
import { hasTenantPermission } from "../tenantAuth/permissions.ts";
import { TENANT_ROLES } from "../tenantAuth/roles.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), REP_A = U(2), REP_B = U(3), AGENT = U(4), CARRIER = U(10), CARRIER_2 = U(11);
const members = (extra = []) => [
  { userId: OWNER, role: "owner", active: true, joinedAt: "2026-01-01" },
  { userId: AGENT, role: "producer", active: true, joinedAt: "2026-02-01" },
  ...extra,
];
const reps = [{ userId: REP_A, role: "retention", active: true, joinedAt: "2026-03-01" }, { userId: REP_B, role: "retention", active: true, joinedAt: "2026-04-01" }];
const config = (over = {}) => ({ queue: "save_queue", ownerRole: "retention", strategy: "round_robin", carrierReps: {}, repOrder: [], escalateDays: 7, ...over });
const item = (k, over = {}) => ({ key: `${CARRIER}|P${k}`, carrierId: CARRIER, writingAgentId: AGENT, exposureCents: 1000 * k, ...over });

// ─── LA-5.8 · the role ───────────────────────────────────────────────────────────────────────────

test("5.8 · the retention role exists and shares the one permission model", () => {
  assert.ok(TENANT_ROLES.includes("retention"));
  assert.ok(hasTenantPermission("retention", "retention.exposure"), "the exposure figure is the role's one money figure");
  for (const p of ["money.view", "commission.view.own", "commission.view.all", "sales.use", "settings.manage"]) assert.equal(hasTenantPermission("retention", p), false, p);
  const sql = read("supabase/migrations/20261016200000_la_5_8_retention_role.sql");
  assert.match(sql, /alter type public\.tenant_user_role add value if not exists 'retention'/);
  // The new label is never used as an enum literal in the transaction that adds it (55P04).
  assert.doesNotMatch(sql, /'retention'::(public\.)?tenant_user_role/);
});

test("5.8 · the LA-5 pages and menu admit retention; win-back, income and the settings do not", () => {
  const menu = read("lib/menu/definition.ts");
  for (const key of ["retention.lapse-risk", "retention.save-queue", "retention.payment-repair", "retention.winback", "retention.scorecard"]) {
    assert.match(menu, new RegExp(`key: "${key.replace(".", "\\.")}"[^\\n]*"retention"\\]`), key);
  }
  assert.match(menu, /key: "retention\.results"[^\n]*required_roles: \["owner"\]/);
  assert.match(menu, /key: "retention\.settings"[^\n]*required_roles: \["owner"\]/);
  assert.match(read("app/api/app/retention/winback/route.ts"), /\["owner", "producer"\] as const/);
  assert.match(read("app/api/app/retention/income/route.ts"), /const ROLES = \["owner", "producer"\]/);
  assert.match(read("app/api/app/retention/settings/route.ts"), /requireFeatureRole\("chargeback_radar", \["owner"\] as const/);
  // A retention rep never sees the win-back tab on the reinstatement page.
  assert.match(read("app/app/(shell)/reinstatement/page.tsx"), /canWinback = guard\.role !== "retention"/);
});

// ─── LA-5.8 · assignment ─────────────────────────────────────────────────────────────────────────

test("5.8 · round-robin is the default, and balances the open cards", () => {
  assert.equal(SETTINGS.assignmentStrategy, "round_robin");
  const out = assignOwners([1, 2, 3, 4].map((k) => item(k)), new Map(), members(reps), config());
  const counts = [...out.values()].reduce((m, a) => m.set(a.userId, (m.get(a.userId) ?? 0) + 1), new Map());
  assert.equal(counts.get(REP_A), 2);
  assert.equal(counts.get(REP_B), 2);
  for (const a of out.values()) assert.equal(a.role, "retention");
});

test("5.8 · by carrier: a mapped carrier goes to its rep, an unmapped one is round-robin", () => {
  const items = [item(1), item(2), item(3, { key: `${CARRIER_2}|P3`, carrierId: CARRIER_2 })];
  const out = assignOwners(items, new Map(), members(reps), config({ strategy: "by_carrier", carrierReps: { [CARRIER]: REP_B } }));
  assert.equal(out.get(`${CARRIER}|P1`).userId, REP_B);
  assert.equal(out.get(`${CARRIER}|P2`).userId, REP_B);
  assert.equal(out.get(`${CARRIER_2}|P3`).userId, REP_A, "the unmapped carrier goes to the least-loaded rep");
});

test("5.8 · by exposure: the biggest cases go to the first rep in the agency's order, up to a fair share", () => {
  const out = assignOwners([1, 2, 3, 4].map((k) => item(k)), new Map(), members(reps), config({ strategy: "by_exposure", repOrder: [REP_B, REP_A] }));
  assert.equal(out.get(`${CARRIER}|P4`).userId, REP_B);
  assert.equal(out.get(`${CARRIER}|P3`).userId, REP_B);
  assert.equal(out.get(`${CARRIER}|P2`).userId, REP_A);
  assert.equal(out.get(`${CARRIER}|P1`).userId, REP_A);
});

test("5.8 · no card is unowned: save queue falls to the writing agent, other queues and a missing agent to the owner", () => {
  const save = assignOwners([item(1), item(2, { writingAgentId: null })], new Map(), members(), config());
  assert.deepEqual([save.get(`${CARRIER}|P1`).userId, save.get(`${CARRIER}|P1`).role], [AGENT, "writing_agent"]);
  assert.deepEqual([save.get(`${CARRIER}|P2`).userId, save.get(`${CARRIER}|P2`).role], [OWNER, "admin"]);
  const bill = assignOwners([item(1)], new Map(), members(), config({ queue: "paper_bill" }));
  assert.deepEqual([bill.get(`${CARRIER}|P1`).userId, bill.get(`${CARRIER}|P1`).role], [OWNER, "admin"]);
  for (const a of [...save.values(), ...bill.values()]) assert.ok(a.userId);
});

test("5.8 · a solo agent owns every card and never sees owners", () => {
  const solo = [{ userId: OWNER, role: "owner", active: true }];
  for (const queue of ["save_queue", "paper_bill", "reinstatement"]) {
    const out = assignOwners([item(1, { writingAgentId: OWNER })], new Map(), solo, config({ queue }));
    assert.equal(out.get(`${CARRIER}|P1`).userId, OWNER, queue);
  }
  assert.match(read("lib/retention/queueStore.ts"), /showOwners: Boolean\(owners\) && new Set\(/);
});

test("5.8 · an owner stays with a card, and a rep who leaves the role loses theirs", () => {
  const existing = new Map([[`${CARRIER}|P1`, { userId: REP_B, role: "retention", assignedAt: "2026-10-01T00:00:00Z", escalated: false }]]);
  const kept = assignOwners([item(1)], existing, members(reps), config());
  assert.equal(kept.get(`${CARRIER}|P1`).userId, REP_B);
  assert.equal(kept.get(`${CARRIER}|P1`).changed, false);
  const gone = assignOwners([item(1)], existing, members([reps[0]]), config());
  assert.equal(gone.get(`${CARRIER}|P1`).userId, REP_A);
  assert.equal(gone.get(`${CARRIER}|P1`).changed, true);
  // A rep joining takes the writing agents' save cards over.
  const before = new Map([[`${CARRIER}|P1`, { userId: AGENT, role: "writing_agent", assignedAt: "2026-10-01T00:00:00Z", escalated: false }]]);
  assert.equal(assignOwners([item(1)], before, members(reps), config()).get(`${CARRIER}|P1`).role, "retention");
});

test("5.8 · reinstatement cases move to the writing agent inside the escalation window", () => {
  const cfg = config({ queue: "reinstatement" });
  const far = assignOwners([item(1, { daysToDeadline: 12 })], new Map(), members(reps), cfg).get(`${CARRIER}|P1`);
  assert.equal(far.role, "retention");
  const near = assignOwners([item(1, { daysToDeadline: 7 })], new Map(), members(reps), cfg).get(`${CARRIER}|P1`);
  assert.deepEqual([near.userId, near.role, near.escalated], [AGENT, "writing_agent", true]);
  // Kept escalated on the next read, without counting as a change.
  const again = assignOwners([item(1, { daysToDeadline: 6 })], new Map([[`${CARRIER}|P1`, { userId: AGENT, role: "writing_agent", assignedAt: "x", escalated: true }]]), members(reps), cfg).get(`${CARRIER}|P1`);
  assert.equal(again.changed, false);
  assert.equal(SETTINGS.reinstatementEscalateDays, 7);
});

test("5.8 · a retention rep works only their own cards; others as before", () => {
  assert.equal(ownsCard({ userId: REP_A, role: "retention" }, { userId: REP_A }), true);
  assert.equal(ownsCard({ userId: REP_A, role: "retention" }, { userId: REP_B }), false);
  assert.equal(ownsCard({ userId: REP_A, role: "retention" }, undefined), false);
  assert.equal(ownsCard({ userId: OWNER, role: "owner" }, { userId: REP_B }), true);
  for (const f of ["lib/retention/queueStore.ts", "lib/retention/reinstatementStore.ts", "lib/retention/campaignStore.ts"]) assert.match(read(f), /viewer\.role === "retention" && !ownsCard\(/, f);
});

// ─── LA-5.8 · the scorecard ──────────────────────────────────────────────────────────────────────

const attempt = (over) => ({ by: REP_A, key: `${CARRIER}|P1`, at: "2026-05-01T10:00:00Z", outcome: "reached_agreed", firstAction: "move_draft_date", clientReason: null, advanceCents: 40000, inHoldout: false, ...over });
const inForce = { status: "active", lapsedOn: null, annualCents: 85680 };

test("5.8 · the reason is what the client said, else the card's first fix", () => {
  assert.equal(reasonOf({ clientReason: null, firstAction: "move_draft_date" }), "draft_timing");
  assert.equal(reasonOf({ clientReason: null, firstAction: "convert_to_draft" }), "paper_bill");
  assert.equal(reasonOf({ clientReason: null, firstAction: "confirm_account" }), "payment_details");
  assert.equal(reasonOf({ clientReason: "affordability", firstAction: "move_draft_date" }), "affordability");
  assert.equal(reasonOf({ clientReason: null, firstAction: null }), "other");
});

test("5.8 · saved means still in force 90 days after being worked; protected counts only those", () => {
  assert.equal(resultOf(inForce, "2026-05-01", "2026-07-20"), "pending");
  assert.equal(resultOf(inForce, "2026-05-01", "2026-08-01"), "saved");
  assert.equal(resultOf({ status: "lapsed", lapsedOn: "2026-06-15", annualCents: 1 }, "2026-05-01", "2026-06-20"), "lost");
  assert.equal(resultOf({ status: "lapsed", lapsedOn: "2026-09-15", annualCents: 1 }, "2026-05-01", "2026-10-01"), "saved");
  const policies = new Map([[`${CARRIER}|P1`, inForce], [`${CARRIER}|P2`, { status: "lapsed", lapsedOn: "2026-06-01", annualCents: 99999 }], [`${CARRIER}|P3`, inForce]]);
  const [card] = scorecards({
    attempts: [attempt({}), attempt({ key: `${CARRIER}|P2` }), attempt({ key: `${CARRIER}|P3`, at: "2026-07-25T10:00:00Z" })],
    conversions: [], reinstated: [], policies, holdoutKeys: new Set(), from: "2026-04-01", to: "2026-08-10", today: "2026-08-10",
  });
  assert.equal(card.premiumProtectedCents, 85680, "only P1 survived 90 days; P3 is too recent, P2 lapsed");
  assert.equal(card.advanceProtectedCents, 40000);
});

test("5.8 · save rate is per reason; the blended line is the total row; under 10 shows the count", () => {
  const policies = new Map();
  const attempts = [];
  for (let i = 0; i < 12; i++) { policies.set(`${CARRIER}|D${i}`, i < 9 ? inForce : { status: "lapsed", lapsedOn: "2026-05-20", annualCents: 1 }); attempts.push(attempt({ key: `${CARRIER}|D${i}` })); }
  for (let i = 0; i < 5; i++) { policies.set(`${CARRIER}|A${i}`, i < 1 ? inForce : { status: "lapsed", lapsedOn: "2026-05-20", annualCents: 1 }); attempts.push(attempt({ key: `${CARRIER}|A${i}`, outcome: "reached_refused", clientReason: "affordability" })); }
  const [card] = scorecards({ attempts, conversions: [], reinstated: [], policies, holdoutKeys: new Set(), from: "2026-04-01", to: "2026-09-01", today: "2026-09-01" });
  const draft = card.byReason.find((l) => l.reason === "draft_timing");
  const afford = card.byReason.find((l) => l.reason === "affordability");
  assert.equal(draft.rate, 9 / 12);
  assert.equal(rateText(draft), "75%");
  assert.equal(afford.rate, null, "five decided cases is under the floor");
  assert.equal(rateText(afford), "1 of 5 saved");
  assert.equal(card.blended.reason, "all");
  assert.equal(card.blended.saved, 10);
  assert.equal(MIN_SAVE_SAMPLE, 10);
  // The board renders save rates only in the by-reason table, the blended figure as its last row.
  const board = read("components/app/retention/retention-scorecard-board.tsx");
  assert.equal((board.match(/rateText\(/g) ?? []).length, 1);
  assert.match(board, /\{row\(blended, "All reasons", true\)\}/);
});

test("5.8 · unreachable is not unsuccessful", () => {
  const policies = new Map([[`${CARRIER}|P1`, { status: "lapsed", lapsedOn: "2026-05-20", annualCents: 1 }], [`${CARRIER}|P2`, inForce]]);
  const [card] = scorecards({
    attempts: [attempt({ outcome: "voicemail" }), attempt({ outcome: "no_answer" }), attempt({ key: `${CARRIER}|P2` })],
    conversions: [], reinstated: [], policies, holdoutKeys: new Set(), from: "2026-04-01", to: "2026-09-01", today: "2026-09-01",
  });
  const line = card.byReason.find((l) => l.reason === "draft_timing");
  assert.deepEqual([line.cases, line.unreachable, line.lost, line.saved], [2, 1, 0, 1], "the voicemail case is unreachable, not lost");
  assert.equal(card.contactRate, 1 / 3);
});

test("5.8 · holdout cases count against nobody", () => {
  const policies = new Map([[`${CARRIER}|P1`, { status: "lapsed", lapsedOn: "2026-05-20", annualCents: 1 }], [`${CARRIER}|P2`, { status: "lapsed", lapsedOn: "2026-05-20", annualCents: 1 }]]);
  const cards = scorecards({
    attempts: [attempt({}), attempt({ key: `${CARRIER}|P2`, inHoldout: true })], conversions: [{ by: REP_A, key: `${CARRIER}|P1`, at: "2026-05-02T00:00:00Z", outcome: "declined", verified: false }],
    reinstated: [{ by: REP_A, key: `${CARRIER}|P1`, at: "2026-06-01T00:00:00Z" }], policies, holdoutKeys: new Set([`${CARRIER}|P1`]), from: "2026-04-01", to: "2026-09-01", today: "2026-09-01",
  });
  assert.deepEqual(cards, [], "every case was held out at some point");
});

test("5.8 · a rep sees their own card and nobody else's; the owner sees all", () => {
  const cards = [{ userId: REP_A }, { userId: REP_B }];
  assert.deepEqual(visibleCards(cards, { userId: REP_A, role: "retention" }), [{ userId: REP_A }]);
  assert.deepEqual(visibleCards(cards, { userId: AGENT, role: "producer" }), []);
  assert.equal(visibleCards(cards, { userId: OWNER, role: "owner" }).length, 2);
  // The store reads only the viewer's own rows for anyone but the owner.
  assert.match(read("lib/retention/scorecardStore.ts"), /if \(mineOnly\) q = q\.eq\("attempted_by", viewer\.userId\)/);
});

// ─── LA-5.9 · effectiveness ──────────────────────────────────────────────────────────────────────

const pred = (band, outcome, over = {}) => ({ band, confidence: "high", weightSetVersion: 1, outcome, wasWorked: false, inHoldout: false, ...over });
const many = (n, band, lapsed, over = {}) => Array.from({ length: n }, (_, i) => pred(band, i < lapsed ? "lapsed" : "still_active", over));

test("5.9 · accuracy is by band, on unworked policies only, with counts under 20", () => {
  const rows = [...many(38, "critical", 19), ...many(104, "high", 31), ...many(290, "medium", 32), ...many(15, "low", 1), ...many(50, "critical", 0, { wasWorked: true })];
  const a = bandAccuracy(rows);
  const critical = a.byBand.find((b) => b.band === "critical");
  assert.deepEqual([critical.n, critical.lapsed, critical.rate], [38, 19, 0.5], "worked policies are left out");
  assert.equal(a.byBand.find((b) => b.band === "low").rate, null, "15 is under the floor: a count");
  assert.equal(MIN_RATE_SAMPLE, 20);
  assert.equal(a.verdict, "separates");
  assert.equal(a.byVersion[0].version, 1);
  assert.equal(a.byConfidence.length, 3);
});

test("5.9 · a score that does not separate the bands is called noise", () => {
  assert.equal(separation([{ band: "critical", rate: 0.1 }, { band: "high", rate: 0.1 }, { band: "medium", rate: 0.1 }, { band: "low", rate: 0.09 }]), "noise");
  assert.equal(separation([{ band: "critical", rate: null }, { band: "high", rate: 0.3 }, { band: "medium", rate: null }, { band: "low", rate: null }]), "too_early");
  assert.equal(separation([{ band: "critical", rate: 0.5 }, { band: "high", rate: 0.6 }, { band: "medium", rate: 0.1 }, { band: "low", rate: 0.03 }]), "mixed");
});

test("5.9 · the outcome at the horizon is read, never guessed", () => {
  assert.equal(outcomeOf({ status: "active", lapsedOn: null }, false, "2026-01-01", "2026-04-01"), "still_active");
  assert.equal(outcomeOf({ status: "lapsed", lapsedOn: "2026-03-01" }, false, "2026-01-01", "2026-04-01"), "lapsed");
  assert.equal(outcomeOf({ status: "lapsed", lapsedOn: "2026-05-01" }, false, "2026-01-01", "2026-04-01"), "still_active");
  assert.equal(outcomeOf({ status: "lapsed", lapsedOn: "2026-03-01" }, true, "2026-01-01", "2026-04-01"), "reinstated");
  assert.equal(outcomeOf(undefined, false, "2026-01-01", "2026-04-01"), null);
});

test("5.9 · the holdout is off by default, capped at 20% everywhere, and never takes a big or unknown case", () => {
  assert.equal(SETTINGS.holdoutEnabled, false);
  assert.equal(SETTINGS.holdoutShareBp, 1000);
  assert.equal(PLATFORM_CAPS.holdoutCeilingBp, 2000);
  assert.equal(effectiveShareBp(9000), 2000);
  assert.equal(settingsFromRow({ holdout_share_bp: 9000 }).holdoutShareBp, 2000);
  assert.equal(draw({ exposureCents: 50000, maxExposureCents: 100000, shareBp: 2000, roll: 0.19, openReinstatement: false }).selected, true);
  assert.equal(draw({ exposureCents: 50000, maxExposureCents: 100000, shareBp: 9000, roll: 0.5, openReinstatement: false }).selected, false, "the ceiling holds over a bad setting");
  assert.deepEqual(draw({ exposureCents: 150000, maxExposureCents: 100000, shareBp: 2000, roll: 0, openReinstatement: false }), { selected: false, ineligible: "above_exposure" });
  assert.deepEqual(draw({ exposureCents: null, maxExposureCents: 100000, shareBp: 2000, roll: 0, openReinstatement: false }), { selected: false, ineligible: "exposure_unknown" });
  assert.equal(draw({ exposureCents: 1, maxExposureCents: 100000, shareBp: 2000, roll: 0, openReinstatement: true }).selected, false, "never a reinstatement case");
  const sql = read("supabase/migrations/20261016210000_la_5_9_effectiveness_holdout.sql");
  assert.match(sql, /holdout_enabled boolean not null default false/);
  assert.match(sql, /constraint retention_holdout_share check \(share_bp between 100 and 2000\)/);
  assert.match(sql, /constraint retention_holdout_exposure check \(not selected or \(exposure_cents is not null and exposure_cents <= max_exposure_cents/);
  assert.match(sql, /A policy with an open reinstatement case is never held out\./);
});

test("5.9 · past due leaves the holdout in the same run, and the queue never shows a held-out policy", () => {
  assert.equal(exitReason({ status: "active", daysPastDue: 3 }, true), "past_due");
  assert.equal(exitReason({ status: "at_risk", daysPastDue: 0 }, true), "past_due");
  assert.equal(exitReason({ status: "active", daysPastDue: 0 }, true), null);
  assert.equal(exitReason({ status: "active", daysPastDue: 0 }, false), "switched_off");
  assert.equal(exitReason(undefined, true), "left_book");
  // Exits run on every radar computation (after each policy file), before anything else.
  assert.match(read("lib/retention/radarStore.ts"), /await afterRadarRun\(tenantId, config\.settings, today, scoreRows, policies,/);
  assert.match(read("lib/retention/effectivenessStore.ts"), /await holdoutExits\(tenantId, settings\);\n\s+if \(settings\.holdoutEnabled\)/);
  // LA-4.16's board knows nothing of the holdout, so a policy that left it shows there like any other.
  assert.doesNotMatch(read("lib/ingestion/retentionStore.ts"), /holdout/i);
  const card = (over) => ({ key: "k", score: 80, band: "critical", confidence: "high", status: "active", daysPastDue: 0, boardReason: null, lastAttempt: null, hold: null, atRiskCents: 100, nextDraftDays: 3, monthsSinceIssue: 2, ...over });
  const q = buildQueue([card({ key: "a", inHoldout: true }), card({ key: "b" }), card({ key: "c", inHoldout: true, failedFix: "x" })], SETTINGS, "2026-10-16");
  assert.deepEqual(q.cards.map((c) => c.key), ["b"]);
  assert.equal(q.heldOut, 2);
});

test("5.9 · worked against held back, with an honest sentence", () => {
  const rows = [
    ...Array.from({ length: 71 }, (_, i) => ({ band: "high", selected: false, wasWorked: true, outcome: i < 14 ? "lapsed" : "still_active", exposureCents: 40000 })),
    ...Array.from({ length: 8 }, (_, i) => ({ band: "high", selected: true, wasWorked: false, outcome: i < 4 ? "lapsed" : "still_active", exposureCents: 30000 })),
  ];
  const cmp = holdoutComparison(rows);
  assert.equal(cmp.bands[0].holdout.rate, null, "8 held back: a count, the sample is too small");
  assert.equal(cmp.bands[0].meaningful, false);
  const lines = holdoutSentence(rows, "over the last quarter");
  assert.match(lines[0], /Of the 71 policies we flagged and you worked, 57 were still paying/);
  assert.match(lines[0], /Of the 8 we held back, 4 were/);
  assert.match(lines[1], /Too few policies to give a rate yet/);
  assert.ok(Math.abs(twoProportionZ({ n: 100, lapsed: 50 }, { n: 100, lapsed: 20 })) > 1.96);
  assert.ok(protectedAdvance(rows) > 0);
  // A big, real difference reads as a result with its dollar figure.
  const big = [
    ...Array.from({ length: 200 }, (_, i) => ({ band: "high", selected: false, wasWorked: true, outcome: i < 40 ? "lapsed" : "still_active", exposureCents: 40000 })),
    ...Array.from({ length: 40 }, (_, i) => ({ band: "high", selected: true, wasWorked: false, outcome: i < 20 ? "lapsed" : "still_active", exposureCents: 40000 })),
  ];
  assert.match(holdoutSentence(big, "over the last quarter")[1], /looks worth about \$24,000 of protected advance over the last quarter/);
});

// ─── LA-5.11 · the settings hub ──────────────────────────────────────────────────────────────────

test("5.11 · the TypeScript defaults and the database's column defaults are the same numbers", () => {
  const sql = ["20261014100000_la_5_1_3_chargeback_radar", "20261014200000_la_5_4_servicing_requests", "20261014300000_la_5_5_paper_bill_campaign", "20261014400000_la_5_6_reinstatement", "20261014500000_la_5_7_winback", "20261016200000_la_5_8_retention_role", "20261016210000_la_5_9_effectiveness_holdout", "20261016220000_la_5_11_retention_settings_hub"].map((f) => read(`supabase/migrations/${f}.sql`)).join("\n");
  const defaultOf = (column) => {
    const inline = new RegExp(`\\n\\s+${column} \\w+ not null default ([^,\\n]+)`).exec(sql) ?? new RegExp(`add column if not exists ${column} [^;]*? default ([^;]+);`).exec(sql) ?? new RegExp(`alter column ${column} set default ([^;]+);`).exec(sql);
    return inline?.[1].trim().replace(/::jsonb$/, "").replace(/^'(.*)'$/, "$1");
  };
  const row = toRow(SETTINGS);
  for (const [column, value] of Object.entries(row)) {
    if (column === "bill_talk_track") continue; // null: the platform's text
    const d = defaultOf(column);
    assert.ok(d !== undefined, `${column} has no default in the migrations`);
    const want = Array.isArray(value) ? "{}" : typeof value === "object" ? "{}" : String(value);
    assert.equal(d, want, column);
  }
  assert.deepEqual(PLATFORM_DEFAULT_WEIGHTS, { draft_timing: 30, payment_method: 20, policy_age: 20, payment_wobble: 15, affordability: 10, lead_source: 3, carrier: 2 });
});

test("5.11 · validation mirrors the database's checks", () => {
  assert.equal(validate(SETTINGS), null);
  assert.match(validate({ ...SETTINGS, highFrom: 20 }), /bands must rise/);
  assert.match(validate({ ...SETTINGS, holdoutShareBp: 2500 }), /from 100 to 2000/);
  assert.match(validate({ ...SETTINGS, winbackDays: { ...SETTINGS.winbackDays, affordability: 90 } }), /from 180 to 1095/);
  assert.match(validate({ ...SETTINGS, reinstatementRedDays: 2, reinstatementPinDays: 3 }), /amber, then red, then pinned/);
  assert.match(validate({ ...SETTINGS, assignmentCarrierReps: { [CARRIER]: "nobody" } }), /one person/);
  for (const r of WINBACK_REASONS) assert.ok(typeof SETTINGS.winbackDays[r] === "number");
  assert.equal(FIELDS.holdoutShareBp.max, PLATFORM_CAPS.holdoutCeilingBp, "the ceiling is a limit, not an editable value");
});

test("5.11 · shortening the affordability cooling-off needs the typed word; switching the holdout on needs the explanation read", () => {
  const shorter = { ...SETTINGS, winbackDays: { ...SETTINGS.winbackDays, affordability: 200 } };
  assert.match(guardProblem(SETTINGS, shorter, {}), /typed confirmation/);
  assert.equal(guardProblem(SETTINGS, shorter, { confirmation: AFFORDABILITY_CONFIRMATION }), null);
  assert.equal(guardProblem(shorter, SETTINGS, {}), null, "lengthening needs nothing");
  const on = { ...SETTINGS, holdoutEnabled: true };
  assert.match(guardProblem(SETTINGS, on, {}), /Read what the holdout does/);
  assert.equal(guardProblem(SETTINGS, on, { holdoutAcknowledged: true }), null);
  assert.equal(guardProblem(on, { ...on, holdoutShareBp: 500 }, {}), null, "only switching it on needs the acknowledgement");
});

test("5.11 · the holdout explanation is fixed, and rendered above its switch", () => {
  assert.ok(Object.isFrozen(HOLDOUT_EXPLANATION) || HOLDOUT_EXPLANATION.length === 3);
  const board = read("components/app/retention/retention-settings-board.tsx");
  const explanation = board.indexOf("HOLDOUT_EXPLANATION.map");
  const toggle = board.indexOf('value={draft.holdoutEnabled ? "on" : "off"}');
  assert.ok(explanation > 0 && toggle > explanation, "the explanation renders before the switch");
  assert.match(board, /disabled=\{dis \|\| \(!saved\.holdoutEnabled && !acknowledged\)\}/, "the switch cannot be turned on before the explanation is acknowledged");
  assert.doesNotMatch(board, /HOLDOUT_EXPLANATION[^\n]*onChange/);
});

test("5.11 · every change is one audit row with from and to; resets restore platform values", () => {
  const next = { ...SETTINGS, maxCards: 50, winbackDays: { ...SETTINGS.winbackDays, unknown: 120 } };
  assert.deepEqual(diff(SETTINGS, next), [{ setting: "max_cards", from: 100, to: 50 }, { setting: "winback_unknown_days", from: 90, to: 120 }]);
  const reset = resetSection(next, "queue");
  assert.equal(reset.maxCards, 100);
  assert.equal(reset.winbackDays.unknown, 120, "a reset touches its own section only");
  assert.equal(resetSection(next, "winback").winbackDays.unknown, 90);
  assert.match(read("lib/retention/settingsHubStore.ts"), /from\("retention_setting_change"\)\.insert/);
  // LA-8.8's trigger copies those rows into the settings history.
  assert.match(read("lib/settingsAudit/settingsAudit.test.mjs"), /retention_setting_change/);
});

test("5.11 · weights: whole numbers summing to 100; a save is a new version; the preview counts band moves", () => {
  assert.equal(weightProblem(PLATFORM_DEFAULT_WEIGHTS), null);
  assert.match(weightProblem({ ...PLATFORM_DEFAULT_WEIGHTS, carrier: 12 }), /add up to 110/);
  const store = read("lib/retention/settingsHubStore.ts");
  assert.match(store, /from\("risk_weight_set"\)\.insert\(\{ tenant_id: tenantId, version,/);
  assert.match(store, /computeRadar\(tenantId, \{\}, \{ dryRun: true, weights \}\)/);
  // Saving is only possible after previewing these exact weights.
  assert.match(read("components/app/retention/retention-settings-board.tsx"), /preview\?\.for !== weightsKey/);
  const moves = bandMoves(new Map([["a", "high"], ["b", "low"], ["c", "medium"]]), new Map([["a", "critical"], ["b", "low"], ["c", "low"]]));
  assert.deepEqual([moves.moved, moves.up, moves.down, moves.intoCritical], [2, 1, 1, 1]);
});

test("5.11 · thresholds show the resulting band counts and queue volume", () => {
  const all = new Array(101).fill(0);
  const eligible = new Array(101).fill(0);
  all[80] = 38; all[60] = 104; all[30] = 290; all[10] = 1842;
  eligible[80] = 38; eligible[60] = 104;
  const c = thresholdConsequence({ all, eligible }, SETTINGS);
  assert.deepEqual(c.bands, { low: 1842, medium: 290, high: 104, critical: 38 });
  assert.equal(c.queue, 142);
  assert.equal(thresholdConsequence({ all, eligible }, { ...SETTINGS, queueMinBand: "critical" }).queue, 38);
});

test("5.11 · LA-5 reads its numbers from the settings, and the hub links carrier windows instead of editing them", () => {
  assert.match(read("app/app/(shell)/save-queue/page.tsx"), /sort=\{asked \?\? queue\.settings\.queueDefaultSort\}/);
  assert.match(read("lib/retention/queueStore.ts"), /const order = sort \?\? config\.settings\.queueDefaultSort;/);
  assert.match(read("lib/retention/signals.ts"), /settings\.carrierSampleFloor \?\? settings\.sampleFloor/);
  const board = read("components/app/retention/retention-settings-board.tsx");
  // Owner, 2026-10-28: no agency Carrier rules page; the hub says Insurvas keeps the windows.
  assert.match(board, /Insurvas keeps each carrier&apos;s retention windows/);
  assert.doesNotMatch(board, /window_days|grace_days/);
});
