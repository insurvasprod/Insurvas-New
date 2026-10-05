import { type LegalDocType } from "@/lib/legal/constants";
import { type LegalDraft } from "@/lib/legal/adminTypes";

export type Stat = {
  document_id: string;
  doc_type: string;
  version: number;
  title: string;
  label: string;
  is_draft: boolean;
  requires_reacceptance: boolean;
  eligible_users: number;
  accepted_count: number;
};

export type Lookup = {
  email: string;
  found: boolean;
  records: { id: string; doc_type: string; version: number; accepted_at: string; ip: string | null; context: string }[];
};

export type EditorState = {
  title: string;
  content: string;
  effectiveDate: string;
  changeSummary: string;
  requiresReacceptance: boolean;
};

/** The board's card titles are sentence case; the stored labels stay as they are elsewhere. */
export const CARD_TITLE: Record<LegalDocType, string> = {
  tos: "Terms of service",
  privacy: "Privacy policy",
  dpa: "Data processing agreement",
};

export const SWITCH_LABEL: Record<LegalDocType, string> = { tos: "Terms", privacy: "Privacy", dpa: "DPA" };

export const DRAFT_KEY = "draft";

export const VISIBLE_VERSIONS = 6;

export function fromDraft(draft: LegalDraft): EditorState {
  return {
    title: draft.title,
    content: draft.content,
    effectiveDate: draft.effective_date,
    changeSummary: draft.change_summary ?? "",
    requiresReacceptance: draft.requires_reacceptance,
  };
}

export function sameEditor(a: EditorState, b: EditorState) {
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.effectiveDate === b.effectiveDate &&
    a.changeSummary.trim() === b.changeSummary.trim() &&
    a.requiresReacceptance === b.requiresReacceptance
  );
}

export function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/legal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body: json as Record<string, unknown> | null };
}
