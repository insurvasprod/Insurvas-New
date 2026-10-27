import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { guideHref, isManualStep, isSetupStepKey, nextSetupStep, readFoundRow, readHasPhone, setupChecklistForState, setupStepDefinitions } from "./checklist.ts";
import { ONBOARDING_COMPLETE_STATES } from "../signup/constants.ts";

test("ungated, the checklist is every owner step, labelled, and the definitions agree with it", () => {
  const checklist = setupChecklistForState("pending");
  assert.equal(checklist.total, setupStepDefinitions().length);
  assert.equal(checklist.steps.length, 17, "seventeen owner steps (the profile-only book step aside)");
  assert.equal(setupStepDefinitions().length, checklist.total);
  assert.ok(checklist.steps.every((step) => step.label.length > 0), "every step needs a label");
  assert.ok(checklist.steps.every((step) => step.key.length > 0), "every step needs a key");
});

/**
 * Owner decision 2026-10-13, "show until done": checkout writes the finished onboarding state before
 * the agency has set anything up, so a finished state must NOT tick the steps — it hid the checklist
 * from every new agency. Both spellings (`complete`, `completed`) are checked.
 */
test("a finished onboarding state alone does not tick any step", () => {
  for (const state of ONBOARDING_COMPLETE_STATES) {
    const checklist = setupChecklistForState(state);
    assert.equal(checklist.complete, false, `${state} alone should not finish setup`);
    assert.equal(checklist.completed, 0, `${state} alone should tick nothing`);
  }
});

test("a tenant still in the middle of onboarding is not marked complete", () => {
  for (const state of ["pending", "business_profile", "ready_for_checkout", "awaiting_payment"]) {
    const checklist = setupChecklistForState(state);
    assert.equal(checklist.complete, false, `${state} should not be complete`);
    assert.equal(checklist.completed, 0, `${state} should report no completed steps`);
  }
});

test("every step points somewhere more specific than the settings index", () => {
  // The steps used to all point at `/app/settings`, which renders ten tabs.
  for (const step of setupChecklistForState("pending").steps) {
    assert.notEqual(step.path, "/app/settings", `${step.key} should name its tab or owning screen`);
    assert.ok(step.path.startsWith("/app/"), `${step.key} should be an in-app destination`);
    // Found live 2026-10-06: every row said "Open settings tab", the import and lead sources too.
    assert.equal(step.action === "Open settings tab", step.path.startsWith("/app/settings#"), `${step.key}'s action names where it goes`);
  }
});

test("LA-4.6: the statement step opens the import and is done once a statement stands", () => {
  const before = setupChecklistForState("pending");
  const step = before.steps.find((item) => item.key === "statement");
  assert.equal(step.path, "/app/statements?import=1");
  assert.equal(step.complete, false);
  const after = setupChecklistForState("pending", { statementImported: true });
  assert.equal(after.steps.find((item) => item.key === "statement").complete, true);
  assert.equal(after.completed, 1, "only the step with its own signal counts");
  assert.equal(after.complete, false);
});

test("each step moves on its own durable fact, one row at a time", () => {
  const facts = {
    carriers: "carriersAdded",
    statement: "statementImported",
    appointments: "appointmentsConfirmed",
    "lead-sources": "leadSourcesAdded",
    phone: "phoneAdded",
    team: "teamInvited",
    import: "leadsImported",
    "calling-windows": "callingWindowsSet",
    assign: "leadsAssigned",
    outcomes: "outcomesMapped",
    "queue-sla": "queueSlaSet",
    "sales-carriers": "salesCarriersSet",
    disclosures: "disclosuresPublished",
    retention: "retentionSet",
    compliance: "complianceSet",
    accounting: "accountingSet",
    hierarchy: "hierarchySet",
  };
  assert.deepEqual(Object.keys(facts).sort(), setupStepDefinitions().map((step) => step.key).sort(), "every step has a fact");
  for (const [key, field] of Object.entries(facts)) {
    const checklist = setupChecklistForState("pending", { [field]: true });
    assert.equal(checklist.completed, 1, `${field} completes one step`);
    assert.equal(checklist.steps.find((step) => step.key === key).complete, true, `${field} completes ${key}`);
    assert.equal(checklist.complete, false);
  }
  const partway = setupChecklistForState("pending", { carriersAdded: true, statementImported: true, leadSourcesAdded: true });
  assert.equal(partway.completed, 3);
  assert.equal(partway.steps.find((step) => !step.complete).key, "appointments", "the next step is the first undone row");
  const all = setupChecklistForState("pending", Object.fromEntries(Object.values(facts).map((field) => [field, true])));
  assert.equal(all.complete, true, "every fact proven completes setup before onboarding says so");
  assert.equal(all.completed, all.total);
});

