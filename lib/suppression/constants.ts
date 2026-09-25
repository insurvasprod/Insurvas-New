// The vocabulary the suppression screen and the suppression service share.
//
// Split out of service.ts rather than exported from it, because that file is `server-only` and the
// screen is a client component. A client importing a *value* from a server-only module fails the
// build, and typechecking does not catch it — only the types would have been erased.

export type SuppressionListType = "internal" | "tcpa_litigator" | "federal_dnc" | "state_dnc" | "invalid";
export type SuppressionSource = "disposition" | "complaint" | "manual" | "vendor" | "import";

export const LIST_TYPES: SuppressionListType[] = ["internal", "tcpa_litigator", "federal_dnc", "state_dnc", "invalid"];

// The only two sources a person can legitimately claim on a form. `disposition`, `vendor` and
// `import` are written by the paths that actually did those things; letting a form assert one would
// turn the provenance column into a guess.
export const MANUAL_SOURCES: SuppressionSource[] = ["complaint", "manual"];

export const LIST_TYPE_LABELS: Record<SuppressionListType, string> = {
  internal: "Asked us not to call",
  tcpa_litigator: "Known TCPA litigator",
  federal_dnc: "Federal Do Not Call",
  state_dnc: "State Do Not Call",
  invalid: "Not a working number",
};

export type SuppressionEntry = {
  id: string;
  phoneDigits: string;
  listType: SuppressionListType;
  reason: string;
  source: SuppressionSource | null;
  addedAt: string;
  addedByName: string | null;
  /** Your own list only: the lead the number was suppressed from, when it came off a call. */
  leadId?: string | null;
  leadName?: string | null;
};

/** Ten digits, the way every store holds them. Anything else is not a US number we can suppress. */
export function normalizeDigits(value: string): string | null {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export function formatPhone(digits: string): string {
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}
