import "server-only";

// Admin Legal page (board p-adm-legal) · drafts, per-version acceptance counts, and the live
// eligible-user count the publish confirmation states.
//
// STAFF CONSOLE ONLY. Nothing that serves a customer — /legal/[type], /api/public/legal, signup,
// /app/accept-terms, /api/app/legal/* or lib/legal/acceptance.ts — may import this module or read
// legal_document_drafts. lib/legal/draftsInvisible.test.mjs holds that line.
//
// The code ships before 20260924363000 is applied: reads treat the missing table/view/function as
// "not available yet" and fall back to today's behaviour; writes that need it throw
// LegalSchemaPendingError, which the route answers with 503.

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { LegalDocType } from "./constants";
import type { AdminLegalVersion, LegalDraft } from "./adminTypes";

// The generated types lag 20260924363000 (they are not regenerated in this pass); untyped access
// stays in this file and nowhere else.
const db = () => getSupabaseServiceClient() as unknown as SupabaseClient;

type DbError = { code?: string | null; message?: string | null } | null | undefined;

const MISSING = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]);

function isMissingSchema(error: DbError): boolean {
  if (!error) return false;
  if (error.code && MISSING.has(error.code)) return true;
  return /does not exist|could not find the (table|function|'.*' column)|schema cache/i.test(error.message ?? "");
}

export const LEGAL_SCHEMA_PENDING = "This setting needs a database update that has not been applied yet.";

export class LegalSchemaPendingError extends Error {
  constructor() {
    super(LEGAL_SCHEMA_PENDING);
    this.name = "LegalSchemaPendingError";
  }
}

/** A write that lost a race: someone published, or saved over the draft, since the page loaded. */
export class LegalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegalConflictError";
  }
}

const DRAFT_COLUMNS =
  "doc_type, title, content, change_summary, effective_date, requires_reacceptance, updated_by, created_at, updated_at";

/** Every saved draft. `supported: false` until the drafts migration is applied. */
export async function fetchLegalDrafts(): Promise<{ drafts: LegalDraft[]; supported: boolean }> {
  const supabase = db();
  const { data, error } = await supabase.from("legal_document_drafts").select(DRAFT_COLUMNS);
  if (error) {
    if (isMissingSchema(error)) return { drafts: [], supported: false };
    throw new Error(`Could not read legal drafts: ${error.message}`);
  }
  return { drafts: (data ?? []) as unknown as LegalDraft[], supported: true };
}

/**
 * Every published version with its text and acceptance count, newest first per document.
 *
 * The count comes from admin_legal_version_acceptance_counts; before that view exists it is null
 * (shown as unknown), never a guessed 0.
 */
export async function fetchAdminLegalVersions(): Promise<AdminLegalVersion[]> {
  const supabase = db();
  const [versions, counts] = await Promise.all([
    supabase
      .from("legal_documents")
      .select("id, doc_type, version, title, content, effective_date, change_summary, requires_reacceptance, is_draft, published_at")
      .order("doc_type")
      .order("version", { ascending: false }),
    supabase.from("admin_legal_version_acceptance_counts").select("document_id, accepted_count"),
  ]);

  if (versions.error) throw new Error(`Could not read legal documents: ${versions.error.message}`);
  if (counts.error && !isMissingSchema(counts.error)) {
    throw new Error(`Could not count acceptances: ${counts.error.message}`);
  }

  const byId = counts.error
    ? null
    : new Map(((counts.data ?? []) as { document_id: string; accepted_count: number }[]).map((c) => [c.document_id, Number(c.accepted_count)]));

  return ((versions.data ?? []) as Omit<AdminLegalVersion, "accepted_count">[]).map((v) => ({
    ...v,
    accepted_count: byId ? (byId.get(v.id) ?? 0) : null,
  }));
}

/**
 * Users a material publish would stop right now: every user whose status is not 'inactive' — the
 * same population admin_legal_acceptance_stats.eligible_users counts, read fresh.
 */
