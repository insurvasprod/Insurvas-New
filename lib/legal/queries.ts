import "server-only";

// SA-5.4 · Reading legal documents and acceptance history.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { LegalDocType, LegalDocumentSummary } from "./constants";

export type LegalDocument = LegalDocumentSummary & { content: string };

/** The current version of every document — what a new signup is asked to accept. */
export async function fetchCurrentDocuments(): Promise<LegalDocumentSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("current_legal_documents").select("*").order("doc_type");
  return (data as LegalDocumentSummary[] | null) ?? [];
}

/**
 * A specific version, or the current one when no version is given.
 *
 * Fetching by explicit version is what makes "the text of v1 is still retrievable after v2 is
 * published" true — the acceptance record stores a version, and this is how that record is read
 * back as the text the person actually saw.
 */
export async function fetchDocument(docType: LegalDocType, version?: number): Promise<LegalDocument | null> {
  const supabase = getSupabaseServiceClient();
  let query = supabase.from("legal_documents").select("*").eq("doc_type", docType);

  query = version === undefined
    ? query.order("version", { ascending: false }).limit(1)
    : query.eq("version", version);

  const { data } = await query.maybeSingle<LegalDocument>();
  return data;
}

/** Every version of every document, newest first — the admin's archive view. */
export async function fetchAllVersions(): Promise<LegalDocumentSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("legal_documents")
    .select("id, doc_type, version, title, effective_date, change_summary, requires_reacceptance, is_draft, published_at")
    .order("doc_type")
    .order("version", { ascending: false });

  return (data as LegalDocumentSummary[] | null) ?? [];
}

export type AcceptanceStat = {
  document_id: string;
  doc_type: LegalDocType;
  version: number;
  title: string;
  is_draft: boolean;
  requires_reacceptance: boolean;
  published_at: string;
  eligible_users: number;
  accepted_count: number;
};

export async function fetchAcceptanceStats(): Promise<AcceptanceStat[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("admin_legal_acceptance_stats").select("*").order("doc_type");
  return (data as AcceptanceStat[] | null) ?? [];
}

export type AcceptanceRecord = {
  id: string;
  doc_type: LegalDocType;
  version: number;
  accepted_at: string;
  ip: string | null;
  context: string;
  user_id: string;
};

/**
 * One user's full acceptance history — the ticket's "any user's history on one screen".
 *
 * Ordered by when they accepted, so it reads as the sequence of agreements it is.
 */
export async function fetchUserAcceptances(userId: string): Promise<AcceptanceRecord[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("legal_acceptances")
    .select("id, doc_type, version, accepted_at, ip, context, user_id")
    .eq("user_id", userId)
    .order("accepted_at", { ascending: false });

  return (data ?? []) as AcceptanceRecord[];
}

/** Users who have NOT accepted a given document — who to chase, rather than just a percentage. */
export async function fetchOutstandingUsers(documentId: string, limit = 50) {
  const supabase = getSupabaseServiceClient();

  const { data: accepted } = await supabase
    .from("legal_acceptances").select("user_id").eq("document_id", documentId);
  const acceptedIds = (accepted ?? []).map((a) => a.user_id);

  let query = supabase
    .from("users")
    .select("id, email, name, last_login_at")
    .neq("status", "inactive")
    .order("created_at", { ascending: false })
    .limit(limit);

  // An empty `not in ()` is a syntax error in Postgres, so it is only applied when non-empty.
  if (acceptedIds.length > 0) query = query.not("id", "in", `(${acceptedIds.join(",")})`);

  const { data } = await query;
  return data ?? [];
}
