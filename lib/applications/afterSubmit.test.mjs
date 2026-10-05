// LA-3.15 / 3.18 / 3.20 / 3.24 / 3.26 — the after-submit rules that need no database. Each test is
// a line from the sprint task (docs/la3/ACCEPTANCE.md).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const R = await import("./afterSubmitRules.ts");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const MINUS = "−";

test("3.15: only PNG, JPEG and PDF are accepted, up to 10 MB, and the bytes must agree", () => {
  assert.equal(R.confirmationExtension("image/png"), "png");
  assert.equal(R.confirmationExtension("image/jpeg"), "jpg");
  assert.equal(R.confirmationExtension("application/pdf"), "pdf");
  assert.equal(R.confirmationExtension("image/webp"), null);
  assert.equal(R.confirmationExtension("application/x-msdownload"), null);
  assert.equal(R.MAX_CONFIRMATION_BYTES, 10 * 1024 * 1024);
  assert.equal(R.magicMatches("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])), true);
  assert.equal(R.magicMatches("png", new Uint8Array([0x4d, 0x5a, 0x90, 0x00])), false);
  assert.equal(R.magicMatches("pdf", new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(R.magicMatches("jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
});

test("3.15: the storage path is <tenant>/<application>/<submission>.<ext> — the shape the CHECK enforces", () => {
  assert.equal(R.confirmationPath("t1", "a1", "s1", "png"), "t1/a1/s1.png");
  assert.equal(R.welcomePackPath("t1", "a1", 2), "t1/a1/welcome-pack-2.pdf");
  assert.equal(R.welcomePackPath("t1", "a1", 2, 3), "t1/a1/welcome-pack-2-v3.pdf");
});

test("3.15: a reference failing the carrier's pattern warns (mismatch) and never errors", () => {
  assert.equal(R.referencePatternCheck("^GL-\\d{8}$", "GL-40771902"), "match");
  assert.equal(R.referencePatternCheck("GL-\\d{8}", "gl-40771902"), "match");
  assert.equal(R.referencePatternCheck("^GL-\\d{8}$", "GL-4077"), "mismatch");
  assert.equal(R.referencePatternCheck("([", "anything"), "unknown");
  assert.equal(R.referencePatternCheck(null, "GL-1"), "unknown");
  assert.equal(R.patternExample("^GL-\\d{8}$"), "GL-00000000");
  assert.equal(R.patternExample("^[A-Z]{2}\\d{6}$"), "AA000000");
  assert.equal(R.patternExample("^\\w+$"), null);
});

test("3.18: pending sorts waiting on the client first, then oldest", () => {
  const rows = [
    { id: "a", waitingOn: "carrier", raisedAt: "2026-09-01" },
    { id: "b", waitingOn: "client", raisedAt: "2026-09-20" },
    { id: "c", waitingOn: "client", raisedAt: "2026-09-10" },
    { id: "d", waitingOn: "third_party", raisedAt: "2026-08-30" },
  ];
  assert.deepEqual(R.sortPending(rows).map((r) => r.id), ["c", "b", "d", "a"]);
});

test("3.18: ageing is amber at N days and red at 2N, with the tenant's N", () => {
  assert.equal(R.ageingOf(4, 5), "ok");
  assert.equal(R.ageingOf(5, 5), "amber");
  assert.equal(R.ageingOf(9, 5), "amber");
  assert.equal(R.ageingOf(10, 5), "red");
  assert.equal(R.ageingOf(3, 3), "amber");
  assert.equal(R.ageingOf(6, 3), "red");
  const now = Date.parse("2026-09-29T12:00:00");
  assert.equal(R.daysOpen("2026-09-18", now), 11);
});

test("3.26: the delta shows dollars and percent for face and premium, with no float drift", () => {
  const d = R.counterofferDelta(
    { tier: "level", healthClass: "Standard", faceCents: 1_500_000, monthlyCents: 7_120 },
    { tier: "graded", healthClass: "Graded", faceCents: 1_000_000, monthlyCents: 5_840 },
  );
  assert.equal(d.faceCents, -500_000);
  assert.equal(d.monthlyCents, -1_280);
  assert.equal(d.face, `${MINUS}$5,000`);
  assert.equal(d.monthly, `${MINUS}$12.80`);
  assert.equal(d.facePercent, `${MINUS}33.3%`);
  assert.equal(d.monthlyPercent, `${MINUS}18.0%`);
  assert.equal(d.tierChanged, true);
  assert.equal(R.tierChangeLine("level", "graded"), "Two-year wait added");
  assert.equal(R.percentChange(0, 100), "0.0%");
  assert.equal(R.percentChange(1, 3), "+33.3%");
});

test("3.26: effective-date shift and the first draft after it", () => {
  assert.equal(R.daysBetween("2026-10-01", "2026-11-01"), 31);
  assert.equal(R.firstDraftOn("2026-11-01", 23), "2026-11-23");
  assert.equal(R.firstDraftOn("2026-11-25", 23), "2026-12-23");
  assert.equal(R.firstDraftOn("2026-12-28", 3), "2027-01-03");
});

test("3.20: the four locked facts always render, even from a template that lost one", () => {
  const facts = {
    client_first_name: "Grace", carrier_name: "Gerber Life", coverage_amount: "$15,000", product_name: "Final Expense", statement_descriptor: "GERBER LIFE INS",
    monthly_amount: "$71.20", draft_day: "23rd", beneficiaries: "Emmanuel (spouse), 100%", reference: "GL-40771902", agent_name: "Rinor G.", agent_phone: "(602) 555-0100", agent_email: "a@example.com",
  };
  const out = R.renderWelcomeTemplate({ subject: "Your {carrier_name} coverage", body: "Hi {client_first_name}. {monthly_amount} on the {draft_day}." }, facts);
  assert.equal(out.subject, "Your Gerber Life coverage");
  for (const v of ["GERBER LIFE INS", "$71.20", "23rd", "(602) 555-0100"]) assert.ok(out.body.includes(v), v);
  assert.deepEqual(R.missingLockedFacts({ statement_descriptor: "", monthly_amount: "$1.00", draft_day: "3rd", agent_phone: "" }), ["the statement descriptor", "your phone number"]);
});

test("3.24: only address and contact keys can be shared; the household total adds both sides", () => {
  assert.equal(R.isHouseholdKey("addr.line1"), true);
  assert.equal(R.isHouseholdKey("contact.email"), true);
  assert.equal(R.isHouseholdKey("insured.dob"), false);
  assert.equal(R.isHouseholdKey("insured.tobacco"), false);
  assert.deepEqual(R.householdTotal([7_120, 5_890]), { totalCents: 13_010, complete: true });
  assert.deepEqual(R.householdTotal([7_120, null]), { totalCents: 7_120, complete: false });
  assert.equal(R.sameEmail("Grace@Example.com ", "grace@example.com"), true);
  assert.equal(R.sameEmail("", ""), false);
});

test("3.24: adding a spouse copies no insured.* or health value from the primary", () => {
  const src = read("lib/applications/household.ts");
  // The copied set is filtered to addr./contact. prefixes through isHouseholdKey; insured.* values
  // on the spouse come only from what was typed in the dialog.
  assert.match(src, /prefixes\.some\(\(p\) => v\.field_key\.startsWith\(p\)\) && isHouseholdKey\(v\.field_key\)/);
  assert.doesNotMatch(src, /tenant_uw_answers|tenant_medications/);
});

test("3.26 / 3.15 / 3.20: nothing in the after-submit services deletes a counteroffer, submission or welcome pack", () => {
  for (const f of ["counteroffers.ts", "confirmations.ts", "welcomePack.ts", "requirements.ts"]) {
    const src = read(`lib/applications/${f}`);
    assert.doesNotMatch(src, /\.delete\(|\.remove\(/, f);
  }
  const upload = read("lib/applications/confirmations.ts");
  assert.match(upload, /upsert: false/);
  assert.match(upload, /createSignedUrl\(s\.confirmation_path, 60\)/);
  assert.match(read("lib/applications/welcomePack.ts"), /upsert: false/);
});

test("the after-submit routes gate owner and producer in their own body", () => {
  const dir = join(ROOT, "app/api/app/applications");
  const mine = [
    "attempts/[id]/requirements/route.ts", "attempts/[id]/requirements/[requirementId]/route.ts", "attempts/[id]/requirements/[requirementId]/chase/route.ts",
    "attempts/[id]/requirements/[requirementId]/callback/route.ts", "attempts/[id]/counteroffers/route.ts", "attempts/[id]/counteroffers/[counterofferId]/respond/route.ts",
    "attempts/[id]/submissions/[submissionId]/confirmation/route.ts", "attempts/[id]/reference-check/route.ts", "attempts/[id]/welcome-pack/route.ts",
    "attempts/[id]/values/detach/route.ts", "cases/[caseId]/spouse/route.ts", "cases/[caseId]/timeline/route.ts",
  ];
  for (const f of mine) {
    const p = join(dir, f);
    assert.ok(statSync(p).isFile(), f);
    const src = readFileSync(p, "utf8");
    assert.match(src, /requireFeatureRole\("applications", \["owner", "producer"\]/, f);
    if (/export async function (POST|PATCH|PUT)/.test(src)) assert.match(src, /\{ write: true \}/, f);
  }
});
