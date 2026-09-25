import { redirect } from "next/navigation";

export default function ScorecardAliasPage() {
  // The scorecard became a tab on Activity; land on that tab, not the activity log.
  redirect("/app/activity?view=scorecard");
}