test("only a true fact counts; a missing, false or truthy-but-not-true value does not", () => {
  for (const value of [undefined, false, null, 1, "yes"]) {
    assert.equal(setupChecklistForState("pending", { carriersAdded: value }).completed, 0, `${String(value)} is not proof`);
  }
});

test("LA-0.3: once stamped finished, the checklist stays done whatever the steps say", () => {
  const stamped = setupChecklistForState("pending", { finished: true, carriersAdded: false, phoneAdded: false });
  assert.equal(stamped.complete, true, "does not come back");
  assert.equal(stamped.completed, stamped.total);
  assert.equal(setupChecklistForState("complete", { carriersAdded: true }).complete, false, "not stamped: the steps decide");
});

test("a read that errors or finds nothing leaves its step undone", () => {
  assert.equal(readFoundRow({ data: [{ id: "a" }], error: null }), true);
  assert.equal(readFoundRow({ data: [], error: null }), false, "no row");
  assert.equal(readFoundRow({ data: null, error: null }), false, "maybeSingle with no row");
  assert.equal(readFoundRow({ data: [{ id: "a" }], error: { code: "42P01" } }), false, "a table not migrated yet");
  assert.equal(readFoundRow(null), false);
  assert.equal(readFoundRow(undefined), false);
  assert.equal(readHasPhone({ data: { support_phone: "(555) 010-2000" }, error: null }), true);
  assert.equal(readHasPhone({ data: { support_phone: "   " }, error: null }), false, "blank is no phone");
  assert.equal(readHasPhone({ data: { support_phone: null }, error: null }), false);
  assert.equal(readHasPhone({ data: null, error: null }), false);
  assert.equal(readHasPhone({ data: null, error: { code: "42703" } }), false, "the column not migrated yet");
});

test("the loader reads every fact for this tenant only, in parallel", () => {
  const source = readFileSync(join(process.cwd(), "lib", "dashboard", "setupProgress.ts"), "utf8");
  const reads = (source.match(/db\(\)\.from\("[a-z_]+"\)[^\n]*/g) ?? []).filter((read) => read.includes(".select("));
  assert.equal(reads.length, 25, "seven base reads (five facts, the finished stamp, the business profile), twelve walkthrough facts plus the two of the ready-to-sell carrier check, three member facts and the guide row, plus the statement head count in summaries");
  for (const read of reads) {
    assert.match(read, /\.eq\("(tenant_id|id)", tenantId\)/, `tenant-scoped: ${read}`);
    // The ready-to-sell check (2026-10-27) pairs a carrier's contract with its appointments, so it
    // reads the tenant's carrier ids, still bounded.
    assert.match(read, /\.limit\(1\)|\.maybeSingle\(\)|\.limit\((200|500)\)/, `an existence check or a bounded id read: ${read}`);
  }
  assert.match(source, /Promise\.all\(/);
  assert.match(source, /hasImportedStatement\(tenantId\)/);
  const page = readFileSync(join(process.cwd(), "app", "app", "(shell)", "dashboard", "page.tsx"), "utf8");
  assert.match(page, /setupChecklistForState\(onboardingState, setupProgress, \{ features: available, profile: setupProfile, seats: entitlement\.limits\.max_seats, marks: setupGuide \}\)/, "the plan (after kill switches), the profile, the seats and the reader's own marks decide the steps");
  assert.match(page, /loadSetupProfile\(context\.tenantId\)/);
});

test("LA-0.3: the stamp is written once, for this tenant, after the response", () => {
  const source = readFileSync(join(process.cwd(), "lib", "dashboard", "setupProgress.ts"), "utf8");
  assert.match(source, /update\(\{ setup_checklist_completed_at: [^}]+\}\)\.eq\("id", tenantId\)\.is\("setup_checklist_completed_at", null\)/, "only an unstamped row, so a racing render is a no-op");
  const page = readFileSync(join(process.cwd(), "app", "app", "(shell)", "dashboard", "page.tsx"), "utf8");
  assert.match(page, /if \(checklist\.complete && !setupProgress\.finished\) afterResponse\(\(\) => recordSetupFinished\(context\.tenantId\)\)/);

});

