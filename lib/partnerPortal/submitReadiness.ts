/**
 * LA-1.6-7: the partner submit button stays disabled while something is missing, and says what.
 * Pure, so the component and a node test share one rule. Items come back in the order the form asks
 * for them: screening, the DNC acknowledgement, the required fields, the duplicate reason, consent.
 */
export function outstandingSubmitItems(input: {
  screened: boolean;
  dncPending: boolean;
  /** The labels of required, visible fields that are still empty, in form order. */
  missingRequired: readonly string[];
  duplicateReasonMissing: boolean;
  consentGiven: boolean;
}): string[] {
  return [
    ...(!input.screened ? ["Phone screening"] : []),
    ...(input.dncPending ? ["DNC acknowledgement"] : []),
    ...input.missingRequired,
    ...(input.duplicateReasonMissing ? ["Reason this is a separate lead"] : []),
    ...(!input.consentGiven ? ["Consent"] : []),
  ];
}
