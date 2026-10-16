/**
 * LA-6.2 (Notion sprint, Module 6 — Compliance) · the pre-transfer verdict, decided from the answers
 * the existing checks gave. Nothing here checks anything: every answer comes from the module that
 * owns the subject (transferGate.ts makes the calls). This file only applies the precedence, which
 * is inherited from LA-1.5 and the LA-6.2 page, not re-decided:
 *
 *   TCPA litigator               REJECT — no override. Outranks every list: DNC is not also reported.
 *   invalid phone                REJECT
 *   partner not approved         REJECT
 *   internal do-not-call         REJECT — our own list is absolute.
 *   screening incomplete         REJECT — LA-1.5 fails closed when a vendor is down.
 *   federal / state DNC          WARN  — the consumer called; recorded.
 *   no consent artefact          WARN, prominently (or BLOCK when the tenant chose that, LA-6.8).
 *   existing customer            WARN
 *   outside legal hours          WARN
 *   any other check incomplete   WARN — recorded as incomplete, never as a pass.
 *
 * Kept free of runtime imports so `node --test` loads it directly.
 */

export type GateCheckName =
  | "partner_product_approved"
  | "tcpa_litigator"
  | "internal_dnc"
  | "federal_state_dnc"
  | "consent_artefact"
  | "existing_customer"
  | "calling_hours";

/**
 * pass = nothing wrong; hit = the problem the check looks for is there (a litigator, a listing, no
 * consent artefact, a known customer, outside the window, not approved); incomplete = it could not
 * answer; skipped = switched off, or not reported because a higher check outranks it.
 */
export type GateCheckResult = "pass" | "hit" | "incomplete" | "skipped";

export type GateCheck = {
  check: GateCheckName;
  result: GateCheckResult;
  detail: string;
  source_module: string;
  source_record_id: string | null;
  duration_ms: number;
};

export type GateVerdict = "accept" | "accept_with_warnings" | "reject";

export type BlockingReason =
  | "tcpa_litigator"
  | "invalid_phone"
  | "partner_not_approved"
  | "internal_dnc"
  | "screening_incomplete"
  | "consent_missing";

export type GateWarning = { check: GateCheckName; code: string; message: string };

export type GateDecision = {
  verdict: GateVerdict;
  blockingReason: BlockingReason | null;
  checks: GateCheck[];
  warnings: GateWarning[];
};

export const SOURCE_MODULE: Record<GateCheckName, string> = {
  partner_product_approved: "LA-1.3",
  tcpa_litigator: "LA-1.5",
  internal_dnc: "LA-2.3",
  federal_state_dnc: "LA-2.3",
  consent_artefact: "LA-2.6",
  existing_customer: "LA-1.24",
  calling_hours: "LA-2.4",
};

/** The checks that cannot be switched off (LA-6.8). */
export const LOCKED_ON_CHECKS: readonly GateCheckName[] = ["tcpa_litigator", "internal_dnc"];

export const WARNING_COPY: Record<string, string> = {
  federal_state_dnc: "This number is on a federal or state do-not-call list. Inbound transfers are consumer-initiated; recorded.",
  consent_missing: "No consent artefact is on file for this number. This is the gap that loses a TCPA case.",
  existing_customer: "This person already exists in your book.",
  calling_hours: "This transfer is outside legal calling hours for the state. The consumer called; recorded.",
  incomplete: "A check could not be completed. Do not treat it as passed.",
};

/** What the partner is shown on a reject: one code, never the reason or the number (Q9). */
export const PARTNER_REJECT_CODE = "compliance_screening";

export type GateInputs = {
  invalidPhone: boolean;
  checks: GateCheck[];
  consentMissingAction: "warn" | "block";
};

function find(checks: GateCheck[], name: GateCheckName) {
  return checks.find((c) => c.check === name) ?? null;
}