// ── Audit 2026-10-15: steps follow the plan and the business profile ──

const ALL = ["appointment_vault", "statement_ingestion", "publisher_records"];
const keys = (checklist) => checklist.steps.map((step) => step.key);

test("a step the plan cannot open is left out, so a Ledger or Pro plan can finish", () => {
  // Statements and the vault, no publisher_records (granted to the advance plan only).
  const ledger = setupChecklistForState("complete", {}, { features: ["appointment_vault", "statement_ingestion"] });
  assert.deepEqual(keys(ledger), ["carriers", "statement", "appointments", "phone"]);
  const done = setupChecklistForState("complete", { carriersAdded: true, statementImported: true, appointmentsConfirmed: true, phoneAdded: true }, { features: ["appointment_vault", "statement_ingestion"] });
  assert.equal(done.complete, true, "every step it shows can be done");
  assert.deepEqual(keys(setupChecklistForState("complete", {}, { features: [] })), ["phone"], "the owner's own tab is on every plan");
  assert.deepEqual(keys(setupChecklistForState("complete", {}, { features: ALL })), ["carriers", "statement", "appointments", "lead-sources", "phone"]);
});

test("Basic Idea 8.4: a referrals-only agency is not asked to add lead sources", () => {
  const referrals = { leadSources: ["referrals"], recommendedSetupSteps: ["Configure your product workspace"] };
  assert.ok(!keys(setupChecklistForState("complete", {}, { features: ALL, profile: referrals })).includes("lead-sources"));
  const bought = { leadSources: ["referrals", "purchased"], recommendedSetupSteps: ["Configure your product workspace", "Connect and route your lead sources"] };
  assert.ok(keys(setupChecklistForState("complete", {}, { features: ALL, profile: bought })).includes("lead-sources"));
  // Saved without recommendations: the ticked sources decide; no profile at all keeps the step.
  assert.ok(!keys(setupChecklistForState("complete", {}, { features: ALL, profile: { leadSources: ["referrals", "networking"], recommendedSetupSteps: [] } })).includes("lead-sources"));
  assert.ok(keys(setupChecklistForState("complete", {}, { features: ALL, profile: null })).includes("lead-sources"));
});

test("the saved recommendation adds the book import after the statement step, when the plan has it", () => {
  const book = { leadSources: ["existing_book"], recommendedSetupSteps: ["Configure your product workspace", "Import your existing book of business"] };
  const checklist = setupChecklistForState("complete", {}, { features: ALL, profile: book });
  assert.deepEqual(keys(checklist), ["carriers", "statement", "book", "appointments", "phone"]);
  assert.equal(checklist.steps.find((item) => item.key === "book").path, "/app/book-import");
  assert.equal(setupChecklistForState("complete", { bookImported: true }, { features: ALL, profile: book }).steps.find((item) => item.key === "book").complete, true);
  assert.ok(!keys(setupChecklistForState("complete", {}, { features: ["appointment_vault"], profile: book })).includes("book"), "no statement_ingestion, no book import");
});

