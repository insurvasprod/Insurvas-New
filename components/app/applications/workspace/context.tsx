"use client";

/**
 * The application workspace's one state object (LA-3). Every step reads and writes through this,
 * never through its own fetch: the QA rail is derived from the same attempt the step is editing, so
 * the verdict can never lag the screen.
 *
 * Two modes, one surface:
 *   - sample (design preview): everything stays in local state.
 *   - live: typed values and interview answers save as they are given (debounced per field, so a
 *     dropped call loses nothing), and the explicit `actions` call the API and then re-read the case.
 * A failed save keeps what was typed on screen and says so — banking details given once are never
 * silently dropped.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/lib/notify";

import { isWorkspaceStep, type ApplicationOutcome, type InsuredRole, type PaymentMethod, type WorkspaceStep } from "@/lib/applications/constants";
import { keepUnsaved, unsavedInterviewMark, unsavedValueMark } from "@/lib/applications/keepUnsaved";
import { INTERVIEW_VALUE_KEYS } from "@/lib/applications/prefill";
import { runQa, type QaVerdict } from "@/lib/applications/qa";
import type { AttemptView, BeneficiaryView, CaseView, FieldValue, InterviewView, MedicationRow } from "@/lib/applications/types";

export type PaymentSave = {
  method: PaymentMethod;
  routing?: string | null; account?: string | null; account_type?: "checking" | "savings" | null; bank_name?: string | null; name_on_account?: string | null;
  card?: string | null; card_exp_month?: number | null; card_exp_year?: number | null; name_on_card?: string | null;
  billing_frequency?: "monthly" | "quarterly" | "semiannual" | "annual" | null; billing_address_same_as_insured?: boolean | null;
};

export type QuoteSave = {
  carrier_id: string; carrier_product_id?: string | null; product_code: string; tier: string; face_amount_cents: number; monthly_premium_cents: number;
  annual_premium_cents?: number | null; term_length?: number | null; assumed_health_class?: string | null; riders?: { name: string; monthlyPremiumCents: number }[];
  rating_inputs?: Record<string, unknown>; dob?: string | null; age_basis?: "nearest" | "last";
  quotation_template_id?: string | null; template_version?: number | null;
};

export type WorkspaceActions = {
  /** Reveal one sensitive value; writes the access record first. Null in sample mode. */
  reveal: (fieldKey: string) => Promise<string | null>;
  saveSsn: (value: string) => Promise<boolean>;
  savePayment: (input: PaymentSave) => Promise<boolean>;
  saveDraftDay: (input: { day: number | null; incomeType: string | null; incomeInputs: Record<string, unknown>; overrideReason?: string | null }) => Promise<boolean>;
  saveBeneficiaries: (list: BeneficiaryView[]) => Promise<boolean>;
  resolveDisclosure: (disclosureId: string, input: { status: "acknowledged" | "not_applicable"; method?: "read_aloud" | "emailed" | "mailed" | null; note?: string | null }) => Promise<boolean>;
  completeInterview: () => Promise<boolean>;
  /** Open the interview for the insured on screen (a case started before the doorway opened one). */
  startInterview: () => Promise<boolean>;
  saveQuote: (input: QuoteSave) => Promise<{ id: string; warnings: { code: string; message: string }[] } | null>;
  selectQuote: (quoteId: string) => Promise<boolean>;
  transition: (to: "ready" | "draft" | "closed", extra?: { outcome?: ApplicationOutcome; reasonCode?: string | null; reasonText?: string | null; policyNumber?: string | null; issuedOn?: string | null }) => Promise<{ policy?: { linked: boolean; message: string | null } | null } | null>;
  recordSubmission: (input: { reference: string | null; referenceKind: "application_no" | "policy_no"; submittedAt: string | null; submittedVia: "extension" | "copy_assist" | "carrier_portal_manual"; notes?: string | null }) => Promise<{ submissionId: string; duplicate: { applicationId: string; caseId: string } | null } | null>;
  setReference: (submissionId: string, input: { reference?: string | null; policyNumber?: string | null }) => Promise<boolean>;
  nextAttempt: () => Promise<boolean>;
  closeCase: (reasonCode: string, reasonText?: string | null) => Promise<boolean>;
  /** Re-read the case from the server. */
  refresh: () => Promise<void>;
};

