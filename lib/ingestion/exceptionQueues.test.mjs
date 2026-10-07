// LA-4.9 (Notion sprint) · the three exception queues and role-based ownership.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ageDays, ageLabel, ageTone, DEFAULT_RULES, effectiveRules, identityKey, QUEUE_TYPES, RESOLUTIONS, ROLE_SOURCE } from "./exceptionQueues.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261008180000_la_4_9_exception_queues.sql");
const store = read("lib/ingestion/exceptionQueuesStore.ts");
const matching = read("lib/ingestion/policyMatchingStore.ts");

test("defaults: queues 1 and 2 to the writing agent, queue 3 to operations; a solo agent configures nothing", () => {
  assert.equal(DEFAULT_RULES.no_deal_flow.ownerRole, "writing_agent");
  assert.equal(DEFAULT_RULES.no_policy.ownerRole, "writing_agent");
  assert.equal(DEFAULT_RULES.multi_policy.ownerRole, "operations");
  assert.deepEqual([DEFAULT_RULES.no_policy.openAfterDays, DEFAULT_RULES.no_policy.escalateAfterDays], [5, 10]);
  assert.deepEqual(effectiveRules([]), DEFAULT_RULES, "no rows → the defaults");
  const mine = effectiveRules([{ queueType: "no_policy", ownerRole: "operations", openAfterDays: 7 }]);
  assert.deepEqual(mine.no_policy, { queueType: "no_policy", ownerRole: "operations", openAfterDays: 7, escalateAfterDays: 10, escalateToRole: null });
  assert.deepEqual(mine.no_deal_flow, DEFAULT_RULES.no_deal_flow, "other queues keep their defaults");
});

test("the SQL holds the same defaults and role sources", () => {
  assert.match(sql, /case p_queue_type when 'multi_policy' then 'operations'[^;]*else 'writing_agent' end/);
  assert.match(sql, /r\.queue_type = 'no_policy'\), 5\) as open_after/);
  assert.match(sql, /case q\.queue_type when 'no_policy' then 10 end/);
  for (const [role, tenantRole] of Object.entries(ROLE_SOURCE)) {
    if (role !== "admin") assert.match(sql, new RegExp(`when '${role}' then '${tenantRole}'`), `${role} draws from ${tenantRole}`);
  }
});