test("the recommended step strings the checklist reads are the ones signup saves", async () => {
  const { deriveRecommendedSetupSteps, LEAD_SOURCE_SETUP_STEP, BOOK_IMPORT_SETUP_STEP } = await import("../signup/constants.ts");
  const saved = deriveRecommendedSetupSteps({ productsSold: ["life"], monthlyVolumeRange: "0_25", leadSources: ["purchased", "existing_book"] });
  assert.ok(saved.includes(LEAD_SOURCE_SETUP_STEP) && saved.includes(BOOK_IMPORT_SETUP_STEP));
});

// ── 2026-10-21 walkthrough: the plan decides the modules; members get their own short list ──

const INBOUND_OUTBOUND = ["lead_import", "outbound_dialing", "inbound_transfers", "book_of_business", "duplicate_detection", "callback_calendar"];
const EVERYTHING = [
  "appointment_vault", "statement_ingestion", "publisher_records", "lead_import", "outbound_dialing", "inbound_transfers",
  "book_of_business", "applications", "chargeback_radar", "tcpa_checker", "profit_and_loss", "team_hierarchy",
];
const modulesOf = (checklist) => [...new Set(checklist.steps.map((step) => step.module))];

test("an inbound-and-outbound plan walks only its agency, outbound, inbound and pipeline steps", () => {
  const checklist = setupChecklistForState("complete", {}, { features: INBOUND_OUTBOUND, seats: 5 });
  assert.deepEqual(keys(checklist), ["phone", "team", "import", "calling-windows", "assign", "outcomes", "queue-sla"]);
  for (const absent of ["carriers", "statement", "sales-carriers", "retention", "compliance", "accounting", "hierarchy"]) {
    assert.ok(!keys(checklist).includes(absent), `${absent} is not on this plan`);
  }
});

test("an outbound-only plan has no inbound step, an inbound-only plan no outbound step", () => {
  const outbound = keys(setupChecklistForState("complete", {}, { features: ["lead_import", "outbound_dialing", "book_of_business"], seats: 1 }));
  assert.deepEqual(outbound, ["phone", "import", "calling-windows", "assign", "outcomes"], "one seat: nobody to invite");
  const inbound = keys(setupChecklistForState("complete", {}, { features: ["inbound_transfers", "book_of_business"], seats: null }));
  assert.deepEqual(inbound, ["phone", "team", "outcomes", "queue-sla"], "unlimited seats: invite the team");
  assert.ok(!keys(setupChecklistForState("complete", {}, { features: ["book_of_business"] })).includes("outcomes"), "outcomes only matter to a plan that calls");
});

test("a plan with every module walks every module, in order", () => {
  const checklist = setupChecklistForState("complete", {}, { features: EVERYTHING, seats: 50 });
  assert.equal(checklist.total, 17);
  assert.deepEqual(modulesOf(checklist), ["book", "inbound", "account", "outbound", "pipeline", "sell", "retention", "compliance", "accounting", "agency"]);
  assert.ok(checklist.steps.every((step) => step.instruction.length > 0 && step.why.length > 0), "every step says what to do and why");
});

test("a skipped step is put aside: not done, not blocking, and still listed", () => {
  const context = { features: ["lead_import", "outbound_dialing"], seats: 1 };
  const skipped = setupChecklistForState("complete", { phoneAdded: true, leadsImported: true, callingWindowsSet: true }, { ...context, marks: { skipped: ["assign"] } });
  assert.equal(skipped.completed, 3);
  assert.equal(skipped.skipped, 1);
  assert.equal(skipped.complete, true, "done or skipped closes the walkthrough");
  assert.equal(skipped.steps.find((step) => step.key === "assign").complete, false);
  const doneAnyway = setupChecklistForState("complete", { leadsAssigned: true }, { ...context, marks: { skipped: ["assign"] } });
  assert.equal(doneAnyway.steps.find((step) => step.key === "assign").skipped, false, "doing a skipped step un-skips it");
  assert.equal(nextSetupStep(setupChecklistForState("complete", {}, { ...context, marks: { skipped: ["phone"] } })).key, "import", "next skips what was put aside");
});

