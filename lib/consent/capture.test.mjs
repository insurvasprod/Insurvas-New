import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { captureConsent, captureConsentFromValues, consentColumnIndexes, consentTimestamp, trustedFormCertificateId } from "./capture.ts";
import { claimWindowFor, providerFetchAvailability, trustedFormRetainRequest } from "./claimWindow.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

// ── LA-2.6-1 ────────────────────────────────────────────────────────────────────────────────────

test("a TrustedForm certificate's id is the path segment of its URL", () => {
  assert.equal(trustedFormCertificateId("https://cert.trustedform.com/0123456789abcdef0123456789abcdef01234567"), "0123456789abcdef0123456789abcdef01234567");
  assert.equal(trustedFormCertificateId("https://cert.trustedform.com/qa-d2-acdce483818189bfb7d4e27a9b9fce36?x=1"), "qa-d2-acdce483818189bfb7d4e27a9b9fce36");
  assert.equal(trustedFormCertificateId("https://example.com/0123456789abcdef"), null);
  assert.equal(trustedFormCertificateId(null), null);
});

test("a certificate needs a URL or a token; its other facts are kept only when readable", () => {
  const cert = captureConsent({ trustedformUrl: "https://cert.trustedform.com/0123456789abcdef", consentTimestamp: "not a date", ip: "999.1.1.1", sourceUrl: " https://quotes.example/term " });
  assert.equal(cert.provider, "trustedform");
  assert.equal(cert.certificate_id, "0123456789abcdef");
  assert.equal(cert.consent_timestamp, null);
  assert.equal(cert.ip, null);
  assert.equal(cert.source_url, "https://quotes.example/term");
  assert.equal(captureConsent({ ip: "198.51.100.7", consentTimestamp: "2026-09-29" }), null, "an IP alone is not a certificate");
  const jornaya = captureConsent({ jornayaToken: "ABCDEF12-3456-7890-ABCD-EF1234567890" });
  assert.deepEqual([jornaya.provider, jornaya.certificate_id, jornaya.certificate_url], ["jornaya", "ABCDEF12-3456-7890-ABCD-EF1234567890", null]);
  const other = captureConsent({ trustedformUrl: "https://certs.othervendor.example/abc", certificateId: "abc-1" });
  assert.deepEqual([other.provider, other.certificate_id], ["other", "abc-1"]);
});

test("timestamps: ISO, epoch seconds and milliseconds; anything else is dropped, not guessed", () => {
  assert.equal(consentTimestamp("2026-09-29T10:00:00Z"), "2026-09-29T10:00:00.000Z");
  assert.equal(consentTimestamp("1790244000"), new Date(1790244000 * 1000).toISOString());
  assert.equal(consentTimestamp("1790244000000"), new Date(1790244000000).toISOString());
  assert.equal(consentTimestamp("yesterday"), null);
  assert.equal(consentTimestamp("1850-01-01"), null);
});

test("header spellings vendors use are all found, the consent one first", () => {
  const found = consentColumnIndexes(["First", "xxTrustedFormCertUrl", "IP", "Consent IP", "Opt-in Date", "Landing Page", "LeadiD Token"]);
  assert.deepEqual(found, { trustedform_url: 1, ip: 3, consent_timestamp: 4, landing_page: 5, jornaya_token: 6 });
});

test("a posted body is read with the same rules, TrustedForm id included", () => {
  const cert = captureConsentFromValues({ trusted_form_cert_url: "https://cert.trustedform.com/qa-d2-acdce483818189bfb7d4e27a9b9fce36", consent_ip: "198.51.100.203", consent_timestamp: "2026-09-11T13:32:16.000Z" });
  assert.equal(cert.certificate_id, "qa-d2-acdce483818189bfb7d4e27a9b9fce36");
  assert.equal(cert.ip, "198.51.100.203");
});

// ── LA-2.6-2 ────────────────────────────────────────────────────────────────────────────────────

