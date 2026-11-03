/**
 * D15 · is a state's disclosure the compliance-approved wording, or still the seeded placeholder?
 *
 * `state_disclosures` has no approval column. The wording seeded on 2026-09-23
 * (scripts/seed-state-disclosures.mjs) opens with a marker line — "[PLACEHOLDER — NOT
 * COMPLIANCE-APPROVED. …]" — precisely so it cannot pass unnoticed, and replacing the text on
 * /admin/state-disclosures removes it. So the marker IS the approval state: text that opens with it
 * is not approved. No legal wording is written here.
 *
 * Pure, so the workspace, the service and the tests share one reading.
 */

const PLACEHOLDER_MARKER = /^\s*\[\s*PLACEHOLDER\b/i;

export function isPlaceholderDisclosure(text: string | null | undefined): boolean {
  return PLACEHOLDER_MARKER.test(String(text ?? ""));
}

/** The one-line alert the dialer shows while the wording is the placeholder. */
export function unapprovedDisclosureLine(stateName: string | null | undefined): string {
  const where = stateName ? `${stateName}'s` : "This state's";
  return `Not compliance-approved: ${where} disclosure is placeholder text. An admin replaces it on State disclosures before any live call.`;
}