test("a member's walkthrough follows their role, the plan and the pages hidden from them", () => {
  const member = (roles, extra = {}) => keys(setupChecklistForState("complete", {}, { features: EVERYTHING.concat("commission_ledger"), audience: "member", roles, ...extra }));
  assert.deepEqual(member(["producer"]), ["first-call", "first-transfer", "first-outcome", "ledger"]);
  assert.deepEqual(member(["setter"]), ["first-call", "first-outcome"]);
  assert.deepEqual(member(["assistant"]), ["first-transfer"]);
  assert.deepEqual(member(["bookkeeper"]), ["statements", "ledger"]);
  assert.deepEqual(member(["retention"]), [], "nothing for this role: no walkthrough");
  assert.deepEqual(member(["producer"], { hiddenPages: ["leads.dialer"] }), ["first-transfer", "ledger"], "a hidden page is no step");
  const inboundOnly = keys(setupChecklistForState("complete", {}, { features: ["inbound_transfers"], audience: "member", roles: ["producer"] }));
  assert.deepEqual(inboundOnly, ["first-transfer"], "no dialer on the plan, no call steps");
});

test("a member's own activity ticks their steps; read-only steps are ticked by the reader", () => {
  const context = { features: ["outbound_dialing", "statement_ingestion", "commission_ledger"], audience: "member", roles: ["producer", "bookkeeper"] };
  const checklist = setupChecklistForState("complete", { leadServed: true, outcomeRecorded: true }, { ...context, marks: { done: ["ledger", "first-call"] } });
  const done = Object.fromEntries(checklist.steps.map((step) => [step.key, step.complete]));
  assert.deepEqual(done, { "first-call": true, "first-outcome": true, statements: false, ledger: true });
  assert.ok(isManualStep("ledger") && isManualStep("statements"));
  assert.ok(!isManualStep("first-call") && !isManualStep("import"), "a step with a fact behind it cannot be ticked by hand");
});

test("each step opens its screen with the guide bar on, before any tab and after any query", () => {
  assert.equal(guideHref({ key: "calling-windows", path: "/app/settings#calling-windows" }), "/app/settings?guide=calling-windows#calling-windows");
  assert.equal(guideHref({ key: "statement", path: "/app/statements?import=1" }), "/app/statements?import=1&guide=statement");
  assert.equal(guideHref({ key: "import", path: "/app/import" }), "/app/import?guide=import");
  for (const key of ["carriers", "import", "first-call", "book", "ledger"]) assert.ok(isSetupStepKey(key), key);
  assert.ok(!isSetupStepKey("drop table"));
});

test("every guide target is on its screen", () => {
  const targets = {
    "carrier-library-add": "components/app/settings/carriers-settings.tsx",
    "publisher-add": "components/app/partners-workspace.tsx",
    "team-invite": "components/app/team-settings.tsx",
    "lead-import-upload": "components/app/lead-import-workspace.tsx",
    "calling-windows-save": "components/app/calling-window-settings.tsx",
    "assignments-assign": "components/app/assignment-workspace.tsx",
    "pipeline-outcomes": "components/app/settings/pipelines-outcomes.tsx",
    "queue-sla-save": "components/app/queue-sla-settings.tsx",
    "dialer-next": "components/app/dialer-workspace.tsx",
    "inbound-claim": "components/app/transfer-inbox.tsx",
    "disposition-open": "components/app/dialer-workspace.tsx",
  };
  const all = [...setupChecklistForState("pending").steps, ...setupChecklistForState("pending", {}, { audience: "member", roles: ["producer", "setter", "assistant", "bookkeeper"] }).steps];
  for (const step of all.filter((item) => item.target)) {
    assert.ok(targets[step.target], `${step.key}'s target ${step.target} is listed here`);
    const source = readFileSync(join(process.cwd(), ...targets[step.target].split("/")), "utf8");
    assert.ok(source.includes(`data-guide="${step.target}"`), `${targets[step.target]} carries data-guide="${step.target}"`);
  }
});