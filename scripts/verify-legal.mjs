// SA-5.4 acceptance: versioned legal documents, the signup gate, re-acceptance, and immutability.
//
// Drives the real HTTP routes against the running app. The interesting part is the middle: it
// publishes a genuine v2, proves an existing user is blocked by it, accepts, and proves v1's text
// is still there afterwards — the whole point of the ticket.
//
// Tenants, users and acceptances are all removed. The DOCUMENTS it publishes are not, and cannot
// be: this table is append-only by design and nothing — not even service_role — may delete from it.
// Adding a teardown function would destroy the exact guarantee under test. So every version this
// script publishes goes into the `dpa` type, which nothing else uses and which signup does not
// require, leaving the live Terms and Privacy Policy untouched at v1. It clears the re-acceptance
// requirement before exiting so no real user is ever blocked by a verification document.
//
// Needs the app running. Run: npm run verify:legal
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const stamp = Date.now();
const made = { tenants: [], users: [], documents: [] };

// SA-5.1 caps signups at 5 per IP per hour, and this script makes four from one IP. Cleared at the
// START rather than the end, so a previous crashed run cannot leave this one rate-limited.
await clearSignupRateLimits();

const { data: superAdmin } = await supabase
  .from("admin_users").select("id").eq("role", "super_admin").eq("is_active", true).limit(1).single();

const { data: billingAdmin } = await supabase
  .from("admin_users")
  .insert({
    email: `verify-legal-${stamp}@insurvas.invalid`,
    name: "Verification Billing Admin",
    role: "billing_admin",
    password_hash: "x", totp_secret: "x", is_active: true,
  })
  .select("id").single();

const sign = async (adminId, role) =>
  `insurvas_admin_session=${await new SignJWT({ role, stage: "authenticated" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(adminId).setIssuedAt().setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET))}`;

const adminCookie = await sign(superAdmin.id, "super_admin");
const billingCookie = await sign(billingAdmin.id, "billing_admin");

const LONG_TEXT =
  "# Terms of Service\n\n## 1. Scope\n\nThis is verification text, long enough to pass the minimum " +
  "length check that stops an empty document being published as if it were real.\n";

async function cleanup() {
  for (const id of made.tenants) {
    await supabase.from("checkout_sessions").delete().eq("tenant_id", id);
    await supabase.from("tenant_entitlements").delete().eq("tenant_id", id);
    await supabase.from("subscriptions").delete().eq("tenant_id", id);
    await supabase.from("signup_selections").delete().eq("tenant_id", id);
    await supabase.from("tenant_users").delete().eq("tenant_id", id);
    await supabase.from("tenants").delete().eq("id", id);
  }
  // Acceptances cascade from the user; the REVOKE blocks deleting them directly, which is the point.
  for (const id of made.users) {
    await supabase.from("email_verifications").delete().eq("user_id", id);
    await supabase.from("users").delete().eq("id", id);
  }
  // The documents stay. They cannot be deleted — that is the guarantee, not an oversight — so
  // instead nothing is left blocking anybody.
  for (const id of made.documents) {
    try {
      await supabase.rpc("clear_reacceptance_requirement", { p_document_id: id });
    } catch {
      // Best effort — cleanup must not mask a real failure above.
    }
  }
  // A draft this run created (DPA only) is not evidence and is removed. A draft that existed before
  // the run is never touched: verifyDrafts skips itself when it finds one.
  if (made.dpaDraft) {
    await supabase.from("legal_document_drafts").delete().eq("doc_type", "dpa");
  }
  await supabase.from("audit_log").delete().eq("actor_id", billingAdmin.id);
  await supabase.from("admin_users").delete().eq("id", billingAdmin.id);
  await clearSignupRateLimits();
}

/**
 * Unpublished drafts (20260924363000), on the DPA only — like everything else this script
 * publishes, so the live Terms and Privacy Policy are never touched.
 *
 * What it proves: only a super_admin can save, discard or publish a draft; a saved draft is
 * invisible to every customer surface and blocks nobody; publishing is refused when someone
 * published in between or the draft changed since it was loaded; a successful publish allocates
 * exactly the version the admin was shown and removes the draft.
 *
 * The draft it publishes is marked NOT material, so no real user is interrupted even for the moment
 * between publishing and cleanup.
 */
