/**
 * The title-line slots the agency's client steps fill (components/app/step-frame/step-slot.tsx). A plain module, so
 * the server page that draws the target and the client board that fills it read one id (a server page cannot read
 * a constant out of a "use client" file).
 */
export const PRODUCER_PAYOUTS_SLOT = "producer-payouts-actions";
export const PRODUCERS_SLOT = "producers-actions";
export const SCORECARDS_SLOT = "scorecards-actions";
export const REVIEW_SLOT = "review-actions";
export const AGENCY_SLOT = "agency-actions";
