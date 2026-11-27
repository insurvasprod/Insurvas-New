import { useMemo } from "react";

import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { pickAttempt } from "./logic";
import type { AnswerValue, CaseView, Catalog, DraftRecommendation, IncomeType } from "./types";

export type PaymentSave = {
  method: "ach";
  bank_name: string | null;
  account_type: "checking" | "savings" | null;
  name_on_account: string | null;
  /** Left out keeps the number already on file (the route's rule). */
  routing?: string;
  account?: string;
};

/**
 * One case, read from GET /api/app/applications/cases/:id (the web workspace renders exactly this),
 * and every write the phone makes to it, each the same call the web's WorkspaceProvider makes. A write
 * throws ApiError with the server's own words; the screen keeps what was typed and says so.
 */
export function useCase(caseId: string) {
  const { api } = useSession();
  const loaded = useLoad(() => api<CaseView>(`/api/app/applications/cases/${caseId}`), [caseId]);
  const c = loaded.data;
  const attempt = useMemo(() => (c ? pickAttempt(c) : null), [c]);
  const interview = c?.interviews.primary ?? null;
  const aUrl = attempt ? `/api/app/applications/attempts/${attempt.id}` : null;
  const need = () => { if (!aUrl) throw new Error("This case has no application yet."); return aUrl; };

  const actions = {
    /** Saves answers as they are given; a follow-up hidden again is deleted (PUT …/interview). */
    saveAnswers: (answers: { key: string; value: AnswerValue }[], hidden: string[]) =>
      api(`/api/app/applications/cases/${caseId}/interview`, { method: "PUT", body: { insured_role: "primary", answers, hidden } }),
    /** A case started before the doorway opened its interview: an empty save opens it (the web's startInterview). */
    startInterview: async () => {
      await api(`/api/app/applications/cases/${caseId}/interview`, { method: "PUT", body: { insured_role: "primary", answers: [], hidden: [] } });
      loaded.reload();
    },
    completeInterview: async () => {
      await api(`/api/app/applications/cases/${caseId}/interview?insured=primary`, { method: "POST" });
      loaded.reload();
    },
    saveQuote: async (input: { carrier_id: string; carrier_product_id: string | null; product_code: string; tier: string; face_amount_cents: number; monthly_premium_cents: number }) => {
      const saved = await api<{ id: string; warnings?: { code: string; message: string }[] }>(`/api/app/applications/cases/${caseId}/quotes`, { method: "POST", body: { insured_role: "primary", ...input, riders: [], rating_inputs: {} } });
      loaded.reload();
      return saved;
    },
    selectQuote: async (quoteId: string) => {
      await api(`/api/app/quotes/${quoteId}/select`, { method: "POST" });
      loaded.reload();
    },
    savePayment: async (input: PaymentSave) => {
      await api(`${need()}/payment`, { method: "PUT", body: input });
      loaded.reload();
    },
    saveDraftDay: async (input: { day: number; incomeType: IncomeType; incomeInputs: Record<string, unknown>; overrideReason: string | null }) => {
      await api(`${need()}/draft-day`, { method: "PUT", body: { day: input.day, income_type: input.incomeType, income_inputs: input.incomeInputs, override_reason: input.overrideReason } });
      loaded.reload();
    },
    /** A calculation only; nothing is saved (POST /api/app/draft-dates/recommend). */
    recommend: (incomeType: IncomeType, inputs: Record<string, unknown>) =>
      api<DraftRecommendation>("/api/app/draft-dates/recommend", { method: "POST", body: { income_type: incomeType, ...inputs } }),
    /** One sensitive value; the server writes the access record (with the reason) before it answers. */
    reveal: async (fieldKey: "pay.routing_number" | "pay.account_number", reason: string) =>
      (await api<{ value: string }>(`${need()}/reveal`, { method: "POST", body: { field_key: fieldKey, reason } })).value,
    /** Review's "ready": the server runs its QA check and refuses with the reason. */
    markReady: async () => {
      await api(`${need()}/transition`, { method: "POST", body: { to: "ready", outcome: null, reason_code: null, reason_text: null, policy_number: null, issued_on: null } });
      loaded.reload();
    },
    /** The carriers this agency may quote on the case, with appointment status in the client's state. */
    catalog: () => api<Catalog>(`/api/app/applications/cases/${caseId}/catalog`),
    recordSubmission: async (input: { notes: string | null; submittedAt: string }) => {
      const saved = await api<{ submissionId: string }>(`${need()}/submissions`, { method: "POST", body: { reference: null, reference_kind: "application_no", submitted_at: input.submittedAt, submitted_via: "carrier_portal_manual", notes: input.notes } });
      loaded.reload();
      return saved;
    },
  };

  return { ...loaded, caseView: c, attempt, interview, actions };
}

export type CaseHandle = ReturnType<typeof useCase>;