async function verifyDrafts(user) {
  console.log("\nUnpublished drafts (DPA only)\n");

  const probe = await supabase.from("legal_document_drafts").select("doc_type, updated_at").eq("doc_type", "dpa");
  if (probe.error) {
    console.log(`  skip drafts — legal_document_drafts is not available (${probe.error.code ?? probe.error.message})`);
    return;
  }
  if ((probe.data ?? []).length > 0) {
    console.log("  skip drafts — a real DPA draft already exists and this script never overwrites one");
    return;
  }

  const marker = `DRAFT-ONLY-${stamp}`;
  const draftText = `${LONG_TEXT}\n## 3. Draft section\n\nThis sentence carries ${marker} and must never reach a customer before it is published.\n`;
  const draftBody = {
    action: "save_draft", docType: "dpa", title: "Data Processing Agreement", content: draftText,
    effectiveDate: "2026-09-04", changeSummary: "Verification draft.", requiresReacceptance: false,
    expectedUpdatedAt: null,
  };

  const { data: owedBefore } = user?.id
    ? await supabase.rpc("outstanding_legal_documents", { p_user_id: user.id })
    : { data: null };

  const refusedSave = await post("/api/admin/legal", billingCookie, draftBody);
  check("a billing_admin cannot save a draft", refusedSave.status === 403, String(refusedSave.status));

  const saved = await post("/api/admin/legal", adminCookie, draftBody);
  const savedBody = await saved.json();
  check("a super_admin can save a draft", saved.status === 200 && savedBody.draft?.doc_type === "dpa",
        JSON.stringify(savedBody).slice(0, 200));
  if (saved.status !== 200) return;
  made.dpaDraft = true;
  const savedAt = savedBody.draft.updated_at;

  const twiceNew = await post("/api/admin/legal", adminCookie, draftBody);
  check("starting a second draft over an existing one is refused, not overwritten", twiceNew.status === 409,
        String(twiceNew.status));

  const staleSave = await post("/api/admin/legal", adminCookie, {
    ...draftBody, content: `${draftText}\nlost edit`, expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
  });
  check("saving over a draft someone else changed is refused", staleSave.status === 409, String(staleSave.status));

  const { data: stillDraft } = await supabase.from("legal_document_drafts").select("content").eq("doc_type", "dpa").single();
  check("and the refused save changed nothing", stillDraft?.content === draftText, "a stale editor overwrote the draft");

  // Invisible to customers: the public listing, the public page, and the acceptance gate.
  const listedNow = await fetch(`${BASE}/api/public/legal`).then((r) => r.text());
  check("the public legal listing does not show the draft", !listedNow.includes(marker) && !listedNow.includes("Verification draft."),
        "a draft reached /api/public/legal");

  const pageNow = await fetch(`${BASE}/legal/dpa`).then((r) => r.text());
  check("/legal/dpa does not serve the draft text", !pageNow.includes(marker), "a draft reached the public page");

  if (user?.id) {
    const { data: owedNow } = await supabase.rpc("outstanding_legal_documents", { p_user_id: user.id });
    check("a draft blocks nobody", JSON.stringify(owedNow ?? []) === JSON.stringify(owedBefore ?? []),
          `before ${JSON.stringify(owedBefore)} after ${JSON.stringify(owedNow)}`);
  }

  const { count: leaked } = await supabase
    .from("legal_documents").select("id", { count: "exact", head: true }).like("content", `%${marker}%`);
  check("saving a draft wrote nothing customers read from", leaked === 0, `${leaked} legal_documents row(s) carry the draft text`);

  const { data: dpaNow } = await supabase
    .from("legal_documents").select("version").eq("doc_type", "dpa").order("version", { ascending: false }).limit(1);
  const expected = (dpaNow?.[0]?.version ?? 0) + 1;

  // Who may publish, and the two races publishing refuses.
  const refusedPublish = await post("/api/admin/legal", billingCookie, {
    action: "publish_draft", docType: "dpa", expectedVersion: expected, expectedUpdatedAt: savedAt,
  });
  check("a billing_admin cannot publish a draft", refusedPublish.status === 403, String(refusedPublish.status));

  const wrongVersion = await post("/api/admin/legal", adminCookie, {
    action: "publish_draft", docType: "dpa", expectedVersion: expected + 1, expectedUpdatedAt: savedAt,
  });
  check("publishing as a version number that is not next is refused", wrongVersion.status === 409, String(wrongVersion.status));

  const staleDraft = await post("/api/admin/legal", adminCookie, {
    action: "publish_draft", docType: "dpa", expectedVersion: expected, expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
  });
  check("publishing a draft that changed since it was loaded is refused", staleDraft.status === 409, String(staleDraft.status));

  // Someone publishes directly while the draft's editor is open: the draft's "Publish version N" is now wrong.
  const inBetween = await post("/api/admin/legal", adminCookie, {
    action: "publish", docType: "dpa", title: "Data Processing Agreement", content: LONG_TEXT,
    effectiveDate: "2026-09-04", requiresReacceptance: false,
  });
  const inBetweenBody = await inBetween.json();
  if (inBetweenBody.id) made.documents.push(inBetweenBody.id);

  const raced = await post("/api/admin/legal", adminCookie, {
    action: "publish_draft", docType: "dpa", expectedVersion: expected, expectedUpdatedAt: savedAt,
  });
  const racedBody = await raced.json();
  check("publishing is refused when someone published in between", raced.status === 409, `${raced.status} ${racedBody.error ?? ""}`);

  const { data: afterRefusals } = await supabase.from("legal_document_drafts").select("doc_type").eq("doc_type", "dpa");
  check("every refused publish left the draft in place", (afterRefusals ?? []).length === 1, JSON.stringify(afterRefusals));

  const published = await post("/api/admin/legal", adminCookie, {
    action: "publish_draft", docType: "dpa", expectedVersion: expected + 1, expectedUpdatedAt: savedAt,
  });
  const publishedBody = await published.json();
  check("a super_admin can publish the saved draft as the version shown", published.status === 200 && publishedBody.version === expected + 1,
        JSON.stringify(publishedBody).slice(0, 200));
  if (publishedBody.id) made.documents.push(publishedBody.id);

  if (published.status === 200) {
    const { data: row } = await supabase
      .from("legal_documents").select("content, requires_reacceptance, is_draft").eq("id", publishedBody.id).single();
    check("the published text is exactly the saved draft", row?.content === draftText, "publish did not send the saved text");
    check("and it kept the draft's material flag (not material)", row?.requires_reacceptance === false, JSON.stringify(row));
    check("and it is not labelled unreviewed text", row?.is_draft === false, JSON.stringify(row));

    const { data: gone } = await supabase.from("legal_document_drafts").select("doc_type").eq("doc_type", "dpa");
    check("publishing removed the draft", (gone ?? []).length === 0, JSON.stringify(gone));
    if ((gone ?? []).length === 0) made.dpaDraft = false;

    const pageAfter = await fetch(`${BASE}/legal/dpa`).then((r) => r.text());
    check("once published, /legal/dpa serves it", pageAfter.includes(marker), "the published draft is not being served");
  }

  // Discarding.
  const second = await post("/api/admin/legal", adminCookie, { ...draftBody, content: `${LONG_TEXT}\nsecond draft` });
  const secondBody = await second.json();
  if (second.status === 200) made.dpaDraft = true;
  const secondAt = secondBody.draft?.updated_at;

  const refusedDiscard = await post("/api/admin/legal", billingCookie, { action: "discard_draft", docType: "dpa", expectedUpdatedAt: secondAt });
  check("a billing_admin cannot discard a draft", refusedDiscard.status === 403, String(refusedDiscard.status));

  const staleDiscard = await post("/api/admin/legal", adminCookie, {
    action: "discard_draft", docType: "dpa", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
  });
  check("discarding a draft that changed since it was loaded is refused", staleDiscard.status === 409, String(staleDiscard.status));

  const discarded = await post("/api/admin/legal", adminCookie, { action: "discard_draft", docType: "dpa", expectedUpdatedAt: secondAt });
  check("a super_admin can discard a draft", discarded.status === 200, String(discarded.status));
  const { data: afterDiscard } = await supabase.from("legal_document_drafts").select("doc_type").eq("doc_type", "dpa");
  check("and it is gone", (afterDiscard ?? []).length === 0, JSON.stringify(afterDiscard));
  if ((afterDiscard ?? []).length === 0) made.dpaDraft = false;

  const { data: draftAudit } = await supabase
    .from("audit_log").select("action")
    .in("action", ["legal_document.draft_saved", "legal_document.draft_discarded"])
    .eq("actor_id", superAdmin.id)
    .order("ts", { ascending: false }).limit(10);
  check("saving and discarding drafts are audit-logged",
        (draftAudit ?? []).some((r) => r.action === "legal_document.draft_saved") &&
          (draftAudit ?? []).some((r) => r.action === "legal_document.draft_discarded"),
        JSON.stringify(draftAudit));
}

