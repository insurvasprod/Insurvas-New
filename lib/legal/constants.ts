// SA-5.4 · The document types, and what to call them.

export const LEGAL_DOC_TYPES = ["tos", "privacy", "dpa"] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

export const LEGAL_DOC_LABELS: Record<LegalDocType, string> = {
  tos: "Terms of Service",
  privacy: "Privacy Policy",
  dpa: "Data Processing Agreement",
};

/**
 * The documents a new signup must accept.
 *
 * The DPA is deliberately absent: the ticket lists it as "(later)", and gating signup on a document
 * that does not exist would block every signup. It becomes required the moment a v1 is published,
 * because the gate reads what is published rather than this list.
 */
export const SIGNUP_REQUIRED_DOCS: LegalDocType[] = ["tos", "privacy"];

export type LegalDocumentSummary = {
  id: string;
  doc_type: LegalDocType;
  version: number;
  title: string;
  effective_date: string;
  change_summary: string | null;
  requires_reacceptance: boolean;
  is_draft: boolean;
  published_at: string;
};