/** The verdict from the checks' answers. Every check passed in is kept, in order, in the record. */
export function decideTransfer(input: GateInputs): GateDecision {
  const checks = input.checks.map((c) => ({ ...c }));
  const litigator = find(checks, "tcpa_litigator");
  // A litigator hit is not also reported as a DNC hit (LA-1.5's rule).
  if (litigator?.result === "hit") {
    for (const c of checks) {
      if ((c.check === "internal_dnc" || c.check === "federal_state_dnc") && c.result === "hit") {
        c.result = "skipped";
        c.detail = "Not reported: the litigator hit outranks it.";
      }
    }
  }
  const reject = (blockingReason: BlockingReason): GateDecision => ({ verdict: "reject", blockingReason, checks, warnings: [] });

  if (litigator?.result === "hit") return reject("tcpa_litigator");
  if (input.invalidPhone) return reject("invalid_phone");
  const approved = find(checks, "partner_product_approved");
  if (approved?.result === "hit") return reject("partner_not_approved");
  if (approved?.result === "incomplete") return reject("screening_incomplete");
  if (find(checks, "internal_dnc")?.result === "hit") return reject("internal_dnc");
  // LA-1.5 fails closed: a screen that could not complete is not a safe number.
  if (litigator?.result === "incomplete" || find(checks, "internal_dnc")?.result === "incomplete") return reject("screening_incomplete");
  const consent = find(checks, "consent_artefact");
  if (consent?.result === "hit" && input.consentMissingAction === "block") return reject("consent_missing");

  const warnings: GateWarning[] = [];
  for (const c of checks) {
    if (c.result === "incomplete") warnings.push({ check: c.check, code: `${c.check}_incomplete`, message: `${WARNING_COPY.incomplete} (${c.check.replace(/_/g, " ")})` });
    else if (c.result === "hit") {
      if (c.check === "federal_state_dnc") warnings.push({ check: c.check, code: "federal_state_dnc", message: WARNING_COPY.federal_state_dnc });
      if (c.check === "consent_artefact") warnings.push({ check: c.check, code: "consent_missing", message: WARNING_COPY.consent_missing });
      if (c.check === "existing_customer") warnings.push({ check: c.check, code: "existing_customer", message: WARNING_COPY.existing_customer });
      if (c.check === "calling_hours") warnings.push({ check: c.check, code: "calling_hours", message: WARNING_COPY.calling_hours });
    }
  }
  return { verdict: warnings.length ? "accept_with_warnings" : "accept", blockingReason: null, checks, warnings };
}

/**
 * Which path produced the accept. On number entry the gate IS the pre-transfer screen. At submit it
 * counts only when the same submission was accepted on number entry first; a submit with no earlier
 * screen means the closer was already on the line when the checks ran.
 */
export function screenedBeforeTransfer(stage: "number_entry" | "submit", earlierAcceptOnEntry: boolean): boolean {
  return stage === "number_entry" ? true : earlierAcceptOnEntry;
}

/** The partner-facing payload of a reject: a code, the count this month, the neutral close. Never a number or a reason. */
export function partnerRejectPayload(countThisMonth: number, neutralScript: string) {
  return {
    error: "Rejected — compliance screening.",
    code: PARTNER_REJECT_CODE,
    blocked: true,
    blocked_count: countThisMonth,
    neutral_end_call_script: neutralScript,
  };
}

/** The neutral copy every partner-facing acknowledgement carries: never which list or check. */
export const PARTNER_ACK_MESSAGE = "Compliance review: confirm the consumer asked to be connected before you continue. Recorded.";

/**
 * The partner-facing payload of an accept on number entry: cleared, when it was checked, and — when
 * LA-1.5's submit step needs the closer to acknowledge something — the acknowledgement it needs with
 * the neutral copy. Never the screening outcome, the vendor answer, the gate's verdict or warnings,
 * or any digits of the number (Q9).
 *
 * The acknowledgement keeps LA-1.5's `code` because the partner form and createPartnerLead key the
 * acknowledgement on it; renaming it to a neutral code is a change to those two (outside LA-6).
 */
export function partnerClearedPayload(screening: { warning: { code: string } | null; checkedAt: string | null }) {
  return {
    screened: true,
    verdict: "cleared" as const,
    warning: screening.warning ? { code: screening.warning.code, message: PARTNER_ACK_MESSAGE } : null,
    checked_at: screening.checkedAt,
  };
}

/** Runs one check against the budget: a check that does not answer in time is incomplete, never a pass. */
export async function timed(name: GateCheckName, budgetMs: number, run: () => Promise<Omit<GateCheck, "check" | "duration_ms" | "source_module">>, now: () => number = () => Date.now()): Promise<GateCheck> {
  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      run(),
      new Promise<never>((_, rejectTimer) => {
        timer = setTimeout(() => rejectTimer(new Error("timeout")), budgetMs);
      }),
    ]);
    return { check: name, ...out, source_module: SOURCE_MODULE[name], duration_ms: Math.round(now() - started) };
  } catch (error) {
    const why = error instanceof Error && error.message === "timeout" ? `No answer within ${budgetMs} ms.` : "The check could not be completed.";
    return { check: name, result: "incomplete", detail: why, source_module: SOURCE_MODULE[name], source_record_id: null, duration_ms: Math.round(now() - started) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
