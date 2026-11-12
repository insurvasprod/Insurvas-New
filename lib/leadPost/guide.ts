/**
 * The instructions a vendor's developer reads (Lead posting round 8, board A5): the address, the
 * headers, the fields in THEIR names where a field map says so, the replies, and a sample. One
 * source for every form it takes — the preview on screen, the text that is copied or emailed, the
 * public page and the PDF — so they never disagree.
 *
 * Plain module — no `server-only`, no path aliases — so the screen, the routes and `node --test`
 * read it.
 */
import { readFieldMap } from "./fieldMap.ts";

export type GuideInput = {
  agencyName: string;
  /** Absent for the general vendor guide. */
  vendorName?: string | null;
  campaignName?: string | null;
  /** The full posting URL. */
  postingUrl: string;
  /** The vendor's stored map, `{ ours: theirs }`; empty for the general guide. */
  fieldMap?: Record<string, string> | null;
  /** The product form's own questions this vendor may fill, `{ key, label }`. */
  formQuestions?: { key: string; label: string; theirs?: string | null }[];
};

export type GuideRow = { field: string; needed: "Yes" | "No"; rule: string };

/** The fields a post is checked for, in the post path's order, then the useful optional ones. */
const BASE: { ours: string[]; needed: "Yes" | "No"; rule: string }[] = [
  { ours: ["phone"], needed: "Yes", rule: "10-digit US number; a leading 1 is dropped" },
  { ours: ["state"], needed: "Yes", rule: "Two letters; we must hold a licence there" },
  { ours: ["first_name", "last_name"], needed: "Yes", rule: "Or full_name" },
  { ours: ["consent_text"], needed: "Yes", rule: "The words the person agreed to, unedited" },
  { ours: ["consent_ip"], needed: "Yes", rule: "IPv4 or IPv6; ip is read when consent_ip is absent" },
  { ours: ["date_of_birth"], needed: "No", rule: "MM/DD/YYYY or YYYY-MM-DD" },
  { ours: ["email"], needed: "No", rule: "Stored on the lead" },
  { ours: ["zip"], needed: "No", rule: "Stored on the lead" },
  { ours: ["trusted_form_cert_url"], needed: "No", rule: "Filed as the consent certificate" },
  { ours: ["jornaya_leadid"], needed: "No", rule: "Filed as the consent certificate" },
];

/** Our field names → the names this vendor sends, where the map says so. */
function theirName(map: Map<string, string>, ours: string) {
  return map.get(ours) ?? ours;
}

export function guideRows(input: Pick<GuideInput, "fieldMap" | "formQuestions">): GuideRow[] {
  const map = new Map(readFieldMap(input.fieldMap ?? {}).map((entry) => [entry.ours, entry.theirs]));
  const rows: GuideRow[] = BASE.map((row) => ({ field: row.ours.map((ours) => theirName(map, ours)).join(", "), needed: row.needed, rule: row.rule }));
  for (const question of input.formQuestions ?? []) {
    rows.push({ field: question.theirs || map.get(question.key) || question.key, needed: "No", rule: `Answers the form question "${question.label}"` });
  }
  return rows;
}

/** The replies a vendor gets, in a sentence each. */
export const GUIDE_REPLIES: { code: string; meaning: string }[] = [
  { code: "accepted", meaning: "The lead was taken. lead_id names it." },
  { code: "duplicate", meaning: "Already in our leads; lead_id names it. Not billable." },
  { code: "invalid_phone", meaning: "No usable 10-digit US phone." },
  { code: "unknown_state", meaning: "No two-letter state." },
  { code: "missing_required_field", meaning: "No name." },
  { code: "missing_consent_text", meaning: "No consent_text." },
  { code: "missing_consent_ip", meaning: "No consent_ip." },
  { code: "invalid_date_of_birth", meaning: "The date of birth could not be read." },
  { code: "state_not_licensed", meaning: "We hold no current licence in that state." },
  { code: "suppressed_dnc", meaning: "On a Do Not Call registry. Not billable." },
  { code: "suppressed_litigator", meaning: "A known TCPA litigator. Not billable." },
  { code: "campaign_not_accepting", meaning: "The campaign is not taking leads right now." },
  { code: "daily_cap_reached", meaning: "Today's cap is reached; post again tomorrow." },
  { code: "outside_posting_hours", meaning: "Outside the hours we take leads." },
  { code: "rate_limited", meaning: "Too fast; retry after the Retry-After header." },
  { code: "unauthorised", meaning: "The key is missing or not valid." },
];

/** A made-up lead in the vendor's own field names, for the sample request. */
export function samplePayload(fieldMap?: Record<string, string> | null): Record<string, string> {
  const map = new Map(readFieldMap(fieldMap ?? {}).map((entry) => [entry.ours, entry.theirs]));
  const sample: Record<string, string> = {
    first_name: "Martha",
    last_name: "Reyes",
    phone: "5125550142",
    state: "TX",
    date_of_birth: "03/14/1956",
    consent_text: "By clicking Get quotes I agree to be contacted…",
    consent_ip: "73.12.4.9",
  };
  return Object.fromEntries(Object.entries(sample).map(([ours, value]) => [theirName(map, ours), value]));
}