/** The bucket column is `bucket_key`; only signup buckets are touched. */
async function clearSignupRateLimits() {
  await supabase.from("rate_limits").delete().like("bucket_key", "signup_ip:%");
  await supabase.from("rate_limits").delete().like("bucket_key", "%insurvas.test%");
}

const post = (path, cookie, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

try {
  console.log("What signup is asked to accept\n");

  const listed = await fetch(`${BASE}/api/public/legal`).then((r) => r.json());
  check("the public endpoint lists the current versions", listed.documents?.length >= 2,
        JSON.stringify(listed).slice(0, 160));
  check("nothing is missing, so signup is not blocked", listed.missing?.length === 0,
        JSON.stringify(listed.missing));
  check("it serves metadata only, never the document text",
        listed.documents.every((d) => !("content" in d)), "content has no business in a form payload");
  check("the seeded documents are flagged as drafts, not passed off as reviewed",
        listed.documents.every((d) => d.is_draft === true), JSON.stringify(listed.documents));

  const tos = listed.documents.find((d) => d.doc_type === "tos");
  const privacy = listed.documents.find((d) => d.doc_type === "privacy");

  console.log("\nSignup is blocked until the box is ticked\n");

  const base = (suffix) => ({
    fullName: "Legal Verify",
    email: `legal_${suffix}_${stamp}@insurvas.test`,
    password: "correct horse battery staple",
    phone: "5551234567",
    planCode: "basic",
    billingCycle: "monthly",
  });

  const unticked = await post("/api/public/signup", null, { ...base("a"), acceptedDocumentIds: [] });
  const untickedBody = await unticked.json();
  check("signup with nothing accepted is refused", unticked.status === 400, String(unticked.status));
  check("and the message says why", /accept the terms/i.test(untickedBody.error ?? ""), untickedBody.error);

  const { data: ghost } = await supabase
    .from("users").select("id").eq("email", base("a").email).maybeSingle();
  check("no account was created by the refused attempt", ghost === null,
        "the gate must run before anything is written");

  const partial = await post("/api/public/signup", null, { ...base("b"), acceptedDocumentIds: [tos.id] });
  check("accepting only the terms and not the privacy policy is refused", partial.status === 400,
        String(partial.status));

  const bogus = await post("/api/public/signup", null, {
    ...base("c"), acceptedDocumentIds: ["00000000-0000-0000-0000-000000000000", tos.id],
  });
  check("an id the server never offered does not satisfy the gate", bogus.status === 400, String(bogus.status));

  console.log("\nA real signup, and what it records\n");

  const good = await post("/api/public/signup", null, {
    ...base("ok"), acceptedDocumentIds: [tos.id, privacy.id],
  });
  const goodBody = await good.json();
  check("signup succeeds with both accepted", good.status === 200, JSON.stringify(goodBody).slice(0, 200));

  const { data: user } = await supabase
    .from("users").select("id").eq("email", base("ok").email).single();
  made.users.push(user.id);
  const { data: tenantUser } = await supabase
    .from("tenant_users").select("tenant_id").eq("user_id", user.id).single();
  made.tenants.push(tenantUser.tenant_id);

  const { data: records } = await supabase
    .from("legal_acceptances").select("*").eq("user_id", user.id);

  check("two acceptance records exist", records.length === 2, `${records.length} rows`);
  check("each stores the exact VERSION, not just 'accepted the terms'",
        records.every((r) => Number.isInteger(r.version) && r.version >= 1),
        JSON.stringify(records.map((r) => ({ t: r.doc_type, v: r.version }))));
  check("each stores which document row, so the text is recoverable",
        records.every((r) => r.document_id), "document_id is what makes the record evidence");
  check("the IP is captured", records.length > 0 && records.every((r) => r.ip !== null), JSON.stringify({ count: records.length, ips: records.map((r) => r.ip) }));
  check("the context says it happened at signup",
        records.every((r) => r.context === "signup"), JSON.stringify(records.map((r) => r.context)));

  console.log("\nAcceptance records are append-only\n");

  // Keep a failed provisioning contract from turning the verifier into an unrelated TypeError.
  // The acceptance-count assertion above remains the authoritative failure; these mutation checks
  // are meaningful only when at least one acceptance row exists.
  if (records[0]) {
    const { error: updateError } = await supabase
      .from("legal_acceptances").update({ accepted_at: new Date(0).toISOString() }).eq("id", records[0].id);
    check("no admin can back-date an acceptance", updateError !== null,
          "the UPDATE succeeded — the record could be rewritten");

    const { error: deleteError } = await supabase
      .from("legal_acceptances").delete().eq("id", records[0].id);
    check("no admin can delete one either", deleteError !== null, "the DELETE succeeded");
  } else {
    console.log("  skip append-only row mutations — signup produced no acceptance row");
  }

  const { error: docUpdateError } = await supabase
    .from("legal_documents").update({ content: "rewritten" }).eq("id", tos.id);
  check("and the text of a published document cannot be rewritten", docUpdateError !== null,
        "the document itself could be altered after people agreed to it");

  console.log("\nWho may publish\n");

  const refused = await post("/api/admin/legal", billingCookie, {
    action: "publish", docType: "dpa", title: "Data Processing Agreement",
    content: LONG_TEXT, effectiveDate: "2026-09-01", requiresReacceptance: true,
  });
  check("a billing_admin cannot publish terms", refused.status === 403, String(refused.status));

  const anon = await post("/api/admin/legal", null, {
    action: "publish", docType: "dpa", title: "T", content: LONG_TEXT,
    effectiveDate: "2026-09-01", requiresReacceptance: true,
  });
  check("nor can an unauthenticated caller", anon.status === 401, String(anon.status));

  const tooShort = await post("/api/admin/legal", adminCookie, {
    action: "publish", docType: "dpa", title: "Data Processing Agreement",
    content: "Short.", effectiveDate: "2026-09-01", requiresReacceptance: true,
  });
  check("an empty document cannot be published as if it were real", tooShort.status === 400,
        String(tooShort.status));

  console.log("\nPublishing v2, and what it does to an existing user\n");

  // Published as a DPA rather than a new Terms version: this table cannot be cleaned up, so the
  // live Terms and Privacy Policy are left alone and every artifact lands in the one document type
  // nothing else uses.
  const { data: dpaBefore } = await supabase
    .from("legal_documents").select("version").eq("doc_type", "dpa")
    .order("version", { ascending: false }).limit(1);
  const expectedVersion = (dpaBefore?.[0]?.version ?? 0) + 1;

  const published = await post("/api/admin/legal", adminCookie, {
    action: "publish", docType: "dpa", title: "Data Processing Agreement",
    content: LONG_TEXT, effectiveDate: "2026-09-01",
    changeSummary: "Clarified the sub-processor list.", requiresReacceptance: true,
  });
  const publishedBody = await published.json();
  check("a super_admin can publish", published.status === 200, JSON.stringify(publishedBody).slice(0, 160));
  check("the version is allocated by the database, not the caller",
        publishedBody.version === expectedVersion,
        `got v${publishedBody.version}, expected v${expectedVersion}`);
  made.documents.push(publishedBody.id);

  // Re-acceptance is dependent on the initial signup acceptance having produced both rows. Keep a
  // missing live batch RPC as one root-cause failure instead of reporting every downstream check
  // as if the acceptance gate itself were independently broken.
  if (records.length === 2) {
    const { data: outstanding } = await supabase.rpc("outstanding_legal_documents", { p_user_id: user.id });
    check("the existing user now owes the new version", outstanding.length === 1, `${outstanding.length} owed`);
    check("and only the new version — accepting v1 discharged v1",
          outstanding[0]?.version === publishedBody.version, `owes v${outstanding[0]?.version}`);

  // The signup-state gate runs first by design — an unverified user is sent to verify their email
  // before anything else, and terms are not the most urgent thing to put in front of them. So the
  // user is verified here, which is the state a real user is in when a new version lands.
  await supabase.from("users").update({ status: "active" }).eq("id", user.id);
  await supabase
    .from("tenants")
    .update({ onboarding_state: "completed", status: "active" })
    .eq("id", tenantUser.tenant_id);

  const tenantJwt = await new SignJWT({ tenantId: tenantUser.tenant_id })
    .setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
  const tenantCookie = `insurvas_tenant_session=${tenantJwt}`;

  const blocked = await fetch(`${BASE}/app/dashboard`, { headers: { cookie: tenantCookie }, redirect: "manual" });
  const location = blocked.headers.get("location") ?? "";
  check("the product redirects them to the acceptance screen",
        [302, 307].includes(blocked.status) && location.includes("/app/accept-terms"),
        `${blocked.status} -> ${location}`);

  console.log("\nAccepting the new version\n");

  const wrongDoc = await post("/api/app/legal/accept", tenantCookie, { documentIds: [privacy.id] });
  check("accepting a document they do not owe does not clear the gate", wrongDoc.status === 400,
        String(wrongDoc.status));

  const accepted = await post("/api/app/legal/accept", tenantCookie, { documentIds: [publishedBody.id] });
  check("accepting the outstanding version succeeds", accepted.status === 200, String(accepted.status));

  const { data: afterAccept } = await supabase.rpc("outstanding_legal_documents", { p_user_id: user.id });
  check("nothing is outstanding any more", afterAccept.length === 0, `${afterAccept.length} still owed`);

  const through = await fetch(`${BASE}/app/dashboard`, { headers: { cookie: tenantCookie }, redirect: "manual" });
  check("and the product lets them back in",
        !(through.headers.get("location") ?? "").includes("/app/accept-terms"),
        `${through.status} -> ${through.headers.get("location")}`);

  const { data: history } = await supabase
    .from("legal_acceptances").select("doc_type, version, context").eq("user_id", user.id)
    .order("accepted_at");
  check("their history shows every document they ever agreed to",
        history.length === 3 &&
          history.filter((h) => h.doc_type === "tos").length === 1 &&
          history.filter((h) => h.doc_type === "dpa").length === 1,
        JSON.stringify(history));
  check("the second is marked as a re-acceptance, not a signup",
        history.some((h) => h.context === "reacceptance"), JSON.stringify(history.map((h) => h.context)));

  const twice = await post("/api/app/legal/accept", tenantCookie, { documentIds: [publishedBody.id] });
  const { data: afterTwice } = await supabase
    .from("legal_acceptances").select("id").eq("user_id", user.id).eq("document_id", publishedBody.id);
  check("accepting twice records one agreement, not two",
        twice.status === 200 && afterTwice.length === 1, `${afterTwice.length} rows`);
  } else {
    console.log("  skip re-acceptance workflow — initial signup acceptance batch was not recorded");
  }

  console.log("\nThe old text survives\n");

  const supersedingText =
    LONG_TEXT + "\n## 2. Added later\n\nA second version, so the first has something to be superseded by.\n";

  const superseding = await post("/api/admin/legal", adminCookie, {
    action: "publish", docType: "dpa", title: "Data Processing Agreement",
    content: supersedingText, effectiveDate: "2026-09-02",
    changeSummary: "Added a section.", requiresReacceptance: false,
  });
  const supersedingBody = await superseding.json();
  made.documents.push(supersedingBody.id);

  // NB: in dev, Turbopack inlines component source into the HTML, so a bare search for a UI string
  // matches the SOURCE and passes no matter what rendered. These assertions look for the banner in
  // its interpolated form — "superseded by version 7" with a real digit — which only the rendered
  // output can contain.
  const supersededBanner = (html) => /superseded by version(<!-- -->|\s)*\d/.test(html);

  const oldPage = await fetch(`${BASE}/legal/dpa?v=${publishedBody.version}`);
  const oldHtml = await oldPage.text();
  check(`v${publishedBody.version} is still readable after v${supersedingBody.version} was published`,
        oldPage.status === 200, String(oldPage.status));
  check("and it is marked as superseded rather than passed off as current",
        supersededBanner(oldHtml), "a reader must not mistake an old version for the live one");

  const newPage = await fetch(`${BASE}/legal/dpa`);
  const newHtml = await newPage.text();
  check("the unversioned URL serves the newest version",
        newPage.status === 200 && newHtml.includes("Added later") && !supersededBanner(newHtml),
        `status=${newPage.status} hasNewSection=${newHtml.includes("Added later")} ` +
        `labelledSuperseded=${supersededBanner(newHtml)}`);

  const tosV1 = await fetch(`${BASE}/legal/tos?v=1`);
  check("the seeded Terms v1 is untouched and still served", tosV1.status === 200, String(tosV1.status));

  const missing = await fetch(`${BASE}/legal/tos?v=999`);
  check("a version that never existed is a 404, not an empty page", missing.status === 404, String(missing.status));

  console.log("\nThe escape hatch for a mistaken publish\n");

  const mistake = await post("/api/admin/legal", adminCookie, {
    action: "publish", docType: "dpa", title: "Data Processing Agreement",
    content: LONG_TEXT, effectiveDate: "2026-09-03", requiresReacceptance: true,
  });
  const mistakeBody = await mistake.json();
  made.documents.push(mistakeBody.id);

  const { data: nowOwed } = await supabase.rpc("outstanding_legal_documents", { p_user_id: user.id });
  check("a mistaken publish blocks everyone", nowOwed.length === 1, `${nowOwed.length} owed`);

  const noReason = await post("/api/admin/legal", adminCookie, {
    action: "clear_reacceptance", documentId: mistakeBody.id, reason: "x",
  });
  check("clearing it without a reason is refused", noReason.status === 400, String(noReason.status));

  const cleared = await post("/api/admin/legal", adminCookie, {
    action: "clear_reacceptance", documentId: mistakeBody.id,
    reason: "Published by mistake during verification",
  });
  check("a super_admin can stop it blocking people", cleared.status === 200, String(cleared.status));

  const { data: unblocked } = await supabase.rpc("outstanding_legal_documents", { p_user_id: user.id });
  check("and nobody is blocked by it any more", unblocked.length === 0, `${unblocked.length} still owed`);

  const { data: stillThere } = await supabase
    .from("legal_documents").select("content").eq("id", mistakeBody.id).single();
  check("the escape hatch removed the interruption, not the document",
        stillThere.content === LONG_TEXT.trim(), "clearing must never alter or delete the text");

  await verifyDrafts(user);

  console.log("\nThe audit trail\n");

  const { data: auditRows } = await supabase
    .from("audit_log").select("action, reason")
    .in("action", ["legal_document.published", "legal_document.reacceptance_cleared"])
    .order("ts", { ascending: false }).limit(5);
  check("publishing is audit-logged",
        (auditRows ?? []).some((r) => r.action === "legal_document.published"), JSON.stringify(auditRows));
  check("clearing a requirement is logged with its reason",
        (auditRows ?? []).some((r) => r.action === "legal_document.reacceptance_cleared" && r.reason?.length > 5),
        JSON.stringify(auditRows));
} finally {
  console.log("\nCleaning up…");
  await cleanup();
}

console.log(
  `\nThis run published ${made.documents.length} Data Processing Agreement version(s). They cannot be`,
);
console.log("deleted — that is the guarantee under test — and none of them blocks anybody.");
console.log(failures === 0 ? "\nAll legal checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
