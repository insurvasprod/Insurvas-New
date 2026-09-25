/**
 * The Inbox concept board's screening detail: each check in the order screenPartnerPhone
 * (lib/compliance/screening.ts) actually runs them, which one matched, and which were never reached.
 *
 * The real order differs from the board's sample, and the ladder follows the code:
 *   1. a valid US phone        (invalid → the lead is refused at submit)
 *   2. your own do-not-call list (a hit stops here; the vendors are not called)
 *   3. TCPA litigator          (a hit is refused at submit, so it never reaches the inbox)
 *   4. DNC registry
 *   5. already a lead with you (the same-phone duplicate check)
 * Checks 3–5 run together and rank litigator > DNC > duplicate. A lead in the inbox therefore
 * passed 1 and 3; what is left to say is whether 2, 4 or 5 matched.
 *
 * A tenant-list DNC hit is told apart from a registry hit by the missing result id: the tenant list
 * is checked before the shared cache and stores no vendor result.
 */

export type LadderStep = { key: "phone" | "tenant_dnc" | "litigator" | "dnc_registry" | "duplicate"; label: string; state: "passed" | "match" | "not_reached" | "unknown" };
export type ScreeningLadder = { steps: LadderStep[]; checked: boolean; summary: string };

const LABELS: Record<LadderStep["key"], string> = {
  phone: "Valid US phone",
  tenant_dnc: "Your do-not-call list",
  litigator: "TCPA litigator",
  dnc_registry: "DNC registry",
  duplicate: "Already a lead with you",
};

export function screeningLadder(input: { outcome: string | null | undefined; resultId: string | null | undefined }): ScreeningLadder {
  const step = (key: LadderStep["key"], state: LadderStep["state"]): LadderStep => ({ key, label: LABELS[key], state });
  const outcome = input.outcome ?? null;
  if (!outcome || outcome === "unavailable") {
    return {
      checked: false,
      steps: [step("phone", "passed"), step("tenant_dnc", "unknown"), step("litigator", "unknown"), step("dnc_registry", "unknown"), step("duplicate", "unknown")],
      summary: "Screening did not complete for this lead, so treat the number as unchecked.",
    };
  }
  if (outcome === "dnc" && !input.resultId) {
    return {
      checked: true,
      steps: [step("phone", "passed"), step("tenant_dnc", "match"), step("litigator", "not_reached"), step("dnc_registry", "not_reached"), step("duplicate", "not_reached")],
      summary: "The number is on your own do-not-call list. That check runs first and stops there, so the vendor lists were not consulted.",
    };
  }
  return {
    checked: true,
    steps: [
      step("phone", "passed"),
      step("tenant_dnc", "passed"),
      step("litigator", "passed"),
      step("dnc_registry", outcome === "dnc" ? "match" : "passed"),
      step("duplicate", outcome === "internal_dq" ? "match" : "passed"),
    ],
    summary:
      outcome === "dnc" ? "The DNC registry listed this number. It is a warning, not a block: the partner confirmed before submitting."
        : outcome === "internal_dq" ? "This phone is already on another lead of yours. Check for a duplicate before you dial."
          : "Every check passed. A litigator match is refused at submit, so none reaches this inbox.",
  };
}
