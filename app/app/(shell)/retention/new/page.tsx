import { redirect } from "next/navigation";

/**
 * Retention › Cases › New case. Since round 7 (owner pick 1·A, 2026-11-10; docs/la4/mockups-r7/retention.html board
 * 1·4) New case is a dialog over Cases; this address opens it there, so an old link still lands on the form.
 */
export default function NewRetentionCasePage() {
  redirect("/app/retention?new=1");
}
