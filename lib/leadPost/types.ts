/**
 * Shapes and labels the Lead posting screen shares with the server. Plain module: a "use client"
 * file may import it, which it may not do with anything under `server-only`.
 */

export type PostKey = {
  id: string;
  vendorId: string;
  vendorName: string;
  keyPrefix: string;
  /** Stored form, `{ ours: theirs }` — read it through `readFieldMap`, never directly. */
  fieldMap: Record<string, string>;
  /** A note per mapped field, keyed by our field. Empty until the migration is applied. */
  fieldNotes: Record<string, string>;
  /** The campaign this key is bound to; null means "the vendor's accepting campaign". */
  campaignId: string | null;
  isActive: boolean;
  createdAt: string;
  rotatedAt: string | null;
  lastUsedAt: string | null;
};

export type PostKeyStats = {
  keyId: string;
  posts: number;
  rejected: number;
  /** True when the log has no key column yet and the figures are the vendor's, across its keys. */
  perVendor: boolean;
  /** Posts from before per-key logging, for this vendor — shown on its newest key only. */
  earlierPosts: number;
  earlierRejected: number;
};

export type PostCampaign = { id: string; name: string; vendorId: string; status: string };

export type RejectionCount = { reasonCode: string; count: number };

export type PostKeysLoaded = {
  keys: PostKey[];
  vendors: { id: string; name: string }[];
  campaigns: PostCampaign[];
  stats: PostKeyStats[];
  rejections: RejectionCount[];
  windowDays: number;
  /** False until migration 20260924130000 is applied: campaign binding and notes cannot be saved. */
  schemaReady: boolean;
  /** This workspace's id: vendors post to /api/post/<workspaceId>. */
  workspaceId: string;
};

/** Every reason a post can be refused, in words a vendor manager would use. */
export const REJECTION_LABELS: Record<string, string> = {
  duplicate: "Already in your leads",
  suppressed_litigator: "Known TCPA litigator",
  suppressed_internal: "On your do-not-call list",
  suppressed_dnc: "On a do-not-call registry",
  invalid_phone: "No usable 10-digit phone",
  missing_required_field: "No name supplied",
  unknown_state: "No two-letter state",
  campaign_not_accepting: "Campaign not accepting",
  scrub_unavailable: "Suppression check unavailable",
  rate_limited: "Posting too fast",
  unauthorised: "Key not valid",
  missing_consent_text: "No consent text",
  missing_consent_ip: "Missing consent IP",
  invalid_date_of_birth: "Unparseable date of birth",
  state_not_licensed: "State not licensed",
};

/** Red where the lead itself is unusable or undialable; amber where the post could succeed later. */
export const REJECTION_TONE: Record<string, "error" | "warning"> = {
  suppressed_litigator: "error",
  suppressed_internal: "error",
  suppressed_dnc: "error",
  invalid_phone: "error",
  missing_required_field: "error",
  unknown_state: "error",
  missing_consent_text: "error",
  missing_consent_ip: "error",
  invalid_date_of_birth: "error",
  state_not_licensed: "error",
  duplicate: "warning",
  campaign_not_accepting: "warning",
  scrub_unavailable: "warning",
  rate_limited: "warning",
  unauthorised: "warning",
};
