/**
 * Team payouts' draft, as plain functions (round 7, 6·A): who is to pay this month, and the one wording for what
 * happens to what someone owes. A plain module, so the server page (the tab's count) and the client board read one
 * rule.
 */
export type PreviewPerson = {
  producerUserId: string; displayName: string; status: string; balanceBeforeCents: number; earnedCents: number; chargebackCents: number; periodCents: number;
  balanceCents: number; alreadyRun: boolean; planModel: string | null; salaryCents: number; bonusCents: number; saveFeeCents: number; absorbedCount: number;
};

/** Below zero before or after the month: the draft dialog asks what happens to it. */
export const owes = (p: Pick<PreviewPerson, "balanceBeforeCents" | "balanceCents">) => p.balanceBeforeCents < 0 || p.balanceCents < 0;

/** Someone the month can pay or close: not paid yet, not the owner, and something moved or is owed. */
export const payable = (p: PreviewPerson) => !p.alreadyRun && p.planModel !== "solo_owner" && (p.periodCents !== 0 || p.balanceCents !== 0);

/** The "Pay {Month}" tab's count. */
export const toPay = (rows: readonly PreviewPerson[]) => rows.filter(payable).length;

/** One wording everywhere (owner 2026-11-10): the choice, and how Runs reads it after. */
export const CHOICE_LABEL = { withhold: "Take it all back", recover: "Take a share", forgive: "Let it go" } as const;
export const DECISION_LABEL: Record<string, string> = { withhold: "Took it all back", recover: "Took a share", forgive: "Let it go", amount: "Stated amount", pay_full: "Paid in full" };
