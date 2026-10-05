// Submission vocabulary for the capture dialog, the Submit step and the Timeline. Plain module (not
// "use client") so a server component could import it too.

import type { SubmissionView } from "@/lib/applications/types";

export const SUBMITTED_VIA_LABEL: Record<SubmissionView["submittedVia"], string> = {
  extension: "Insurvas extension",
  copy_assist: "Copy-assist",
  carrier_portal_manual: "Typed into the portal",
};

export const REFERENCE_KIND_LABEL: Record<NonNullable<SubmissionView["referenceKind"]>, string> = {
  application_no: "Application number",
  policy_no: "Policy number",
};

/** "28 Sep 2026, 2:14pm" — the one LA-3 date format. */
export { dateTime } from "@/components/app/applications/dates";
