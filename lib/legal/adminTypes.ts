// Admin Legal page (board p-adm-legal) · shapes shared by the server page and the client screen.
// Plain module: no server-only imports, so the "use client" screen can import it.

import type { LegalDocType, LegalDocumentSummary } from "./constants";

/** One unpublished draft (legal_document_drafts, 20260924363000). Never read by a customer surface. */
export type LegalDraft = {
  doc_type: LegalDocType;
  title: string;
  content: string;
  change_summary: string | null;
  effective_date: string;
  requires_reacceptance: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A published version as the admin screen shows it: its text, and how many people accepted it. */
export type AdminLegalVersion = LegalDocumentSummary & {
  content: string;
  /** null when admin_legal_version_acceptance_counts is not applied yet — shown as unknown, not 0. */
  accepted_count: number | null;
};

/** The same floor publish_legal_document enforces (20260830111500). */
export const LEGAL_MIN_CONTENT_LENGTH = 50;

/** The number the next publish will allocate, as the database would: max(version) + 1. */
export function nextLegalVersion(versions: { doc_type: string; version: number }[], docType: LegalDocType): number {
  return versions.filter((v) => v.doc_type === docType).reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

// Month names by hand, not Intl: ICU builds disagree ("Sep" / "Sept"), and a server and a browser
// with different ICU data would print different text and fail to hydrate. getUTC* keeps the day fixed.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const utcDay = (date: Date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

/** "2 Apr 2026". A date-only column (effective_date) is a calendar day, so it is read as UTC. */
export function legalDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? "—" : utcDay(date);
}

/** "22 Sep 2026 08:40:55 UTC" — fixed zone, so the server and the browser print the same text. */
export function legalDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : `${utcDay(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}
