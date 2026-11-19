import { Suspense, type ReactNode } from "react";

import { SectionLoading } from "@/components/ui/page-states";
import { dailyChecksForAdmin } from "@/lib/adminDashboard/dailyInput";
import { CHECKS_WITH_ROWS } from "@/lib/adminDashboard/needsRows";
import { NeedsQueue } from "./needs-queue";
import { NeedsRows } from "./needs-rows";
import type { DashboardAdmin } from "./types";

/**
 * Admin dashboard › Needs you (admin round 1, docs/design/admin-r1/dashboard-combined.html §2): the 17 daily
 * checks (lib/adminDashboard/dailyChecks.ts), filtered by role as the home always did, as a work queue.
 *
 * Each check that counts rows gets its pane rendered here, each in its own Suspense, so picking a check in the
 * queue is instant and a slow or failing read only holds its own pane. A check that is clear (or could not be
 * read) has nothing to list and reads nothing. Every action is the check's own link to the page that deals
 * with it: nothing on this tab writes.
 */
export async function NeedsTab({ admin }: { admin: DashboardAdmin }) {
  const { input, checks } = await dailyChecksForAdmin(admin);
  const panes: Record<string, ReactNode> = {};
  for (const check of checks) {
    if (!CHECKS_WITH_ROWS.has(check.key) || check.status === "clear" || check.status === "unknown") continue;
    panes[check.key] = (
      <Suspense fallback={<SectionLoading rows={4} columns={4} label={`Loading ${check.title.toLowerCase()}`} />}>
        <NeedsRows checkKey={check.key} admin={admin} pageHref={check.href} pageLabel={check.actionLabel} />
      </Suspense>
    );
  }
  return <NeedsQueue checks={checks} panes={panes} checkedAt={input.now} />;
}
