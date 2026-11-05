// LA-4.8 (Notion sprint) · policy ↔ CRM matching: scores, shortlist, the review payload, the ladder.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { accuracy, applicationNumberIsThePolicy, isStrong, ladderShare, MATCH_FIELDS, MATCH_WEIGHTS, phoneKey, reviewPayload, scoreCandidate, shortlist, SHORTLIST_SIZE, splitName, STRONG_SCORE, WRITING_ROLES } from "./policyMatching.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261008170000_la_4_8_policy_matching.sql");
const store = read("lib/ingestion/policyMatchingStore.ts");

const row = { policyNumber: "0057222600", carrierName: "AMAM", effectiveDate: "2026-09-02", firstName: "Ana", lastName: "Reyes", dob: "1958-03-14", phone: "(516) 555-0100", premiumCents: 5200, faceCents: 1000000 };
const nobody = { firstName: "Zed", lastName: "Quill", dob: "1990-01-01", phone: "999-999-9999", premiumCents: 100, faceCents: 1 };
const cand = (over, id = "d1") => ({ type: "deal_flow", id, contactId: "contact-777", date: "2026-09-01", ...nobody, ...over });

test("no single field can produce a match on its own", () => {
  const onlySurname = scoreCandidate(row, cand({ lastName: "Reyes" }));
  assert.equal(onlySurname.fields.surname, "match");
  assert.equal(isStrong(onlySurname), false, "a surname alone is not a match");
  const one = { surname: { lastName: "Reyes" }, givenName: { firstName: "Ana" }, dob: { dob: "1958-03-14" }, phone: { phone: "5165550100" }, premium: { premiumCents: 5200 }, face: { faceCents: 1000000 } };
  for (const field of MATCH_FIELDS) {
    const scored = scoreCandidate(row, cand(one[field]));
    assert.equal(MATCH_FIELDS.filter((f) => scored.fields[f] === "match").length, 1, `${field} alone`);
    assert.equal(isStrong(scored), false, `${field} alone is not a match`);
  }
  assert.ok(Math.max(...Object.values(MATCH_WEIGHTS)) < STRONG_SCORE / 2, "no weight is anywhere near the bar");
  const nameOnly = scoreCandidate(row, cand({ firstName: "Ana", lastName: "Reyes" }));
  assert.equal(isStrong(nameOnly), false, "a full name alone ('James Smith') is not evidence");
});

test("agreement across fields is strong", () => {
  const scored = scoreCandidate(row, cand({ firstName: "Ana", lastName: "Reyes", dob: "1958-03-14", phone: "+1 516 555 0100" }));
  assert.equal(scored.score, 85);
  assert.equal(isStrong(scored), true);
  const all = scoreCandidate(row, { ...cand({}), ...row, type: "application" });
  assert.equal(all.score, 100);
});

test("the carriers' name formats", () => {
  assert.deepEqual(splitName("MUNOZ BONILLA/ ANDREA"), { lastName: "MUNOZ BONILLA", firstName: "ANDREA" });
  assert.deepEqual(splitName("Flinchum,Brandon"), { lastName: "Flinchum", firstName: "Brandon" });
  assert.deepEqual(splitName("Andrea Munoz Bonilla"), { firstName: "Andrea", lastName: "Munoz Bonilla" });
  assert.deepEqual(splitName("Cher"), { firstName: null, lastName: "Cher" });
  assert.deepEqual(splitName("  "), { firstName: null, lastName: null });
  const compound = scoreCandidate({ ...row, lastName: "MUNOZ BONILLA", firstName: "ANDREA" }, cand({ lastName: "Bonilla", firstName: "Andréa" }));
  assert.equal(compound.fields.surname, "partial", "a shared word of a compound surname is partial");
  assert.equal(compound.fields.givenName, "match", "accents and case don't matter");
  assert.equal(scoreCandidate({ ...row, firstName: "A" }, cand({ firstName: "Ana" })).fields.givenName, "partial", "an initial is partial");
});

test("phones compare on their last ten digits; money within a dollar or 1%", () => {
  assert.equal(phoneKey("+1 (516) 555-0100"), "5165550100");
  assert.equal(phoneKey("555"), null);
  assert.equal(scoreCandidate(row, cand({ premiumCents: 5250 })).fields.premium, "match");
  assert.equal(scoreCandidate(row, cand({ premiumCents: 5400 })).fields.premium, "mismatch");
  assert.equal(scoreCandidate(row, cand({ premiumCents: null })).fields.premium, "missing");
});