export async function countEligibleUsers(): Promise<number> {
  const supabase = db();
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .neq("status", "inactive");
  if (error) throw new Error(`Could not count users: ${error.message}`);
  return count ?? 0;
}

export type LegalDraftInput = {
  docType: LegalDocType;
  title: string;
  content: string;
  effectiveDate: string;
  changeSummary: string | null;
  requiresReacceptance: boolean;
};

/**
 * Creates or overwrites the draft of one document type.
 *
 * `expectedUpdatedAt` is the draft as the caller last saw it — null for "there was no draft". The
 * write only lands if that is still true, so two admins editing at once cannot silently overwrite
 * each other.
 */
export async function saveLegalDraft(input: LegalDraftInput, expectedUpdatedAt: string | null, adminId: string): Promise<LegalDraft> {
  const supabase = db();
  const row = {
    title: input.title,
    content: input.content,
    effective_date: input.effectiveDate,
    change_summary: input.changeSummary,
    requires_reacceptance: input.requiresReacceptance,
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };

  if (expectedUpdatedAt === null) {
    const { data, error } = await supabase
      .from("legal_document_drafts")
      .insert({ doc_type: input.docType, ...row })
      .select(DRAFT_COLUMNS)
      .single();
    if (error) {
      if (isMissingSchema(error)) throw new LegalSchemaPendingError();
      if (error.code === "23505") {
        throw new LegalConflictError("Someone else started a draft of this document while this page was open. Reload to see it.");
      }
      throw new Error(error.message);
    }
    return data as unknown as LegalDraft;
  }

  const { data, error } = await supabase
    .from("legal_document_drafts")
    .update(row)
    .eq("doc_type", input.docType)
    .eq("updated_at", expectedUpdatedAt)
    .select(DRAFT_COLUMNS);
  if (error) {
    if (isMissingSchema(error)) throw new LegalSchemaPendingError();
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new LegalConflictError("This draft was changed, published or discarded since you loaded it. Reload to see the current state.");
  }
  return data[0] as unknown as LegalDraft;
}

/** Deletes the draft, only if it is still the one the caller saw. Drafts are not evidence. */
export async function discardLegalDraft(docType: LegalDocType, expectedUpdatedAt: string): Promise<void> {
  const supabase = db();
  const { data, error } = await supabase
    .from("legal_document_drafts")
    .delete()
    .eq("doc_type", docType)
    .eq("updated_at", expectedUpdatedAt)
    .select("doc_type");
  if (error) {
    if (isMissingSchema(error)) throw new LegalSchemaPendingError();
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new LegalConflictError("This draft was changed, published or discarded since you loaded it. Reload to see the current state.");
  }
}

/**
 * Publishes the saved draft as `expectedVersion` through publish_legal_draft, which refuses when
 * someone published in between or the draft changed since it was loaded.
 */
export async function publishLegalDraft(
  docType: LegalDocType,
  expectedVersion: number,
  expectedUpdatedAt: string,
  adminId: string,
): Promise<{ id: string; version: number; requires_reacceptance: boolean }> {
  const supabase = db();
  const { data, error } = await supabase.rpc("publish_legal_draft", {
    p_doc_type: docType,
    p_expected_version: expectedVersion,
    p_expected_updated_at: expectedUpdatedAt,
    p_published_by: adminId,
  });

  if (error) {
    const e = error as { code?: string; message?: string };
    if (isMissingSchema(e)) throw new LegalSchemaPendingError();
    if (e.code === "40001" || e.code === "P0002") {
      throw new LegalConflictError(sentence(e.message ?? "The draft could not be published. Reload and try again."));
    }
    throw new Error(e.message ?? "Could not publish");
  }

  const row = (Array.isArray(data) ? data[0] : data) as { id: string; version: number; requires_reacceptance: boolean } | null;
  if (!row) throw new Error("Publishing returned no document");
  return row;
}

function sentence(message: string): string {
  const trimmed = message.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}
