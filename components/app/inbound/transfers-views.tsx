import { useSolo } from "@/components/app/solo-context";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Team's two views (Inbound A, 2026-10-27; was the Queue/Floor switch): Now (who needs you, the
 * people, the calls) at /app/inbound/team, and All callers (every transfer today, Today by partner,
 * filters, lost-transfer recovery) at /app/inbound/team?tab=all. Agents work on Inbound itself.
 */
export function TeamViews({ current }: { current: "now" | "all" }) {
  // Solo mode: there is no Now (the team) to switch to, so no switch at all.
  const solo = useSolo();
  if (solo) return null;
  // The sub-page bar (owner 2026-11-09): link tabs passed as PageHeader `tabs`, on the title's line.
  return (
    <ViewTabs
      label="Team views"
      value={current}
      tabs={[
        { key: "now", label: "Now", href: "/app/inbound/team" },
        { key: "all", label: "All callers", href: "/app/inbound/team?tab=all" },
      ]}
    />
  );
}
