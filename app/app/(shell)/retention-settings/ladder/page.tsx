import { redirect } from "next/navigation";

/**
 * Settings › Retention › Ladder rules folded into the section's Ladder tab (round 7, owner pick 7·A, 2026-11-10;
 * docs/la4/mockups-r7/retention.html 7·A). The old address still works.
 */
export default function RetentionLadderRulesPage() {
  redirect("/app/retention-settings?tab=ladder");
}
