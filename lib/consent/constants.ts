// Shared between the consent locker screen and its service. Split out because the service is
// `server-only` and the screen is a client component — importing a value across that line fails
// the build without failing typecheck.

export type ConsentStatus = "pending" | "claimed" | "expired" | "failed";

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  claimed: "Copy stored",
  pending: "Link only",
  expired: "Link expired",
  failed: "Capture failed",
};

// The distinction the whole locker turns on. A pending row holds a provider URL and nothing else,
// and TrustedForm certificates expire; a claimed row holds the copy that survives the link dying.
export const CONSENT_STATUS_HINTS: Record<ConsentStatus, string> = {
  claimed: "We hold our own copy. This survives the provider's link expiring.",
  pending: "We hold the provider's link but never claimed a copy. If the link expires, this is gone.",
  expired: "The claim window closed before a copy was taken. The link is no longer dependable.",
  failed: "The provider refused the claim. There is no copy.",
};

export type ConsentArtefact = {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  provider: string;
  certificateId: string | null;
  certificateUrl: string | null;
  status: ConsentStatus;
  captureError: string | null;
  capturedAt: string;
  claimedAt: string | null;
  consentTimestamp: string | null;
  ip: string | null;
  sourceUrl: string | null;
  landingPage: string | null;
  hasStoredCopy: boolean;
  vendorName: string | null;
};

export type ConsentCoverage = {
  vendorId: string;
  vendorName: string;
  leads: number;
  claimedCertificates: number;
  anyCertificate: number;
  claimedPct: number | null;
};