test("no item can exist without an owner; a role with nobody in it falls back to the owner", () => {
  assert.match(sql, /assigned_to_user_id uuid not null/);
  assert.match(sql, /-- Nobody in that role \(or the agent is unknown\): the agency's owner, never nobody\./);
  assert.match(sql, /tu\.role::text = 'owner' and u\.status = 'active'/);
  assert.match(sql, /raise exception 'queue_owner: agency % has no active owner/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.queue_item from service_role, tenant_app;/, "items are written only by their functions (Supabase grants service_role everything by default)");
});

test("every item shows its age; queue 2 escalates past the second threshold", () => {
  assert.equal(ageDays("2026-10-01", "2026-10-07"), 6);
  assert.equal(ageDays("2026-10-08", "2026-10-07"), 0);
  assert.deepEqual([ageLabel(0), ageLabel(1), ageLabel(12)], ["today", "1 day", "12 days"]);
  assert.equal(ageTone(9, DEFAULT_RULES.no_policy, false), "aging");
  assert.equal(ageTone(10, DEFAULT_RULES.no_policy, false), "escalated");
  assert.equal(ageTone(1, DEFAULT_RULES.no_deal_flow, true), "escalated", "an escalated item stays escalated");
  assert.equal(ageTone(1, DEFAULT_RULES.multi_policy, false), "fresh");
  assert.match(read("components/app/exception-queues.tsx"), /text-base font-semibold tabular-nums/, "the age is the first, largest thing on each row");
});

test("the same person needs nobody only on an exact first name, last name and date of birth", () => {
  assert.equal(identityKey({ firstName: "José", lastName: "Reyes", dob: "1958-03-14" }), identityKey({ firstName: "jose", lastName: "REYES", dob: "1958-03-14" }));
  assert.equal(identityKey({ firstName: "Jose", lastName: "Reyes", dob: null }), null, "no date of birth, no certainty");
  assert.equal(identityKey({ firstName: null, lastName: "Reyes", dob: "1958-03-14" }), null);
  assert.notEqual(identityKey({ firstName: "Jose", lastName: "Reyes", dob: "1958-03-14" }), identityKey({ firstName: "Jose", lastName: "Reyes", dob: "1958-03-15" }));
  const husband = identityKey({ firstName: "Carlos", lastName: "Reyes", dob: "1956-01-02" }), wife = identityKey({ firstName: "Maria", lastName: "Reyes", dob: "1958-03-14" });
  assert.notEqual(husband, wife, "spouses are two people");
  assert.match(store, /if \(existing\.length === 1\) \{/, "one exact match or none: never pick between two");
  assert.match(store, /method: "identity_exact"/);
});

test("a policy with no match gets a provisional client from the carrier's own data, and one queue-1 item", () => {
  assert.match(store, /db\(\)\.rpc\("save_contact"/, "through the normal contact path, so a shared address joins the household");
  assert.match(store, /p_address_hash: addressHash\(input\)/);
  assert.match(store, /provisional: true,\s+provisional_source: \{ kind: "carrier_policy"/);
  assert.match(store, /method: "no_match", ladder_step: 3/);
  assert.match(store, /queueType: "no_deal_flow", subjectKey: `policy:\$\{side\.carrierId\}:\$\{side\.policyNumber\}`/);
  assert.match(matching, /if \(!listed\.length && !options\.reviewEvenIfEmpty && \(await noRecordPolicy\(/, "an empty shortlist is not a review");
  assert.match(matching, /reviewEvenIfEmpty: true/, "a person reopening a link still gets a review");
  assert.match(store, /if \(isSchemaGap\(probe\.error\)\) return null;/, "before the migration nothing is created");
  assert.match(store, /if \(error && error\.code === "23503"\) \{[\s\S]*?contactId = null;[\s\S]*?blocked = /, "an agency whose contacts can't take a new record still gets the item, with the reason (live: 556 agencies lack the legacy organization row)");
  assert.match(store, /client_blocked: blocked/);
});

test("a provisional client is marked wherever it appears until confirmed", () => {
  assert.match(read("lib/contacts/service.ts"), /provisional: provisional\.has\(row\.id\)/);
  assert.match(read("components/app/contact-workspace.tsx"), /\{row\.provisional && <ProvisionalBadge/);
  assert.match(read("components/app/exception-queues.tsx"), /person\.provisional && <ProvisionalBadge \/>/);
  assert.match(read("lib/contacts/csv.ts"), /"provisional"\];/);
  assert.match(read("lib/ingestion/policyMatchingStore.ts"), /\(provisional\)/);
  assert.match(store, /provisional: false, provisional_confirmed_at:/, "confirming clears it, with who and when");
});

test("queue 2: only once we hold the carrier's later file; never submitted reaches the LA-2.17 funnel", () => {
  assert.match(sql, /d\.call_result = 'application_submitted' and d\.status = 'completed'/);
  assert.match(sql, /f\.file_type = 'policies'\s+and f\.status = 'parsed' and f\.file_date >= x\.local_date \+ x\.open_after/);
  assert.match(sql, /set status = 'abandoned', outcome_reason_code = 'never_submitted', outcome_reason_text = p_reason/);
  assert.match(read("supabase/migrations/20260925709800_scorecard_funnel_drill_and_speed.sql"), /status <> 'abandoned'/, "the funnel's applied step excludes abandoned cases");
  assert.match(sql, /and not exists \(select 1 from public\.queue_item q where q\.tenant_id = x\.tenant_id and q\.queue_type = 'no_policy' and q\.subject_key = 'deal:' \|\| x\.id::text\)/, "a closed item is not reopened");
  assert.match(sql, /tu\.role::text in \('owner', 'producer'\)/, "a writing agent owns an item only if they can open the screen; otherwise the owner does");
});

test("each queue has its own resolutions, and every resolution records who and what", () => {
  assert.deepEqual(QUEUE_TYPES, ["no_deal_flow", "no_policy", "multi_policy", "initial_import"]);
  assert.deepEqual([...RESOLUTIONS.no_policy], ["found_the_policy", "never_submitted", "resubmitted_elsewhere", "not_mine"]);
  assert.match(sql, /resolved_by = p_user_id, resolved_at = now\(\)/);
  assert.match(sql, /constraint queue_item_closed check \(\(status = 'open'\) = \(resolved_at is null\) and \(status = 'open' or resolution is not null\)\)/);
  assert.match(read("app/api/app/exceptions/route.ts"), /action: done\.resolution === "not_mine" \? "queue_item\.handed_on" : "queue_item\.resolved"/);
});

test("two more honest link methods, both step 3 with no confidence", () => {
  assert.match(sql, /check \(method in \('policy_number_exact', 'submission_record', 'ai_review', 'human', 'import', 'no_match', 'identity_exact'\)\)/);
  assert.match(sql, /check \(method not in \('no_match', 'identity_exact'\) or \(ladder_step = 3 and confidence is null and contact_id is not null\)\)/);
});

test("every request shape parses, and a wrong one is refused", async () => {
  const { exceptionsRequest } = await import("./exceptionsRequest.ts");
  const id = "11111111-0000-4000-8000-000000000001";
  const ok = [
    { action: "resolve", item_id: id, resolution: "confirm_client" },
    { action: "resolve", item_id: id, resolution: "not_mine" },
    { action: "resolve", item_id: id, resolution: "same_person" },
    { action: "resolve", item_id: id, resolution: "different_people" },
    { action: "resolve", item_id: id, resolution: "reviewed" },
    { action: "resolve", item_id: id, resolution: "link_existing_client", contact_id: id },
    { action: "resolve", item_id: id, resolution: "found_the_sale", deal_id: id },
    { action: "resolve", item_id: id, resolution: "found_the_policy", carrier_id: id, policy_number: "0057222600" },
    { action: "resolve", item_id: id, resolution: "never_submitted", reason: "Client stopped answering" },
    { action: "resolve", item_id: id, resolution: "resubmitted_elsewhere", application_id: id },
    { action: "save_rule", queue_type: "no_policy", owner_role: "operations", open_after_days: 7, escalate_after_days: 14, escalate_to_role: "admin" },
  ];
  for (const body of ok) assert.equal(exceptionsRequest.safeParse(body).success, true, JSON.stringify(body));
  for (const r of Object.values(RESOLUTIONS).flat()) assert.ok(ok.some((b) => b.resolution === r), `${r} has a request shape`);
  const bad = [
    { action: "resolve", item_id: id, resolution: "never_submitted", reason: "  " },
    { action: "resolve", item_id: id, resolution: "link_existing_client" },
    { action: "resolve", item_id: "nope", resolution: "confirm_client" },
    { action: "resolve", item_id: id, resolution: "confirm_client", extra: 1 },
    { action: "resolve", item_id: id, resolution: "merge_everything" },
    { action: "save_rule", queue_type: "no_policy", owner_role: "anyone", open_after_days: null, escalate_after_days: null, escalate_to_role: null },
  ];
  for (const body of bad) assert.equal(exceptionsRequest.safeParse(body).success, false, JSON.stringify(body));
});
test("a provisional contact must say where it came from (follow-up 20261008180100)", () => {
  const fix = read("supabase/migrations/20261008180100_la_4_9_provisional_needs_its_source.sql");
  assert.match(fix, /check \(not provisional or \(provisional_source is not null and jsonb_typeof\(provisional_source\) = 'object'\)\)/, "jsonb_typeof(null) is null, and a CHECK lets null through — the source has to be required outright");
});