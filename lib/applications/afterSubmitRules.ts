/**
 * Pure rules for everything after submission (LA-3.15, 3.18, 3.20, 3.24, 3.26). No imports, no I/O,
 * client-safe: the server services, the workspace and the unit tests all read the same arithmetic,
 * so nobody does sums on a live call and the screen can never disagree with the record.
 */

// ── confirmation uploads (LA-3.15) ─────────────────────────────────────────

export const MAX_CONFIRMATION_BYTES = 10 * 1024 * 1024;

const CONFIRMATION_TYPES: Record<string, "png" | "jpg" | "pdf"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

/** The stored extension for an upload's MIME type, or null when the type is not accepted. */
export function confirmationExtension(mime: string | null | undefined): "png" | "jpg" | "pdf" | null {
  return CONFIRMATION_TYPES[(mime ?? "").toLowerCase()] ?? null;
}

/** The first bytes agree with the claimed type (a renamed .exe is not a PNG). */
export function magicMatches(ext: "png" | "jpg" | "pdf", head: Uint8Array): boolean {
  if (ext === "png") return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (ext === "jpg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
}

/** `<tenant>/<application>/<submission>.<ext>` — the only shape the submissions CHECK accepts. */
export const confirmationPath = (tenantId: string, applicationId: string, submissionId: string, ext: string) =>
  `${tenantId}/${applicationId}/${submissionId}.${ext}`;

export const welcomePackPath = (tenantId: string, applicationId: string, attemptNo: number, version = 1) =>
  `${tenantId}/${applicationId}/welcome-pack-${attemptNo}${version > 1 ? `-v${version}` : ""}.pdf`;

// ── carrier references (LA-3.15) ───────────────────────────────────────────

/** Spaces are how people copy a reference off a screen, not part of it. */
export const normaliseReference = (value: string) => value.trim().replace(/\s+/g, "").toUpperCase();

/**
 * The carrier's `reference_pattern` against what was typed. A pattern that is not a valid regular
 * expression is "unknown", never an error — the carrier is the authority, the check only warns.
 */
export function referencePatternCheck(pattern: string | null | undefined, reference: string): "match" | "mismatch" | "unknown" {
  const ref = normaliseReference(reference);
  if (!pattern || !ref) return "unknown";
  try {
    const anchored = new RegExp(`^(?:${pattern.replace(/^\^/, "").replace(/\$$/, "")})$`, "i");
    return anchored.test(ref) ? "match" : "mismatch";
  } catch {
    return "unknown";
  }
}

/**
 * A readable example of a simple reference pattern — `^GL-\d{8}$` → "GL-00000000" — for the field
 * hint. Anything beyond literals, \d, [A-Z] / [0-9] classes and fixed counts returns null.
 */
export function patternExample(pattern: string | null | undefined): string | null {
  if (!pattern) return null;
  const src = pattern.replace(/^\^/, "").replace(/\$$/, "");
  let out = "";
  let i = 0;
  while (i < src.length) {
    let unit: string | null = null;
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      if (n === "d") unit = "0";
      else if (n && /[-./ #]/.test(n)) unit = n;
      else return null;
      i += 2;
    } else if (c === "[") {
      const end = src.indexOf("]", i);
      if (end < 0) return null;
      const cls = src.slice(i + 1, end);
      if (/^A-Z(a-z)?$|^a-zA-Z$/.test(cls)) unit = "A";
      else if (cls === "0-9") unit = "0";
      else if (/^A-Z0-9$|^0-9A-Z$/.test(cls)) unit = "X";
      else return null;
      i = end + 1;
    } else if (/[A-Za-z0-9\- ]/.test(c)) {
      unit = c;
      i += 1;
    } else {
      return null;
    }
    let count = 1;
    const q = /^\{(\d+)(?:,(\d*))?\}/.exec(src.slice(i));
    if (q) {
      count = Number(q[1]);
      i += q[0].length;
    } else if (src[i] === "?" ) {
      i += 1;
    } else if (src[i] === "+" || src[i] === "*") {
      return null;
    }
    out += unit.repeat(count);
  }
  return out || null;
}

// ── requirements (LA-3.18) ─────────────────────────────────────────────────

export type Ageing = "ok" | "amber" | "red";
const DAY_MS = 86_400_000;

/** Whole days between an ISO date (or timestamp) and now, never negative. */
export function daysOpen(raisedAt: string, now: number): number {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(raisedAt) ? Date.parse(`${raisedAt}T00:00:00`) : Date.parse(raisedAt);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((now - start) / DAY_MS));
}

/** Amber at N days open, red at 2N (N is the tenant's setting, LA-3.17). */
export function ageingOf(days: number, thresholdDays: number): Ageing {
  const n = Math.max(1, Math.floor(thresholdDays));
  if (days >= n * 2) return "red";
  if (days >= n) return "amber";
  return "ok";
}

type Sortable = { waitingOn: string; raisedAt: string; id?: string };

/** Pending cases order: waiting on the client first (the one thing the agent can move), then oldest. */
export function sortPending<T extends Sortable>(list: readonly T[]): T[] {
  return [...list].sort((a, b) =>
    Number(b.waitingOn === "client") - Number(a.waitingOn === "client")
    || a.raisedAt.localeCompare(b.raisedAt)
    || (a.id ?? "").localeCompare(b.id ?? ""));
}

export const OPEN_REQUIREMENT_STATUSES = ["open", "in_progress"] as const;
export const isOpenStatus = (status: string) => (OPEN_REQUIREMENT_STATUSES as readonly string[]).includes(status);

// ── counteroffers (LA-3.26) ────────────────────────────────────────────────

/** One decimal place of a percentage, from integers only: (−500000, 1500000) → "−33.3%". */
export function percentChange(delta: number, base: number): string {
  if (!base) return "—";
  const tenths = Math.round((Math.abs(delta) * 1000) / Math.abs(base));
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

const usd = (cents: number) => {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
};
const usdWhole = (cents: number) => `$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
const signed = (cents: number, fmt: (c: number) => string) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${fmt(cents)}`;

export type CoverageTerms = { tier: string | null; healthClass: string | null; faceCents: number; monthlyCents: number };

export function counterofferDelta(applied: CoverageTerms, offered: CoverageTerms) {
  const faceCents = offered.faceCents - applied.faceCents;
  const monthlyCents = offered.monthlyCents - applied.monthlyCents;
  return {
    faceCents,
    monthlyCents,
    face: faceCents === 0 ? "No change" : signed(faceCents, usdWhole),
    monthly: monthlyCents === 0 ? "No change" : signed(monthlyCents, usd),
    facePercent: percentChange(faceCents, applied.faceCents),
    monthlyPercent: percentChange(monthlyCents, applied.monthlyCents),
    tierChanged: (applied.tier ?? null) !== (offered.tier ?? null),
    classChanged: (applied.healthClass ?? null) !== (offered.healthClass ?? null),
  };
}

/** What a benefit-type change means for the client, in the words to read them. */
export function tierChangeLine(applied: string | null, offered: string | null): string {
  if ((applied ?? null) === (offered ?? null)) return "No change";
  const waiting = (t: string | null) => t === "graded" || t === "modified" || t === "gi";
  if (!waiting(applied) && waiting(offered)) return "Two-year wait added";
  if (waiting(applied) && !waiting(offered)) return "Waiting period removed";
  return "Changed";
}

/** Whole days from one ISO date to another (positive = later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The first draft on `draftDay` on or after an effective date, as YYYY-MM-DD. */
export function firstDraftOn(effectiveOn: string, draftDay: number): string {
  const [y, m, d] = effectiveOn.split("-").map(Number);
  let year = y;
  let month = m;
  if (d > draftDay) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(draftDay).padStart(2, "0")}`;
}

// ── welcome pack (LA-3.20) ─────────────────────────────────────────────────

export const LOCKED_TOKENS = ["{statement_descriptor}", "{monthly_amount}", "{draft_day}", "{agent_phone}"] as const;

export type WelcomeFacts = {
  client_first_name: string;
  carrier_name: string;
  coverage_amount: string;
  product_name: string;
  statement_descriptor: string;
  monthly_amount: string;
  draft_day: string;
  beneficiaries: string;
  reference: string;
  agent_name: string;
  agent_phone: string;
  agent_email: string;
};

/**
 * Fill a welcome-pack template. The four locked facts always render: a template that lost one of
 * them (settings validation should make that impossible) gets it appended rather than dropped.
 */
export function renderWelcomeTemplate(template: { subject: string; body: string }, facts: WelcomeFacts): { subject: string; body: string } {
  const fill = (text: string) => text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in facts ? facts[key as keyof WelcomeFacts] : whole));
  let body = template.body;
  const missing = LOCKED_TOKENS.filter((t) => !body.includes(t));
  if (missing.length) {
    body += `\n\nStatement shows: {statement_descriptor}\nAmount: {monthly_amount} on the {draft_day}\nCall me: {agent_phone}`;
  }
  return { subject: fill(template.subject), body: fill(body) };
}

/** Which locked facts have no value — the pack is held for review rather than sent without them. */
export function missingLockedFacts(facts: Pick<WelcomeFacts, "statement_descriptor" | "monthly_amount" | "draft_day" | "agent_phone">): string[] {
  const names: Record<string, string> = { statement_descriptor: "the statement descriptor", monthly_amount: "the monthly amount", draft_day: "the draft day", agent_phone: "your phone number" };
  return (Object.keys(names) as (keyof typeof names)[]).filter((k) => !String(facts[k as keyof typeof facts] ?? "").trim()).map((k) => names[k]);
}

// ── household (LA-3.24) ────────────────────────────────────────────────────

export const sameEmail = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && a.trim() !== "" && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The combined monthly total; a side with no premium yet counts as nothing, and says so. */
export function householdTotal(sides: readonly (number | null | undefined)[]): { totalCents: number; complete: boolean } {
  const known = sides.filter((c): c is number => typeof c === "number" && c > 0);
  return { totalCents: known.reduce((n, c) => n + c, 0), complete: known.length === sides.length };
}

/** Keys a spouse may share with the primary insured. Health and identity never are. */
export function isHouseholdKey(key: string): boolean {
  return /^(addr|contact)\.[a-z0-9_]+$/.test(key);
}
