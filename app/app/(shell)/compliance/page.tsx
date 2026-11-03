import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadComplianceDashboard } from "@/lib/compliance/dashboard";
import type { AlertSeverity } from "@/lib/compliance/dashboardCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState } from "@/components/ui/page-states";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";

/**
 * Compliance › Overview (LA-6.7, Notion sprint), the first step of the one Compliance page. Am I exposed
 * right now — in about five seconds. Standing coverage on top (owner 2026-10-30), then deadlines and active
 * problems in severity order, each with the button that opens its fix (LA-6.7: "everything clicks through"). Every
 * figure opens the rows behind it: the tile is the link (foundation pass 2026-11-03). Owner and producer only.
 * Compliance settings open from the rail's foot.
 */
const MARK: Record<AlertSeverity, { tone: StatusTone; label: string }> = {
  incident: { tone: "danger", label: "Incident" },
  critical: { tone: "danger", label: "Fix today" },
  warning: { tone: "warning", label: "Soon" },
};

export default async function CompliancePage() {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Compliance" description="Am I exposed right now: deadlines, gaps and coverage on one screen." />;
  }
  if (!actAsPage(guard, ["owner", "producer"])) {
    return <RoleGateNotice featureLabel="Compliance" detail="Only owners and producers can see the agency's compliance exposure." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Compliance" detail="In an agency, the owner and admins handle compliance." />;
  const { alerts, tiles } = await loadComplianceDashboard({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  return (
    <ComplianceFlowPage step="overview">
      <StatStrip label="Standing coverage">
        {tiles.map((t) => (
          <StatTile
            key={t.key}
            label={t.label}
            labelTitle={t.notConfigured}
            value={t.value ?? "Not configured"}
            valueSize={t.value && /\d/.test(t.value) ? "figure" : "text"}
            valueTone={t.tone}
            footnote={t.footnote}
            href={t.href}
          />
        ))}
      </StatStrip>
      {/* Needs you, under the figures (owner 2026-10-30): the next step is its first row, so there is no separate "next up" line. */}
      {/* Paged to the rail's foot like every list (foundation pass 2026-11-03): a long day never scrolls the column. */}
      <PagedTableCard title={alerts.length ? `Needs you · ${alerts.length}` : "Needs you"} total={alerts.length} noun={alerts.length === 1 ? "item" : "items"}>
        {alerts.length ? (
          <PagedBody as="ul" className="m-0 list-none divide-y divide-border p-0" label="Deadlines and active problems">
            {alerts.map((a) => {
              const mark = MARK[a.severity];
              return (
                <li key={a.key} role={a.severity === "warning" ? undefined : "alert"} className="m-row flex min-h-[2.75rem] flex-wrap items-center gap-3 px-4 py-2">
                  <span className="w-24 shrink-0"><StatusChip tone={mark.tone}>{mark.label}</StatusChip></span>
                  <span className={a.severity === "incident" ? "min-w-0 flex-1 text-sm font-semibold text-[var(--ink)]" : "min-w-0 flex-1 text-sm text-[var(--ink)]"}>{a.text}</span>
                  <Button asChild variant="outline" size="sm"><Link href={a.href}>{a.action}<ArrowRight aria-hidden="true" /></Link></Button>
                </li>
              );
            })}
          </PagedBody>
        ) : (
          <EmptyState title="Nothing needs you today" hint="No deadline is close, no number was called after it should have stopped, and no licence is about to lapse." />
        )}
      </PagedTableCard>
    </ComplianceFlowPage>
  );
}
