export type ContactPhone = { phone: string; type: "mobile" | "landline" | "other"; is_primary: boolean };
export type ContactEmail = { email: string; is_primary: boolean };

export type ContactInput = {
  first_name: string;
  last_name: string;
  dob?: string | null;
  primary_phone?: string | null;
  email?: string | null;
  state?: string | null;
  address_line1?: string | null;
  city?: string | null;
  postal_code?: string | null;
  custom_fields?: Record<string, unknown>;
  phones?: ContactPhone[];
  emails?: ContactEmail[];
};

export type DuplicateMatch = {
  contact_id: string;
  household_id: string | null;
  first_name: string;
  last_name: string;
  dob: string | null;
  primary_phone: string | null;
  state: string | null;
  custom_fields: Record<string, unknown>;
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
  score: number;
  confidence: "high" | "medium" | "low";
  matched_on: string[];
};

export type ContactRow = {
  id: string;
  tenant_id: string;
  household_id: string | null;
  first_name: string;
  last_name: string;
  dob: string | null;
  primary_phone: string | null;
  state: string | null;
  custom_fields: Record<string, unknown>;
  merged_into_id: string | null;
  created_at: string;
  updated_at: string;
  phones: ContactPhone[];
  emails: ContactEmail[];
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
};

export type FieldSchemaRow = {
  id: string;
  tenant_id: string;
  entity: "contact" | "lead" | "policy" | "application";
  field_key: string;
  label: string;
  type: "text" | "long_text" | "number" | "date" | "single_select" | "multi_select" | "boolean" | "currency" | "phone" | "email" | "ssn";
  options: string[];
  is_required: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** One row of the paginated directory: an active contact, its household label and its flags. */
export type DirectoryRow = ContactRow & {
  household_state: string | null;
  /** "Oyelaran, Chicago IL" — surname, city, state. Null when the contact has no household. */
  household_label: string | null;
  /** Leads linked to this contact (and to anything merged into it). Null before agent_leads.contact_id exists. */
  lead_count: number | null;
  /** In an open review pair. Null when the review queue does not exist yet. */
  open_review: boolean | null;
};

export type ContactDirectory = {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
};

export type DuplicateStats = {
  contacts: number;
  /** Null when only the fallback count is available. */
  households: number | null;
  pending: number | null;
  oldestPendingAt: string | null;
  mergedThisMonth: number | null;
  undoneThisMonth: number | null;
  undoableThisMonth: number | null;
  /** Distinct contacts in an open pair (the directory's "duplicate-suspected" count). */
  flaggedContacts: number | null;
  /** The zone "this month" was cut in: the agency's, else UTC. */
  timezone: string;
};

export type RecentMerge = {
  id: string;
  keptId: string;
  mergedId: string;
  keptName: string;
  mergedName: string;
  mergedAt: string;
  reversedAt: string | null;
  actorName: string | null;
  source: "manual" | "auto";
  /** False when undo would be refused: already undone, or a later merge involves either contact. */
  undoable: boolean;
};

export type ReviewEvidence = { id: string | null; score: number; confidence: DuplicateMatch["confidence"]; matched_on: string[]; created_at: string | null };

/** The head of the queue: two contacts, older first, and why matching paired them. */
export type ReviewPair = { review: ReviewEvidence; existing: ContactRow; incoming: ContactRow };

export type ReviewQueue = { ready: boolean; total: number; index: number; pair: ReviewPair | null };

export type ContactWorkspace = {
  directory: ContactDirectory;
  stats: DuplicateStats;
  merges: RecentMerge[];
  fieldSchema: FieldSchemaRow[];
  /** contact_duplicate_reviews exists: matches are kept until someone resolves them. */
  reviewsReady: boolean;
};
