/**
 * AG-0.7 (Notion sprint, Agency Module 0) · offboarding, with no database.
 *
 * We deliberately do NOT keep accruing chargebacks against a departed producer: a deactivated user cannot read
 * his own balance, and accruing a debt he cannot see is indefensible. So a chargeback dated after his
 * offboarding date is the AGENCY's — an agency-level cost entry, never a producer debit. The consequence is
 * that the owner must be told the exposure before confirming; offboardSentence is that sentence.
 */

export type ChargebackOwner = "producer" | "agency";

export function chargebackOwner(producer: { status: string; offboardedOn: string | null }, chargebackOn: string): ChargebackOwner {
  if (producer.status === "offboarded" && producer.offboardedOn && chargebackOn > producer.offboardedOn) return "agency";
  return "producer";
}

/** The plain sentence the confirmation screen shows before the button. */
export function offboardSentence(name: string, policiesInWindow: number): string {
  if (policiesInWindow === 0) return `${name} has no policies inside the chargeback window. Nothing will be charged to the agency.`;
  const n = policiesInWindow === 1 ? "this 1 policy" : `these ${policiesInWindow} policies`;
  return `Lapses on ${n} after today will be charged to the agency, not to ${name}.`;
}

/** A frozen balance stays exactly what it was — negative included. Never clamped. */
export function freezeBalance(balanceCents: number): number {
  return balanceCents;
}
