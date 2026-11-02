import Link from "next/link";
import { ArrowRight, CircleAlert, TriangleAlert } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadComplianceDashboard } from "@/lib/compliance/dashboard";
import type { AlertSeverity } from "@/lib/compliance/dashboardCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { EmptyState } from "@/components/ui/page-states";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { cn } from "@/lib/utils";

/**
 * Compliance › Overview (LA-6.7, Notion sprint), the first step of the one Compliance page. Am I exposed
 * right now — in about five seconds. Standing coverage on top (owner 2026-10-30), then deadlines and active
 * problems in severity order, each with the button that opens its fix (LA-6.7: "everything clicks through"). Every
 * figure opens the rows behind it. Owner and producer only. Compliance settings open from the rail's foot.
 */
const MARK: Record<AlertSeverity, { icon: typeof CircleAlert; tint: string; label: string }> = {
  incident: { icon: CircleAlert, tint: "bg-[var(--error-surface)] text-[var(--error-ink)]", label: "Incident" },
  critical: { icon: CircleAlert, tint: "bg-[var(--error-surface)] text-[var(--error-ink)]", label: "Fix today" },
  warning: { icon: TriangleAlert, tint: "bg-[var(--warning-surface)] text-[var(--warning-ink)]", label: "Soon" },
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
            action={<Link href={t.href} className="font-semibold text-[var(--accent-ink)] hover:underline">{t.action}</Link>}
          />
        ))}
      </StatStrip>
      {/* Needs you, under the figures (owner 2026-10-30): the next step is its first row, so there is no separate "next up" line. */}
      <TableCard title={alerts.length ? `Needs you · ${alerts.length}` : "Needs you"}>
        {alerts.length ? (
          <ul className="m-0 list-none divide-y divide-border p-0" aria-label="Deadlines and active problems">
            {alerts.map((a) => {
              const mark = MARK[a.severity];
              const Icon = mark.icon;
              return (
                <li key={a.key} role={a.severity === "warning" ? undefined : "alert"} className="m-row flex min-h-[2.75rem] flex-wrap items-center gap-3 px-4 py-2">
                  <span title={mark.label} aria-label={mark.label} className={cn("grid size-7 shrink-0 place-items-center rounded-full", mark.tint)}><Icon className="size-4" aria-hidden="true" /></span>
                  <span className={cn("min-w-0 flex-1 text-sm text-[var(--ink)]", a.severity === "incident" && "font-semibold")}>{a.text}</span>
                  <Button asChild variant="outline" size="sm"><Link href={a.href}>{a.action}<ArrowRight aria-hidden="true" /></Link></Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Nothing needs you today" hint="No deadline is close, no number was called after it should have stopped, and no licence is about to lapse." />
        )}
      </TableCard>
    </ComplianceFlowPage>
  );
}
