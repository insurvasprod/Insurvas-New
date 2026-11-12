import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadComplianceDashboard } from "@/lib/compliance/dashboard";
import type { AlertSeverity } from "@/lib/compliance/dashboardCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState } from "@/components/ui/page-states";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { LinkRow } from "@/components/app/book/setup/link-row";

/**
 * Compliance › Overview (LA-6.7, Notion sprint), the first step of the one Compliance page. Am I exposed
 * right now — in about five seconds.
 *
 * Round 7 (owner 2026-11-11, docs/la4/mockups-r7/compliance.html 1·A): deadlines and active problems as one table,
 * one line a problem, its colour only in the Status chip and its fix a short verb. The owner then put the standing
 * figures back on top (2026-11-11: "the card should be on top and the table at the bottom", filling the page like
 * every other step); they are plain, a problem tile saying so in one chip. Every row and tile opens the rows behind
 * it. Owner and producer only. Compliance settings open from the rail's foot.
 */
const TONE: Record<AlertSeverity, StatusTone> = { incident: "danger", critical: "danger", warning: "warning" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-02" → "2 Nov", built by hand so the server and the browser print the same thing. */
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;

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
      {/* The standing figures, plain (round 7): a tile that is a problem says it in one chip; each tile opens its rows. */}
      <StatStrip label="Standing coverage">
        {tiles.map((t) => (
          <StatTile
            key={t.key}
            label={t.label}
            labelTitle={t.notConfigured}
            value={t.value ?? "Not configured"}
            valueSize={t.value && /\d/.test(t.value) ? "figure" : "text"}
            footnote={t.tone && t.chip ? <StatusChip tone={t.tone}>{t.chip}</StatusChip> : t.footnote}
            href={t.href}
          />
        ))}
      </StatStrip>
      {/* Needs you under the figures (owner 2026-11-11: "the card should be on top and the table at the bottom"), worst
          first; the table fills the page to the rail's foot and pages there, like every other step. */}
      <PagedTableCard title={alerts.length ? `Needs you · ${alerts.length}` : "Needs you"} total={alerts.length} noun={alerts.length === 1 ? "item" : "items"}>
        {alerts.length ? (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="m-glass-head text-left text-xs text-muted-foreground">
                <th scope="col" className="h-[40px] px-4 font-medium">Problem</th>
                <th scope="col" className="h-[40px] px-3 font-medium">Who or what</th>
                <th scope="col" className="h-[40px] whitespace-nowrap px-3 text-right font-medium">How many</th>
                <th scope="col" className="h-[40px] px-3 font-medium">Date</th>
                <th scope="col" className="h-[40px] px-3 font-medium">Status</th>
                <th scope="col" className="h-[40px] px-4 font-medium">Next step</th>
              </tr>
            </thead>
            <PagedBody label="Deadlines and active problems">
              {alerts.map((a) => (
                <LinkRow key={a.key} href={a.href} className="h-[44px] border-t border-border">
                  <td className="whitespace-nowrap px-4 font-medium text-foreground" title={a.text}>
                    <Link href={a.href} className="hover:underline">{a.title}</Link>
                  </td>
                  <td className="whitespace-nowrap px-3">{a.who}</td>
                  <td className="whitespace-nowrap px-3 text-right tabular-nums">{a.count == null ? <span className="text-muted-foreground">—</span> : a.count.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap px-3 tabular-nums text-muted-foreground">{a.since ? day(a.since) : "—"}</td>
                  <td className="whitespace-nowrap px-3"><StatusChip tone={TONE[a.severity]}>{a.chip}</StatusChip></td>
                  <td className="whitespace-nowrap px-4" title={a.text}>{a.step} ›</td>
                </LinkRow>
              ))}
            </PagedBody>
          </table>
        ) : (
          <EmptyState title="Nothing needs you" hint="No deadline is near, no call broke a rule, every licence is current. The figures above are the standing picture." />
        )}
      </PagedTableCard>
    </ComplianceFlowPage>
  );
}
