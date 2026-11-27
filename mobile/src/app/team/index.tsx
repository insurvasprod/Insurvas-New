import { TeamTab } from "@/components/team/team-tab";

/**
 * Team (board I1) as a pushed screen with a back arrow, for an owner whose bar has no Team tab (one who picked the
 * producer's Calls · Leads). lib/links.ts `reachable` sends /teamtab here for them.
 */
export default function TeamPage() {
  return <TeamTab stacked />;
}