test("the shortlist: best first, capped, nobody with nothing in common", () => {
  const pool = [cand({}, "none"), ...Array.from({ length: 8 }, (_, i) => cand({ lastName: "Reyes", dob: i < 2 ? "1958-03-14" : null }, `r${i}`))];
  const list = shortlist(row, pool);
  assert.equal(list.length, SHORTLIST_SIZE);
  assert.ok(!list.some((s) => s.candidate.id === "none"));
  assert.deepEqual(list.slice(0, 2).map((s) => s.candidate.id), ["r0", "r1"]);
  assert.ok(list.every((s, i) => i === 0 || list[i - 1].score >= s.score));
});

test("the review payload: compared fields of shortlisted candidates only — no SSN, bank or full record", () => {
  const leaky = { ...cand({ firstName: "Ana", lastName: "Reyes" }), ssn: "123-45-6789", routing_number: "021000021", account_number: "000123", email: "ana@example.com", address: "1 Main St", notes: "private" };
  const payload = reviewPayload({ ...row, ssn: "123-45-6789" }, shortlist(row, [leaky]));
  const text = JSON.stringify(payload);
  for (const banned of ["123-45-6789", "021000021", "000123", "ana@example.com", "1 Main St", "private", "ssn", "routing", "account", "email", "address", "contactId", "contact-777"]) {
    assert.ok(!text.includes(banned), `the payload must not carry ${banned}`);
  }
  assert.deepEqual(Object.keys(payload.carrier_row).sort(), ["carrier", "dob", "effective_date", "face_cents", "first_name", "last_name", "phone", "policy_number", "premium_cents"]);
  assert.deepEqual(Object.keys(payload.candidates[0]).sort(), ["date", "dob", "face_cents", "fields", "first_name", "last_name", "phone", "premium_cents", "ref", "score", "type"]);
  assert.equal(reviewPayload(row, []).candidates.length, 0, "no shortlist, no candidates");
});

test("the ladder share and the accuracy against people", () => {
  const share = ladderShare([{ alreadyLinked: 6, exactLinked: 3, toReview: 1 }, { alreadyLinked: 0, exactLinked: 0, toReview: 0 }]);
  assert.deepEqual([share.all, share.alreadyLinkedPct, share.exactLinkedPct, share.toReviewPct], [10, 60, 30, 10]);
  assert.equal(ladderShare([]).toReviewPct, null);
  assert.deepEqual(accuracy([{ confirmed: true, correctedByHuman: false }, { confirmed: false, correctedByHuman: true }, { confirmed: false, correctedByHuman: false }]), { reviewed: 2, correct: 1, pct: 50 });
  assert.equal(accuracy([]).pct, null);
});

test("the migration: append-only links, every link says how, AI links say which model", () => {
  assert.match(sql, /create trigger policy_match_guard before update or delete on public\.policy_match/);
  assert.match(sql, /constraint policy_match_ai_is_explained check \(method <> 'ai_review' or \(model_id is not null and prompt_version is not null and confidence is not null and reasoning is not null\)\)/);
  assert.match(sql, /constraint policy_match_only_ai_has_a_model check/);
  assert.match(sql, /method text not null/);
  assert.match(sql, /create unique index if not exists policy_match_current_key on public\.policy_match \(tenant_id, carrier_id, policy_number\) where superseded_by_id is null/);
  assert.match(sql, /update public\.policy_match set superseded_by_id = v_id/, "a correction supersedes");
  assert.match(sql, /grant select on public\.policy_match to service_role;/, "the app cannot write links except through the function");
  assert.doesNotMatch(sql, /grant[^;]*insert[^;]*on public\.policy_match to/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.policy_match from service_role, tenant_app;/, "Supabase grants service_role everything by default; the writes must be taken back (the first apply failed on this)");
});

