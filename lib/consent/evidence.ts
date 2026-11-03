/**
 * Consent evidence per lead (p-app-consent): the best evidence a lead has, in the words the locker
 * uses. Pure and client-safe — the service classifies with it, the screen labels with it.
 *
 * "Text" is the literal disclosure the customer saw, which we only hold once a certificate's copy
 * has been claimed. A certificate we never claimed is a provider's link, not the words. The time
 * is the certificate's consent timestamp, falling back to when it was captured — the same rule the
 * dialer's consent panel uses — so a certificate always has one.
 *
 * Missing evidence FLAGS a lead; it does not stop the dialer (LA-2.6: "flag, do not block"; the
 * owner confirmed keeping it on 24 Sep). The copy says so rather than promising a refusal.
 */
/** "attested": no certificate, but the partner who submitted it attested the customer's documented
 * consent on the Submit lead form (recorded on the lead's submission audit entry). Better than
 * nothing, and still not the words. */
export type EvidenceLevel = "full" | "no_ip" | "link_only" | "attested" | "lost" | "none";

export type EvidenceArtefact = {
  id: string;
  capture_status: string | null;
  ip: string | null;
  consent_timestamp: string | null;
  captured_at: string | null;
  provider: string | null;
};

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  full: "Text + IP + timestamp",
  no_ip: "Text, no IP",
  link_only: "Link only, no text",
  attested: "Partner attested, no text",
  lost: "Link lost, no text",
  none: "None — flagged",
};

export const EVIDENCE_TONE: Record<EvidenceLevel, "success" | "warning" | "error"> = {
  full: "success",
  no_ip: "warning",
  link_only: "warning",
  attested: "warning",
  lost: "error",
  none: "error",
};

/** The filter the status select offers: every lead, or one evidence bucket. */
export type EvidenceFilter = "every" | "full" | "no_ip" | "no_text" | "none";

export const EVIDENCE_FILTER_LABEL: Record<EvidenceFilter, string> = {
  every: "Every status",
  full: "Full evidence",
  no_ip: "Text, no IP",
  no_text: "Consent text missing",
  none: "No certificate",
};

function levelOf(artefact: EvidenceArtefact): EvidenceLevel {
  if (artefact.capture_status === "claimed") return artefact.ip ? "full" : "no_ip";
  if (artefact.capture_status === "pending") return "link_only";
  return "lost";
}

const RANK: Record<EvidenceLevel, number> = { full: 0, no_ip: 1, link_only: 2, attested: 3, lost: 4, none: 5 };

/** The lead's best certificate and what it amounts to. */
export function bestEvidence(artefacts: readonly EvidenceArtefact[]): { level: EvidenceLevel; artefact: EvidenceArtefact | null } {
  let best: { level: EvidenceLevel; artefact: EvidenceArtefact | null } = { level: "none", artefact: null };
  for (const artefact of artefacts) {
    const level = levelOf(artefact);
    if (RANK[level] < RANK[best.level]) best = { level, artefact };
  }
  return best;
}

/** When consent was given: the certificate's own timestamp, else its capture time, else nothing. */
export function consentGivenAt(artefact: EvidenceArtefact | null): string | null {
  return artefact ? artefact.consent_timestamp ?? artefact.captured_at ?? null : null;
}

/** "4 yr 2 mo", "3 mo", "12 days" — how long the oldest certificate has been kept. */
export function keptFor(fromIso: string, now: number): string {
  const from = new Date(fromIso);
  const to = new Date(now);
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  if (months < 1) {
    const days = Math.max(0, Math.floor((now - from.getTime()) / 86_400_000));
    return days === 1 ? "1 day" : `${days} days`;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return `${rest} mo`;
  return rest ? `${years} yr ${rest} mo` : `${years} yr`;
}

// A fixed month list: some browsers' locale data spells September "Sept", and the boards say "Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Sep 2026, 14:02" in UTC, so the evidence reads the same for everyone who opens it. */
export function evidenceTime(iso: string | null): string {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not recorded";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
