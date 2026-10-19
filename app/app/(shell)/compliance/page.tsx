import Link from "next/link";

import { guardPage } from "@/lib/entitlements/guardPage";
import { loadComplianceDashboard } from "@/lib/compliance/dashboard";
import type { AlertSeverity } from "@/lib/compliance/dashboardCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { EmptyState } from "@/components/ui/page-states";

/**
 * Setup › Compliance (LA-6.7, Notion sprint). Am I exposed right now — in about five seconds.
 * Deadlines and active problems on top, in severity order; standing coverage below. Every figure
 * opens the rows behind it. Owner and producer only.
 */
const ALERT_STYLE: Record<AlertSeverity, string> = {
  incident: "border-[var(--error)] bg-[var(--error-surface)] text-[var(--error-ink)] font-semibold",
  critical: "border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[var(--error-surface)] text-[var(--error-ink)]",
  warning: "border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[var(--warning-surface)] text-[var(--warning-ink)]",
};
const MARK: Record<AlertSeverity, string> = { incident: "Incident", critical: "●", warning: "⚠" };

export default async function CompliancePage() {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Compliance" description="Am I exposed right now: deadlines, gaps and coverage on one screen." />;
  }
  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Compliance" detail="Only owners and producers can see the agency's compliance exposure." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice featureLabel="Compliance" detail="In an agency, the owner and admins handle compliance." />;
  const { alerts, tiles } = await loadComplianceDashboard({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Compliance" description="Am I exposed right now?" actions={guard.role === "owner" ? <Button asChild variant="outline"><Link href="/app/compliance/settings">Settings</Link></Button> : undefined} />
      {alerts.length ? (
        <ul className="flex flex-col gap-2" aria-label="Deadlines and active problems">
          {alerts.map((a) => (
            <li key={a.key} role={a.severity === "warning" ? undefined : "alert"} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${ALERT_STYLE[a.severity]}`}>
              <span><span className="mr-2" aria-hidden={a.severity !== "incident"}>{MARK[a.severity]}</span>{a.text}</span>
              <Link href={a.href} className="font-semibold underline">{a.action}</Link>
            </li>
          ))}
        </ul>
      ) : null}
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
            action={<Link href={t.href} className="underline">{t.action}</Link>}
          />
        ))}
      </StatStrip>
      {!alerts.length ? (
        <TableCard><EmptyState title="Nothing needs you today" hint="No deadline is close, no number was called after it should have stopped, and no licence or E&O is about to lapse." /></TableCard>
      ) : null}
    </div>
  );
}