export type WorkspaceState = {
  caseView: CaseView;
  /** The attempt on screen: `?attempt=` and `?insured=`, defaulting to the newest live one. */
  attempt: AttemptView;
  /** Every attempt for the insured on screen, oldest first. */
  attemptsForInsured: AttemptView[];
  insured: InsuredRole;
  interview: InterviewView | null;
  step: WorkspaceStep;
  qa: QaVerdict;
  /** A closed attempt is read-only for ever (STATUS-MODEL §4). */
  readOnly: boolean;
  /** True while the page is showing design fixtures. */
  sample: boolean;
  /**
   * The agency's time zone (Settings › Agency profile): times print in it, the same on the server
   * render and in the browser, and the same as the Applications list.
   */
  timeZone: string | undefined;
  /** Something is saving; "Saved" once it has. */
  saving: boolean;
  saveError: string | null;
  goTo: (step: WorkspaceStep, fieldKey?: string | null) => void;
  selectAttempt: (attemptNo: number, insured?: InsuredRole) => void;
  setValue: (key: string, value: FieldValue["value"]) => void;
  markReviewed: (key: string) => void;
  /** Local screen state. Persisted fields go through `actions`. */
  updateAttempt: (patch: Partial<AttemptView>) => void;
  updateInterview: (patch: Partial<InterviewView>) => void;
  actions: WorkspaceActions;
};

const Ctx = createContext<WorkspaceState | null>(null);

export function useWorkspace() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return value;
}

function pickAttempt(c: CaseView, insured: InsuredRole, attemptNo: number | null) {
  const mine = c.attempts.filter((a) => a.insuredRole === insured).sort((a, b) => a.attemptNo - b.attemptNo);
  return (attemptNo ? mine.find((a) => a.attemptNo === attemptNo) : undefined) ?? mine.find((a) => a.status !== "closed") ?? mine[mine.length - 1] ?? c.attempts[0];
}

async function call<T>(url: string, init: { method: string; body?: unknown }): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: init.method, headers: init.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof data?.error === "string" ? data.error : `The server said ${res.status}` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "No connection — your changes are still on screen. Try again." };
  }
}

const SAVE_DELAY = 600;

