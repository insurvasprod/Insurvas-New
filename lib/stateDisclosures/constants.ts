// The dialer blocks on an exact (state, product_code) match. That is worth stating plainly here,
// because it is the reason this module exists: `state_disclosures` had a reader in the dialer, a
// read policy for `tenant_app`, and write grants for `service_role` only — and nothing in the
// product ever wrote a row. Every tenant, every state, every product was therefore blocked from
// dialing with the honest message "No approved disclosure is configured", and no screen anywhere
// could clear it.
export const DISCLOSURE_BLOCK_REASON =
  "Outbound dialing is blocked for a state and product until a disclosure is published here.";

// `product_code` is free text on `tenant_scripts` and is fed from the lead's `product_line`, so
// this list is a convenience rather than a constraint — the form offers these and accepts others.
// `term_life` leads the list because it is the dialer's fallback when a lead carries no product.
export const COMMON_PRODUCT_CODES = [
  "term_life",
  "whole_life",
  "final_expense",
  "indexed_universal_life",
  "mortgage_protection",
  "annuity",
  "medicare_advantage",
  "medicare_supplement",
  "aca_health",
  "short_term_health",
] as const;

export type StateDisclosure = {
  id: string;
  state: string;
  product_code: string;
  required_text: string;
  effective_from: string;
  created_at: string;
  // True when this is the row the dialer would actually serve today for its (state, product) pair:
  // the newest one whose effective_from has arrived. A future-dated row is real but not yet live,
  // and a superseded row is history. The screen has to distinguish all three or it is guessing.
  live: boolean;
  status: "live" | "scheduled" | "superseded";
};

export type DisclosureCoverage = {
  product_code: string;
  published: string[];
  missing: string[];
};

// scripts/seed-state-disclosures.mjs wrote every live row with this marker as its first line, and
// refuses to overwrite any row that does not start with it. Detecting it the same way (a prefix,
// ignoring leading whitespace) keeps the screen and the seed agreeing on what "placeholder" means.
export const PLACEHOLDER_PREFIX = "[PLACEHOLDER";

export function isPlaceholderDisclosure(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trimStart().startsWith(PLACEHOLDER_PREFIX);
}

export type DisclosureProposalStatus = "pending" | "approved" | "rejected" | "cancelled";

/** A proposed version waiting for (or past) a second admin's review. Never read by the dialer. */
export type DisclosureProposal = {
  id: string;
  product_code: string;
  states: string[];
  required_text: string;
  effective_from: string;
  note: string | null;
  source: "editor" | "import";
  status: DisclosureProposalStatus;
  proposed_by: string | null;
  proposed_by_name: string | null;
  proposed_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  published_ids: string[];
  /** Set only when the author approved their own proposal as the sole eligible admin. */
  self_approval_attestation: string | null;
};

export const ATTESTATION_MIN = 10;
export const ATTESTATION_MAX = 500;

export const REVIEW_SCHEMA_MISSING =
  "This setting needs a database update that has not been applied yet.";