export function sampleCurl(postingUrl: string, fieldMap?: Record<string, string> | null): string {
  const body = JSON.stringify(samplePayload(fieldMap));
  return [
    `curl -X POST ${postingUrl} \\`,
    `  -H "Authorization: Bearer $INSURVAS_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Idempotency-Key: your-lead-id" \\`,
    `  -d '${body}'`,
  ].join("\n");
}

export function guideTitle(input: Pick<GuideInput, "agencyName">) {
  return `Posting leads to ${input.agencyName || "your agency"}`;
}

export function guideSubtitle(input: Pick<GuideInput, "vendorName" | "campaignName">) {
  if (!input.vendorName) return "For every lead vendor";
  return [`For ${input.vendorName}`, input.campaignName].filter(Boolean).join(" · ");
}

/** The guide as plain text: copied, emailed, or read by anyone without the page. */
export function guideText(input: GuideInput): string {
  const rows = guideRows(input);
  const width = Math.max(...rows.map((row) => row.field.length), 5);
  return [
    guideTitle(input),
    guideSubtitle(input),
    "",
    "Address",
    `  POST ${input.postingUrl}`,
    "",
    "Headers",
    "  Authorization: Bearer <your key>   (the key we sent you separately)",
    "  Content-Type: application/json",
    "  Idempotency-Key: your lead id      (optional; a retry with the same id is answered once)",
    "",
    "Fields",
    ...rows.map((row) => `  ${row.field.padEnd(width)}  ${row.needed === "Yes" ? "needed  " : "optional"}  ${row.rule}`),
    "",
    "Replies (JSON)",
    "  accepted (true / false), reason_code, message, lead_id",
    ...GUIDE_REPLIES.map((reply) => `  ${reply.code}: ${reply.meaning}`),
    "",
    "Sample",
    sampleCurl(input.postingUrl, input.fieldMap),
    "",
  ].join("\n");
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

/**
 * The guide as one standalone page: the public link, and the file a vendor is sent. Light and dark
 * from the reader's own setting; no scripts, no outside requests.
 */
export function guideHtml(input: GuideInput): string {
  const rows = guideRows(input);
  const e = escapeHtml;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${e(guideTitle(input))}</title>
<style>
:root{--bg:#fbfcfb;--card:#ffffff;--ink:#0d4037;--body:#26332e;--muted:#4d5f58;--rule:#dbe6e1;--code:#f4f8f6}
@media (prefers-color-scheme: dark){:root{--bg:#08110f;--card:#0d1714;--ink:#f2f7f5;--body:#c9d6d1;--muted:#93a69f;--rule:#1b2a25;--code:#0a1412}}
body{margin:0;background:var(--bg);color:var(--body);font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 48px}
h1{font-size:24px;color:var(--ink);margin:0;letter-spacing:-.02em}
h2{font-size:16px;color:var(--ink);margin:28px 0 8px}
p.sub{margin:4px 0 0;color:var(--muted)}
.m{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
pre{background:var(--code);border:1px solid var(--rule);border-radius:8px;padding:12px;overflow:auto;font-size:12px;color:var(--ink)}
table{width:100%;border-collapse:collapse;background:var(--card)}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:12px}
</style></head><body><main>
<h1>${e(guideTitle(input))}</h1>
<p class="sub">${e(guideSubtitle(input))}</p>
<h2>Address</h2><pre>POST ${e(input.postingUrl)}</pre>
<h2>Headers</h2><pre>Authorization: Bearer &lt;your key&gt;   (the key we sent you separately)
Content-Type: application/json
Idempotency-Key: your lead id      (optional)</pre>
<h2>Fields</h2>
<table><thead><tr><th>Field</th><th>Needed</th><th>Rule</th></tr></thead><tbody>
${rows.map((row) => `<tr><td class="m">${e(row.field)}</td><td>${row.needed}</td><td>${e(row.rule)}</td></tr>`).join("\n")}
</tbody></table>
<h2>Replies</h2>
<p>Every reply is JSON: <span class="m">accepted</span> (true / false), <span class="m">reason_code</span>, <span class="m">message</span>, <span class="m">lead_id</span>.</p>
<table><thead><tr><th>reason_code</th><th>Meaning</th></tr></thead><tbody>
${GUIDE_REPLIES.map((reply) => `<tr><td class="m">${e(reply.code)}</td><td>${e(reply.meaning)}</td></tr>`).join("\n")}
</tbody></table>
<h2>Sample</h2><pre>${e(sampleCurl(input.postingUrl, input.fieldMap))}</pre>
</main></body></html>`;
}