test("agent codes resolve exactly — never fuzzily", () => {
  assert.match(sql, /am\.agent_identifier = c\.agent_identifier/);
  assert.match(sql, /constraint carrier_agent_map_key unique \(tenant_id, carrier_id, agent_identifier\)/);
  for (const source of [sql, store]) assert.doesNotMatch(source, /levenshtein|similarity\(|soundex|metaphone|ilike|% ?'|trgm/i);
});

test("the ladder runs cheapest first and calls no AI", () => {
  const exact = store.indexOf("async function linkExact"), review = store.indexOf("async function queueReviews"), run = store.indexOf("export async function matchFilePolicies");
  assert.ok(exact > 0 && review > exact && run > review);
  const body = store.slice(run, store.indexOf("export type MatchingScope"));
  assert.ok(body.indexOf("linkExact(") < body.indexOf("queueReviews("), "exact links before the review queue");
  assert.match(store, /method: "submission_record", ladder_step: 2/);
  assert.match(store, /method: "policy_number_exact", ladder_step: 2/);
  assert.doesNotMatch(store, /anthropic|openai|fetch\(/i, "no AI call until a provider is configured");
  assert.doesNotMatch(store, /method: "ai_review"/, "and no AI link is written");
  const snapshots = read("lib/ingestion/snapshotStore.ts");
  assert.ok(snapshots.indexOf("matchFilePolicies(") > 0 && snapshots.indexOf("matchFilePolicies(") < snapshots.indexOf("await refreshPolicyCurrent("), "matched before policy_current is refreshed");
});

test("the re-created refresh is 4.7's, plus exactly the three LA-4.8 links", () => {
  const fn = (text) => text.replace(/\r\n/g, "\n").match(/create or replace function public\.refresh_policy_current\([\s\S]*?\ngrant execute on function public\.refresh_policy_current\([^\n]*/)[0];
  const v47 = fn(read("supabase/migrations/20261008160000_la_4_7_policy_current.sql"));
  const undone = fn(sql)
    .replace("    contact_id, household_id, agent_user_id, application_id, case_id, campaign_id, vendor_id,\n", "    application_id, case_id, campaign_id, vendor_id,\n")
    .replace("         pm.contact_id, ct.household_id, am.user_id, app.id, app.case_id, cs.campaign_id, cs.vendor_id,\n", "         sub.application_id, app.case_id, cs.campaign_id, cs.vendor_id,\n")
    .replace(/    -- LA-4\.8: the policy's current link[^\n]*\n    left join public\.policy_match pm[^\n]*\n    left join public\.contacts ct[^\n]*\n    left join public\.carrier_agent_map am[^\n]*\n    left join public\.tenant_applications app on app\.id = coalesce\(sub\.application_id, case when pm\.matched_to_type = 'application' then pm\.matched_to_id end\)\n/, "    left join public.tenant_applications app on app.id = sub.application_id\n");
  assert.equal(undone, v47);
});
test("an agent code maps only to someone who writes business, in the list and on the server", () => {
  assert.deepEqual([...WRITING_ROLES].sort(), ["owner", "producer"]);
  assert.match(store, /accepted_at && WRITING_ROLES\.includes\(row\.role\)/);
  assert.match(store, /if \(!WRITING_ROLES\.includes\(member\.role\)\) throw new MatchingError/);
});

test("a file's unmatched policies are matched side by side, one person's in order, with no refresh per policy", () => {
  const queues = read("lib/ingestion/exceptionQueuesStore.ts");
  // The chunk's current rows are refreshed once by the file stage (snapshotStore.linkFilePolicies), not per policy here.
  assert.match(store, /await queueReviews\(tenantId, carrier, rest, fileId, \{ refreshCurrent: false \}\)/);
  assert.match(store, /noRecordPolicy\(tenantId, policySide\(snapshot, carrier\), agent, \{ refreshCurrent: options\.refreshCurrent \}\)/);
  assert.match(queues, /if \(options\.refreshCurrent !== false\) await refreshPolicyCurrent\(/);
  assert.match(read("lib/ingestion/snapshotStore.ts"), /await matchFilePolicies\(tenantId, input\.carrierId, fileId, chunk\);[\s\S]{0,200}await refreshPolicyCurrent\(\{ tenantId, carrierId: input\.carrierId, policies: chunk \}\)/);
  // A reopened match and a person's choice still refresh their one policy.
  assert.match(store, /await queueReviews\(scope\.tenantId, await carrierOf\(match\.carrier_id\), \[match\.policy_number\], null, \{ reviewEvenIfEmpty: true \}\)/);
  // One person's policies in one group, so the second finds the client the first created.
  assert.match(store, /const key = identityKey\(side\) \?\? \(name \? `name:\$\{name\}` : `policy:\$\{policy\}`\);/);
  assert.match(store, /for \(let group = queue\.shift\(\); group; group = queue\.shift\(\)\) for \(const policy of group\) await work\(policy, snapshots\.get\(policy\)!\);/);
  // The queues' existence is asked once per process, not once per policy.
  assert.match(queues, /if \(!queuesReady\) \{/);
});

test("an application number links as the policy only when the insured is the same person (QA 2026-11-03)", () => {
  const app = { lastName: "Testmore", dob: "1960-08-21" };
  assert.equal(applicationNumberIsThePolicy({ lastName: "TESTMORE", dob: "1960-08-21" }, app), true, "case and spacing don't matter");
  assert.equal(applicationNumberIsThePolicy({ lastName: "O'Testmore", dob: "1960-08-21" }, app), false, "another surname");
  assert.equal(applicationNumberIsThePolicy({ lastName: "TESTMORE", dob: "1961-08-21" }, app), false, "another date of birth");
  assert.equal(applicationNumberIsThePolicy({ lastName: "TESTMORE", dob: null }, app), false, "no date of birth and no first name on the carrier's row");
  // Real files 2026-10-01: Aetna, Aflac, AHL, Americo and Sentinel carry no birth date; the full first name then has to agree.
  const named = { ...app, firstName: "Quinn" };
  assert.equal(applicationNumberIsThePolicy({ lastName: "TESTMORE", firstName: "QUINN", dob: null }, named), true, "no birth date: surname and first name");
  assert.equal(applicationNumberIsThePolicy({ lastName: "TESTMORE", firstName: "Quinn A", dob: null }, named), true, "a middle name after the first is fine");
  assert.equal(applicationNumberIsThePolicy({ lastName: "TESTMORE", firstName: "Q", dob: null }, named), false, "an initial is not enough");
  assert.equal(applicationNumberIsThePolicy({ lastName: "TESTMORE", firstName: "Dana", dob: null }, named), false, "another first name");
  assert.equal(applicationNumberIsThePolicy({ lastName: "TESTMORE", firstName: "QUINN", dob: "1961-08-21" }, named), false, "a birth date that disagrees still refuses, whatever the name");
  assert.equal(applicationNumberIsThePolicy({ lastName: null, dob: "1960-08-21" }, { lastName: null, dob: "1960-08-21" }), false, "no surname on either side");
  const store = readFileSync(new URL("./policyMatchingStore.ts", import.meta.url), "utf8");
  assert.match(store, /\.eq\("reference_kind", "application_no"\)\.in\("carrier_reference", policies\)/);
  assert.match(store, /applicationNumberIsThePolicy\(carrierSide\(snapshot, ""\), person\)/);
});
test("a person's sale link carries the sale's one open application with the carrier (QA 2026-11-03, 0119990010)", async () => {
  const { saleApplicationFor } = await import("./policyMatching.ts");
  const AMAM = "carrier-amam";
  assert.equal(saleApplicationFor([{ id: "a1", carrierId: AMAM, status: "submitted" }], AMAM), "a1");
  assert.equal(saleApplicationFor([{ id: "a1", carrierId: AMAM, status: "pending_carrier" }, { id: "a0", carrierId: AMAM, status: "closed" }], AMAM), "a1", "a closed attempt is not a second candidate");
  assert.equal(saleApplicationFor([{ id: "a1", carrierId: AMAM, status: "submitted" }, { id: "a2", carrierId: AMAM, status: "submitted" }], AMAM), null, "two that could each be it: the sale, not a guess");
  assert.equal(saleApplicationFor([{ id: "a1", carrierId: "other", status: "submitted" }], AMAM), null, "another carrier's application");
  assert.equal(saleApplicationFor([{ id: "a1", carrierId: AMAM, status: "draft" }], AMAM), null, "never submitted");
  assert.equal(saleApplicationFor([], AMAM), null);

  const store = readFileSync(new URL("./policyMatchingStore.ts", import.meta.url), "utf8");
  // The sale's client, never the stand-in made from the carrier's row.
  assert.match(store, /const contactId = \(await clientForLead\(tenantId, deal\.lead_id\)\) \?\? fallbackContactId;/);
  assert.match(store, /applicationId \? \{ matched_to_type: "application", matched_to_id: applicationId, contact_id: contactId \} : \{ matched_to_type: "deal_flow", matched_to_id: deal\.id, contact_id: contactId \}/);
  // The review queue's sale pick goes through it too, and the issue path runs after the link.
  assert.match(store, /entry\.type === "deal_flow" \? await saleLink\(scope\.tenantId, review\.carrier_id, entry\.id, entry\.contactId \?\? null\) : null/);
  assert.match(store, /await recordCarrierIssues\(scope\.tenantId, review\.carrier_id, \[review\.policy_number\]\);/);

  const queues = readFileSync(new URL("./exceptionQueuesStore.ts", import.meta.url), "utf8");
  // "Link it to a sale…" (no_deal_flow · found_the_sale) and "found the policy" (no_policy) both use it.
  assert.match(queues, /saleLink\(scope\.tenantId, item\.carrier_id, input\.dealId, item\.contact_id\)/);
  assert.match(queues, /await link\(scope\.tenantId, item\.carrier_id, item\.policy_number, \{ \.\.\.human, \.\.\.sale\.match \}\);\n\s+await retireProvisional\(scope\.tenantId, item\.contact_id, sale\.match\.contact_id\);/);
  assert.match(queues, /saleLink\(scope\.tenantId, input\.carrierId, item\.deal_id, deal\.contactId\)/);
  // After the refresh, the carrier's issue closes the application (as the file pipeline does).
  assert.match(queues, /await refreshPolicyCurrent\(\{ tenantId: scope\.tenantId, carrierId: item\.carrier_id, policies: \[item\.policy_number\] \}\);\n\s+\/\/ .*\n\s+await recordCarrierIssues\(scope\.tenantId, item\.carrier_id, \[item\.policy_number\]\);/);
  assert.match(queues, /await recordCarrierIssues\(scope\.tenantId, input\.carrierId, \[number\]\);/);
  // Loaded on demand: policyMatchingStore imports exceptionQueuesStore, so a static import would be a cycle.
  assert.doesNotMatch(queues, /^import .*from "\.\/policyMatchingStore"/m);
});

test("\"Link it to a sale…\" ranks the sales against the carrier's row, best first, then the rest by recency (QA 2026-11-03)", async () => {
  const { carrierSideOfPayload, matchWhy, rankSaleChoices } = await import("./policyMatching.ts");
  const carrier = carrierSideOfPayload({ insured: { first_name: "QUINN", last_name: "TESTMORE", dob: "1960-08-21" }, premium_cents: 4500, face_cents: 1500000 }, "0119990010", "American Amicable");
  assert.deepEqual([carrier.firstName, carrier.lastName, carrier.dob, carrier.premiumCents, carrier.faceCents], ["QUINN", "TESTMORE", "1960-08-21", 4500, 1500000]);
  assert.equal(carrierSideOfPayload({}, "1", "x"), null, "no insured on the item: nothing to rank by");

  const sale = (id, date, over) => ({ type: "deal_flow", id, contactId: null, date, name: id, ...nobody, ...over });
  // Newest first, as read; Quinn is NOT the newest here.
  const sales = [
    sale("newest", "2026-11-04", {}),
    sale("same-surname", "2026-11-03", { lastName: "Testmore" }),
    sale("quinn", "2026-11-02", { firstName: "Quinn", lastName: "Testmore", dob: "1960-08-21", premiumCents: 4500, faceCents: 1500000 }),
    sale("older", "2026-10-01", {}),
    sale("same-money", "2026-09-01", { premiumCents: 4500, faceCents: 1500000 }),
  ];
  const ranked = rankSaleChoices(carrier, sales);
  assert.deepEqual(ranked.map((c) => c.id), ["quinn", "same-surname", "newest", "older", "same-money"], "scored on the person first, then the rest newest first; money alone moves nothing up");
  assert.equal(ranked[0].why, "Matches surname, born, first name", "the strongest agreeing fields, briefly");
  assert.equal(ranked[1].why, "Matches surname");
  assert.equal(ranked[2].why, undefined, "an unranked sale says nothing");
  assert.deepEqual(rankSaleChoices(null, sales).map((c) => c.id), ["newest", "same-surname", "quinn", "older", "same-money"], "no carrier row: recency, as before");
  assert.equal(rankSaleChoices(carrier, sales, 2).length, 2);
  assert.equal(matchWhy({ fields: { surname: "mismatch", givenName: "missing", dob: "missing", phone: "missing", premium: "missing", face: "missing" } }), null);

  const store = readFileSync(new URL("./policyMatchingStore.ts", import.meta.url), "utf8");
  assert.match(store, /export async function saleChoicesFor\(tenantId: string, row: CarrierSide \| null, limit = 25\): Promise<SaleChoice\[\]>/);
  assert.match(store, /return rankSaleChoices\(row, sales, limit\);/);
  const needsYou = readFileSync(new URL("../needsYou/store.ts", import.meta.url), "utf8");
  assert.match(needsYou, /saleChoicesFor\(t, carrierSideOfPayload\(i\.payload, i\.policy_number, /);
  const picker = readFileSync(new URL("../../components/app/book/needs-you/review-workspace.tsx", import.meta.url), "utf8");
  assert.match(picker, /hint: `\$\{d\.why \? `\$\{d\.why\} · ` : ""\}sale of \$\{fileDay\(d\.date\)\}`/);
});