test("TrustedForm's claim window is 72 hours from the certificate's own time", () => {
  const created = "2026-09-26T10:00:00.000Z";
  const open = claimWindowFor({ provider: "trustedform", createdAt: created }, new Date("2026-09-29T09:59:00Z"));
  assert.deepEqual([open.expired, open.closesAt, open.hours], [false, "2026-09-29T10:00:00.000Z", 72]);
  assert.equal(claimWindowFor({ provider: "trustedform", createdAt: created }, new Date("2026-09-29T10:01:00Z")).expired, true);
  assert.deepEqual(claimWindowFor({ provider: "jornaya", createdAt: created }, new Date("2030-01-01")), { providerLabel: "Jornaya", hours: null, closesAt: null, expired: false }, "no invented window");
});

test("the provider is called only with credentials in the environment, and says so otherwise", () => {
  assert.deepEqual(providerFetchAvailability("trustedform", { TRUSTEDFORM_API_KEY: " key " }), { canFetch: true, apiKey: "key", reason: null });
  const none = providerFetchAvailability("trustedform", {});
  assert.equal(none.canFetch, false);
  assert.match(none.reason, /TRUSTEDFORM_API_KEY/);
  assert.match(providerFetchAvailability("jornaya", { TRUSTEDFORM_API_KEY: "key" }).reason, /Jornaya is not built/);
});

test("the retain call goes only to cert.trustedform.com, with the key as the Basic password", () => {
  const request = trustedFormRetainRequest({ certificateUrl: "https://cert.trustedform.com/0123456789abcdef?x", certificateId: null, apiKey: "k", reference: "lead-1" });
  assert.equal(request.url, "https://cert.trustedform.com/0123456789abcdef");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, `Basic ${Buffer.from("API:k").toString("base64")}`);
  assert.equal(trustedFormRetainRequest({ certificateUrl: "https://evil.example/0123456789abcdef", certificateId: null, apiKey: "k", reference: "r" }), null);
  assert.equal(trustedFormRetainRequest({ certificateUrl: "https://evil.example/x", certificateId: "0123456789abcdef", apiKey: "k", reference: "r" }).url, "https://cert.trustedform.com/0123456789abcdef");
});

test("the claim checks the window before storing, and labels a supplied copy as supplied", () => {
  const claim = read("lib", "consent", "claim.ts");
  const windowAt = claim.indexOf("claimWin.expired");
  const storeAt = claim.indexOf("await claimConsentCertificate(");
  assert.ok(windowAt > 0 && storeAt > windowAt, "expiry is checked before anything is stored");
  assert.match(claim, /capture_status: "expired"/);
  assert.match(claim, /_capture: \{ source: "supplied", provider_fetched: false/);
  const route = read("app", "api", "app", "compliance", "consent", "claim", "route.ts");
  assert.match(route, /action: "tenant\.consent_certificate_claimed"/);
  assert.match(route, /action: "tenant\.consent_certificate_expired"/);
});

// ── LA-2.6-6 ────────────────────────────────────────────────────────────────────────────────────

test("the export covers posted leads and reads certificates without a giant id list", () => {
  const service = read("lib", "agentTemplates", "service.ts");
  const exporter = service.slice(service.indexOf("export async function exportAgentLeads"), service.indexOf("export function csvForLeads"));
  assert.match(exporter, /and\(tenant_template_id\.is\.null,product_line\.eq\.\$\{product\}\)/);
  assert.match(exporter, /\.range\(from, from \+ PAGE - 1\)/);
  const consent = service.slice(service.indexOf("export async function consentForLeads"), service.indexOf("export async function exportAgentLeads"));
  assert.match(consent, /if \(leadIds\.length <= CHUNK \* 4\)/);
  assert.match(consent, /\.range\(from, from \+ PAGE - 1\)/);
  assert.match(read("app", "api", "app", "leads", "export", "route.ts"), /await exportAgentLeads\(/);
  // A posted certificate filed with only its URL still shows its id in the export and the locker.
  assert.match(consent, /certificate_id: row\.certificate_id \?\? trustedFormCertificateId\(row\.certificate_url\)/);
  assert.equal(read("lib", "consent", "locker.ts").match(/text\(row\.certificate_id\) \|\| trustedFormCertificateId\(text\(row\.certificate_url\)\)/g)?.length, 2);
});