export function WorkspaceProvider({ initial, sample, timeZone, children }: { initial: CaseView; sample: boolean; timeZone?: string; children: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [caseView, setCaseView] = useState(initial);
  const [pending, setPending] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const valueTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const answerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const medTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnswers = useRef<Record<string, InterviewView["answers"]>>({});
  const flushAnswers = useRef<(() => Promise<void>) | null>(null);

  const insured: InsuredRole = params.get("insured") === "spouse" && caseView.attempts.some((a) => a.insuredRole === "spouse") ? "spouse" : "primary";
  const attemptParam = Number(params.get("attempt")) || null;
  const attempt = pickAttempt(caseView, insured, attemptParam);
  const stepParam = params.get("step");
  const step: WorkspaceStep = isWorkspaceStep(stepParam) ? stepParam : attempt.status === "closed" ? "timeline" : attempt.status === "draft" ? "interview" : "after";
  const interview = caseView.interviews[insured] ?? null;
  const readOnly = attempt.status === "closed";

  useEffect(() => {
    for (const [role, iv] of Object.entries(caseView.interviews)) if (iv && !lastAnswers.current[role]) lastAnswers.current[role] = iv.answers;
  }, [caseView.interviews]);

  const navigate = useCallback((next: { step?: WorkspaceStep; attemptNo?: number; insured?: InsuredRole; hash?: string | null }) => {
    const q = new URLSearchParams(params.toString());
    if (next.step) q.set("step", next.step);
    if (next.insured) { q.set("insured", next.insured); if (!next.attemptNo) q.delete("attempt"); }
    if (next.attemptNo) q.set("attempt", String(next.attemptNo));
    router.replace(`?${q.toString()}${next.hash ? `#${next.hash}` : ""}`, { scroll: false });
    if (next.hash) {
      // The field is usually on another step, which renders only after the URL has moved — and the
      // step being left can hold a field with the same id (Verify's date of birth). Wait for the new
      // step, land on the field, and try again if what was focused was the old step's copy.
      const id = next.hash;
      const deadline = Date.now() + 3000;
      const land = () => {
        const onStep = !next.step || new URLSearchParams(window.location.search).get("step") === next.step;
        const el = onStep ? document.getElementById(id) : null;
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.focus?.({ preventScroll: true });
          window.setTimeout(() => {
            const again = document.getElementById(id);
            const focusable = el.hasAttribute("tabindex") || el.tabIndex >= 0;
            const held = again === el && el.isConnected && (!focusable || document.activeElement === el || el.contains(document.activeElement));
            if (!held && Date.now() < deadline) land();
          }, 150);
          return;
        }
        if (Date.now() < deadline) window.setTimeout(land, 50);
      };
      window.setTimeout(land, 0);
    }
  }, [params, router]);

  // A deep link opened from outside (a pasted URL, the QA rail in another tab, a notification) lands
  // on its field too, not only one reached through navigate().
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      (el as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
    const first = window.setTimeout(go, 200);
    window.addEventListener("hashchange", go);
    return () => { window.clearTimeout(first); window.removeEventListener("hashchange", go); };
  }, []);

  const patchAttempt = useCallback((id: string, fn: (a: AttemptView) => AttemptView) => {
    setCaseView((c) => ({ ...c, attempts: c.attempts.map((a) => (a.id === id ? fn(a) : a)) }));
  }, []);

  // What is on screen but not yet saved: a re-read of the case must not replace it with the older
  // server copy (an answer given while a save that reloads was in flight would be wiped, and the next
  // save would then send it as hidden and delete it).
  const unsavedValues = useRef(new Set<string>());
  const unsavedInterview = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    if (sample) return;
    const r = await call<CaseView>(`/api/app/applications/cases/${caseView.caseId}`, { method: "GET" });
    if (r.ok) setCaseView((prev) => keepUnsaved(prev, r.data, unsavedValues.current, unsavedInterview.current));
  }, [caseView.caseId, sample]);

  /** Run one save; count it while in flight; keep the screen as typed on failure. */
  const run = useCallback(async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, opts: { reload?: boolean; quiet?: boolean } = {}): Promise<T | null> => {
    setPending((n) => n + 1);
    try {
      const r = await fn();
      if (!r.ok) {
        setSaveError(r.error);
        if (!opts.quiet) notify.block(r.error);
        return null;
      }
      setSaveError(null);
      if (opts.reload !== false) await refresh();
      return r.data;
    } finally {
      setPending((n) => n - 1);
    }
  }, [refresh]);

  const attemptId = attempt.id;
  const actions = useMemo<WorkspaceActions>(() => {
    const aUrl = `/api/app/applications/attempts/${attemptId}`;
    const sampleOk = async () => true;
    if (sample) {
      return {
        reveal: async () => { notify.done("Sample data — there is no real value to reveal."); return null; },
        saveSsn: sampleOk, savePayment: sampleOk, saveDraftDay: sampleOk, saveBeneficiaries: sampleOk, resolveDisclosure: sampleOk, completeInterview: sampleOk, startInterview: sampleOk,
        saveQuote: async () => ({ id: `q-${Date.now()}`, warnings: [] }), selectQuote: sampleOk, transition: async () => ({ policy: null }),
        recordSubmission: async () => ({ submissionId: `s-${Date.now()}`, duplicate: null }), setReference: sampleOk, nextAttempt: sampleOk, closeCase: sampleOk, refresh: async () => {},
      };
    }
    const ok = (x: unknown) => x !== null;
    return {
      reveal: async (fieldKey) => (await run<{ value: string }>(() => call(`${aUrl}/reveal`, { method: "POST", body: { field_key: fieldKey } }), { reload: false }))?.value ?? null,
      saveSsn: async (value) => ok(await run(() => call(`${aUrl}/sensitive`, { method: "PUT", body: { field_key: "insured.ssn", value } }))),
      savePayment: async (input) => ok(await run(() => call(`${aUrl}/payment`, { method: "PUT", body: input }))),
      saveDraftDay: async (input) => ok(await run(() => call(`${aUrl}/draft-day`, { method: "PUT", body: { day: input.day, income_type: input.incomeType, income_inputs: input.incomeInputs, override_reason: input.overrideReason ?? null } }))),
      saveBeneficiaries: async (list) => ok(await run(() => call(`${aUrl}/beneficiaries`, { method: "PUT", body: { beneficiaries: list.map((b) => ({ id: b.id, tier: b.tier, first_name: b.first_name, last_name: b.last_name, relationship: b.relationship || "other", relationship_other: b.relationship_other ?? null, dob: b.dob || null, share_bp: b.share_bp, phone: b.phone || null })) } }))),
      resolveDisclosure: async (id, input) => ok(await run(() => call(`${aUrl}/disclosures/${id}`, { method: "PATCH", body: input }))),
      completeInterview: async () => {
        // An answer still waiting on its debounce is part of the call, not an amendment after it.
        await flushAnswers.current?.();
        return ok(await run(() => call(`/api/app/applications/cases/${caseView.caseId}/interview?insured=${insured}`, { method: "POST" })));
      },
      startInterview: async () => ok(await run(() => call(`/api/app/applications/cases/${caseView.caseId}/interview`, { method: "PUT", body: { insured_role: insured, answers: [], hidden: [] } }))),
      saveQuote: async (input) => run<{ id: string; warnings: { code: string; message: string }[] }>(() => call(`/api/app/applications/cases/${caseView.caseId}/quotes`, { method: "POST", body: { insured_role: insured, ...input, riders: input.riders ?? [], rating_inputs: input.rating_inputs ?? {} } })),
      selectQuote: async (quoteId) => ok(await run(() => call(`/api/app/quotes/${quoteId}/select`, { method: "POST" }))),
      transition: async (to, extra = {}) => run(() => call(`${aUrl}/transition`, { method: "POST", body: { to, outcome: extra.outcome ?? null, reason_code: extra.reasonCode ?? null, reason_text: extra.reasonText ?? null, policy_number: extra.policyNumber ?? null, issued_on: extra.issuedOn ?? null } })),
      recordSubmission: async (input) => run(() => call(`${aUrl}/submissions`, { method: "POST", body: { reference: input.reference, reference_kind: input.referenceKind, submitted_at: input.submittedAt, submitted_via: input.submittedVia, notes: input.notes ?? null } })),
      setReference: async (sid, input) => ok(await run(() => call(`${aUrl}/submissions/${sid}`, { method: "PATCH", body: { reference: input.reference, policy_number: input.policyNumber } }))),
      nextAttempt: async () => {
        const r = await run<{ applicationId: string }>(() => call(`${aUrl}/next-attempt`, { method: "POST" }));
        if (r) navigate({ step: "quote", attemptNo: attempt.attemptNo + 1 });
        return Boolean(r);
      },
      closeCase: async (reasonCode, reasonText) => ok(await run(() => call(`/api/app/applications/cases/${caseView.caseId}/close`, { method: "POST", body: { reason_code: reasonCode, reason_text: reasonText ?? null } }))),
      refresh,
    };
  }, [sample, attemptId, attempt.attemptNo, caseView.caseId, insured, run, refresh, navigate]);

  // ── autosave: values (per field) and interview answers / medications ─────
  const queueValue = useCallback((key: string, value: FieldValue["value"], reviewedOnly = false) => {
    if (sample) return;
    const timers = valueTimers.current;
    const id = attemptId;
    const t = timers.get(key);
    if (t) clearTimeout(t);
    const mark = unsavedValueMark(id, key);
    unsavedValues.current.add(mark);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void run(() => call(`/api/app/applications/attempts/${id}/values`, { method: "PATCH", body: reviewedOnly ? { reviewed: [key] } : { values: [{ key, value }] } }), { reload: false, quiet: true })
        .then((saved) => { if (saved !== null && !timers.has(key)) unsavedValues.current.delete(mark); });
    }, reviewedOnly ? 0 : SAVE_DELAY));
  }, [sample, attemptId, run]);

  const queueInterview = useCallback((next: Partial<InterviewView>) => {
    if (sample || !interview) return;
    const caseId = caseView.caseId;
    const role = insured;
    const answersMark = unsavedInterviewMark(interview.id, "answers");
    const medsMark = unsavedInterviewMark(interview.id, "medications");
    if (next.answers) {
      const answers = next.answers;
      if (answerTimer.current) clearTimeout(answerTimer.current);
      unsavedInterview.current.add(answersMark);
      const send = async () => {
        answerTimer.current = null;
        flushAnswers.current = null;
        const before = lastAnswers.current[role] ?? {};
        const changed = Object.entries(answers).filter(([k, v]) => JSON.stringify(before[k]) !== JSON.stringify(v)).map(([key, v]) => ({ key, value: v?.value ?? null, notes: v?.notes ?? null }));
        const hidden = Object.keys(before).filter((k) => !(k in answers));
        lastAnswers.current[role] = answers;
        if (!changed.length && !hidden.length) { if (!answerTimer.current) unsavedInterview.current.delete(answersMark); return; }
        // An answer that can make a disclosure required (existing coverage) re-reads the case, so the
        // rail and the Disclosures step see it without a reload; every other answer saves quietly.
        // Height, weight and tobacco also become application values, so they re-read too.
        const drivesDisclosure = changed.some((a) => a.key.startsWith("existing_")) || hidden.some((k) => k.startsWith("existing_"));
        const drivesValues = changed.some((a) => INTERVIEW_VALUE_KEYS.has(a.key));
        const saved = await run(() => call(`/api/app/applications/cases/${caseId}/interview`, { method: "PUT", body: { insured_role: role, answers: changed, hidden } }), { reload: drivesDisclosure || drivesValues, quiet: true });
        if (saved !== null && !answerTimer.current) unsavedInterview.current.delete(answersMark);
      };
      flushAnswers.current = async () => { if (answerTimer.current) clearTimeout(answerTimer.current); await send(); };
      answerTimer.current = setTimeout(() => { void send(); }, SAVE_DELAY);
    }
    if (next.medications) {
      const meds: MedicationRow[] = next.medications;
      if (medTimer.current) clearTimeout(medTimer.current);
      unsavedInterview.current.add(medsMark);
      medTimer.current = setTimeout(() => {
        medTimer.current = null;
        void run(() => call(`/api/app/applications/cases/${caseId}/interview/medications`, { method: "PUT", body: { insured_role: role, medications: meds.map((m) => ({ name: m.name, dose: m.dose, since: m.since, prescribedFor: m.prescribedFor, prescribedForUnknown: m.prescribedForUnknown, notes: m.notes })) } }), { reload: false, quiet: true })
          .then((saved) => { if (saved !== null && !medTimer.current) unsavedInterview.current.delete(medsMark); });
      }, SAVE_DELAY);
    }
  }, [sample, interview, caseView.caseId, insured, run]);

  // Leaving the page with a save queued: flush it rather than lose it.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (valueTimers.current.size || answerTimer.current || medTimer.current || pending > 0) { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const value = useMemo<WorkspaceState>(() => ({
    caseView,
    attempt,
    attemptsForInsured: caseView.attempts.filter((a) => a.insuredRole === insured).sort((a, b) => a.attemptNo - b.attemptNo),
    insured,
    interview,
    step,
    // The agency's own QA settings, so the rail blocks exactly where the server's Ready check does.
    qa: runQa({ caseId: caseView.caseId, attempt, interview, settings: caseView.qaSettings }),
    readOnly,
    sample,
    timeZone,
    saving: pending > 0,
    saveError,
    goTo: (s, fieldKey) => navigate({ step: s, hash: fieldKey ?? null }),
    selectAttempt: (attemptNo, who) => navigate({ attemptNo: attemptNo || undefined, insured: who ?? insured }),
    setValue: (key, v) => {
      patchAttempt(attempt.id, (a) => ({ ...a, values: { ...a.values, [key]: { ...(a.values[key] ?? { reviewed: true }), value: v, source: "manual", reviewed: true } } }));
      queueValue(key, v);
    },
    markReviewed: (key) => {
      patchAttempt(attempt.id, (a) => (a.values[key] ? { ...a, values: { ...a.values, [key]: { ...a.values[key], reviewed: true } } } : a));
      queueValue(key, null, true);
    },
    updateAttempt: (patch) => patchAttempt(attempt.id, (a) => ({ ...a, ...patch })),
    updateInterview: (patch) => {
      setCaseView((c) => {
        const current = c.interviews[insured];
        return current ? { ...c, interviews: { ...c.interviews, [insured]: { ...current, ...patch } } } : c;
      });
      queueInterview(patch);
    },
    actions,
  }), [caseView, attempt, insured, interview, step, readOnly, sample, timeZone, pending, saveError, navigate, patchAttempt, queueValue, queueInterview, actions]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
