/**
 * LA-2.6 · the consent certificate that travels with a lead, read from whatever the vendor sent.
 *
 * Pure and client-safe: the list importer reads a file's certificate columns with it, and the lead
 * post can read a posted body with it, so both paths agree on what a TrustedForm or Jornaya
 * certificate is and on its id.
 *
 * The id matters. The locker, the dialer's consent panel and the export all show `certificate_id`,
 * and it used to be filled only for Jornaya — for a TrustedForm certificate the id lives in its URL
 * (https://cert.trustedform.com/<id>), and nothing took it out.
 */

export type ConsentProvider = "trustedform" | "jornaya" | "other";

export type CapturedConsent = {
  provider: ConsentProvider;
  certificate_id: string | null;
  certificate_url: string | null;
  /** ISO-8601, or null when the value was missing or not a date. */
  consent_timestamp: string | null;
  ip: string | null;
  source_url: string | null;
  landing_page: string | null;
};

/**
 * Header spellings vendors use for each certificate fact, compared after removing everything that
 * is not a letter or a digit ("xxTrustedFormCertUrl", "trusted_form_cert_url" and "TrustedForm URL"
 * are one column).
 */
export const CONSENT_COLUMN_ALIASES: Record<keyof Omit<CapturedConsent, "provider"> | "trustedform_url" | "jornaya_token", string[]> = {
  trustedform_url: ["xxtrustedformcerturl", "trustedformcerturl", "trustedformurl", "trustedformcertificateurl", "trustedformcertificate", "trustedform", "tfcerturl", "certurl", "certificateurl"],
  jornaya_token: ["jornayaleadid", "leadidtoken", "universalleadid", "leadid", "jornayatoken", "jornaya"],
  certificate_id: ["trustedformcertid", "trustedformid", "certificateid", "certid"],
  certificate_url: [],
  consent_timestamp: ["consenttimestamp", "consentdate", "consenttime", "optindate", "optintimestamp", "optintime", "consentedat"],
  ip: ["consentip", "ipaddress", "ip", "optinip", "userip"],
  source_url: ["sourceurl", "optinurl", "siteurl", "website", "url"],
  landing_page: ["landingpage", "landingpageurl", "pageurl"],
};

const compact = (value: string) => value.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which consent fact each column of a file carries, by index. Columns that carry none are absent. */
export function consentColumnIndexes(headers: readonly string[]): Partial<Record<keyof typeof CONSENT_COLUMN_ALIASES, number>> {
  const found: Partial<Record<keyof typeof CONSENT_COLUMN_ALIASES, number>> = {};
  const compacted = headers.map((header) => compact(header));
  for (const [fact, aliases] of Object.entries(CONSENT_COLUMN_ALIASES) as Array<[keyof typeof CONSENT_COLUMN_ALIASES, string[]]>) {
    // The first alias in the list wins over later ones, so a file with both "consent_ip" and "ip"
    // reads the consent one.
    for (const alias of aliases) {
      const index = compacted.indexOf(alias);
      if (index >= 0) { found[fact] = index; break; }
    }
  }
  return found;
}

const TRUSTEDFORM_HOST = /^https?:\/\/(?:cert\.|www\.)?trustedform\.com\//i;

/**
 * The certificate id inside a TrustedForm URL: the path segment after the host, e.g.
 * https://cert.trustedform.com/2a5c0d7e…  →  2a5c0d7e…. Null when the URL is not TrustedForm's.
 */
export function trustedFormCertificateId(url: string | null | undefined): string | null {
  const value = (url ?? "").trim();
  if (!TRUSTEDFORM_HOST.test(value)) return null;
  const path = value.replace(TRUSTEDFORM_HOST, "").split(/[?#]/)[0];
  const id = path.split("/").filter(Boolean)[0] ?? "";
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : null;
}

/** A timestamp the database will store, as ISO-8601; anything unreadable is dropped, not guessed. */
export function consentTimestamp(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  // A bare number is epoch seconds or milliseconds, which some form tools export.
  const numeric = /^\d{10}(\d{3})?$/.test(value) ? Number(value.length === 10 ? Number(value) * 1000 : value) : null;
  const time = numeric ?? Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? date.toISOString() : null;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,45}$/i;

function ipOf(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return value && (IPV4.test(value) || (value.includes(":") && IPV6.test(value))) ? value : null;
}

function urlOf(raw: unknown, max = 2048): string | null {
  const value = String(raw ?? "").trim();
  return value ? value.slice(0, max) : null;
}

/**
 * The certificate one lead carries, from the raw values of its row (or post), or null when it
 * carries none. A row needs a TrustedForm URL or a Jornaya token to count: an IP address or a
 * timestamp on its own is not a certificate, and filing one would make the locker say "link only"
 * about a lead that has no link.
 */
export function captureConsent(input: {
  trustedformUrl?: unknown;
  jornayaToken?: unknown;
  certificateId?: unknown;
  consentTimestamp?: unknown;
  ip?: unknown;
  sourceUrl?: unknown;
  landingPage?: unknown;
}): CapturedConsent | null {
  const certUrl = urlOf(input.trustedformUrl);
  const jornaya = String(input.jornayaToken ?? "").trim() || null;
  const explicitId = String(input.certificateId ?? "").trim() || null;
  const common = {
    consent_timestamp: consentTimestamp(input.consentTimestamp),
    ip: ipOf(input.ip),
    source_url: urlOf(input.sourceUrl),
    landing_page: urlOf(input.landingPage),
  };
  if (certUrl) {
    const isTrustedForm = TRUSTEDFORM_HOST.test(certUrl);
    return {
      provider: isTrustedForm ? "trustedform" : "other",
      certificate_id: (isTrustedForm ? trustedFormCertificateId(certUrl) : null) ?? explicitId?.slice(0, 128) ?? null,
      certificate_url: certUrl,
      ...common,
    };
  }
  if (jornaya && /^[A-Za-z0-9-]{8,128}$/.test(jornaya)) {
    return { provider: "jornaya", certificate_id: jornaya, certificate_url: null, ...common };
  }
  return null;
}

/** The same capture over a posted body's keys, which the lead-post API documents. */
export function captureConsentFromValues(values: Record<string, unknown>): CapturedConsent | null {
  const text = (key: string) => (typeof values[key] === "string" ? values[key] : undefined);
  return captureConsent({
    trustedformUrl: text("trusted_form_cert_url") ?? text("trustedform_url") ?? text("xxTrustedFormCertUrl"),
    jornayaToken: text("jornaya_leadid") ?? text("leadid_token"),
    certificateId: text("certificate_id"),
    consentTimestamp: text("consent_timestamp"),
    ip: text("consent_ip") ?? text("ip"),
    sourceUrl: text("source_url"),
    landingPage: text("landing_page"),
  });
}
