import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyAnnotationForm } from "@/components/app/policy-annotation-form";
import { PolicyAwaitingFile } from "@/components/app/policy-awaiting-file";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PolicyClientTab } from "@/components/app/book/policy/client-tab";
import { PolicyCommissionsTab } from "@/components/app/book/policy/commissions-tab";
import { PolicyFilesTab } from "@/components/app/book/policy/files-tab";
import { PolicyHistoryTab } from "@/components/app/book/policy/history-tab";
import { PolicyOverviewTab } from "@/components/app/book/policy/overview-tab";
import { FactLine, PolicyLead, type Fact } from "@/components/app/book/policy/policy-head";
import { CopyPolicyNumber, PolicyTabs } from "@/components/app/book/policy/policy-islands";
import { PolicyPipelineTab } from "@/components/app/book/policy/pipeline-tab";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { scopeFor } from "@/lib/agency/visibility";
import { leadStageState } from "@/lib/applications/stageSyncService";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { hasFeature } from "@/lib/entitlements/types";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { fileDay } from "@/lib/ingestion/constants";
import { inForce, statusLabel } from "@/lib/ingestion/policyBook";
import { loadIssuedAwaitingOne, loadPolicy, PolicyBookError } from "@/lib/ingestion/policyBookStore";
import { MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";
import { carrierPolicyHref, POLICY_TABS, policyTabOf, statusTone, type PolicyTab } from "@/lib/ingestion/policyPage";
import { loadPolicyFiles, loadPolicyFindings, loadPolicyHistory, loadPolicyLink, loadPolicyPipeline, policyKeys, policyTabCounts, STAGE_HISTORY_PENDING_MESSAGE, type PolicyPipeline } from "@/lib/ingestion/policyPageStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadPolicyRuleEvents, type EvaluationRow } from "@/lib/pipelineRules/store";

const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * Book of business › Policies › one policy (LA-4.11; round 2 of the Book of business, 2026-11-02): a detail
 * page in the area's frame (DataInPage, step "policies"). The status chip and one line of facts, the
 * actions on the right, a quiet line of figures, then seven tabs as `?tab=` (canvas boards BobPolicy, BobE1,
 * BobE6, BobE6b): Overview · History · Client · Pipeline · Commissions · Files · Notes. Each tab reads only
 * what it shows. Carrier data is read-only; the link, the card and notes are ours, each changed on its own
 * page or tab (Change client is /client under this address).
 *
 * Owner, producer and bookkeeper, as the Policies list; a producer sees only a policy credited to them.
 */
export default async function PolicyPage({ params, searchParams }: { params: Promise<{ carrierId: string; policyNumber: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const [{ carrierId, policyNumber: raw }, query] = await Promise.all([params, searchParams]);
  const policyNumber = decodeURIComponent(raw);
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 100) notFound();
  const tab = policyTabOf(query.tab);

  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  let view: Awaited<ReturnType<typeof loadPolicy>>;
  try {
    view = await loadPolicy(viewer, carrierId, policyNumber);
  } catch (error) {
    if (!(error instanceof PolicyBookError) || error.status !== 503) throw error;
    return <DataInPage step="policies" title={`Policy ${policyNumber}`}><EmptyState title="The policy list isn't available yet" hint={error.message} /></DataInPage>;
  }
  if (!view) {
    // Module 4 · Door 1: a sale recorded as issued is in the book before its carrier file lists it.
    const awaiting = await loadIssuedAwaitingOne(viewer, carrierId, policyNumber).catch(() => null);
    if (awaiting) return <PolicyAwaitingFile sale={awaiting} />;
    return (
      <DataInPage step="policies" title={`Policy ${policyNumber}`}>
        <EmptyState title="This policy is not in your book" hint={guard.role === "producer" ? "It may be credited to another agent, or its carrier file hasn't arrived yet." : "Its carrier file may not have arrived yet, or the policy number is different."} />
      </DataInPage>
    );
  }

  const tenantId = guard.context.tenantId;
  const { policy, client, sale } = view;
  const readOnly = guard.entitlement.access === "read_only";
  const keys = await policyKeys(viewer, carrierId, policyNumber);
  const counts = await policyTabCounts(tenantId, carrierId, policyNumber, keys?.leadId ?? null);
  const ownerOrBookkeeper = holdsAnyRole(guard.roles, ["owner", "bookkeeper"]);
  // Changing the link is Policy matching's write: owner and bookkeeper on statement ingestion.
  const canEditLink = ownerOrBookkeeper && hasFeature(guard.entitlement, "statement_ingestion");
  const title = client?.name ?? sale?.name ?? keys?.leadName ?? `Policy ${policy.policyNumber}`;

  // ── the header: chip and facts, actions, the quiet figures ──
  const late = (policy.daysPastDue ?? 0) > 0;
  const atRiskCents = view.ledger.unearned?.atRiskCents ?? null;
  const monthly = policy.annualCents === null ? null : Math.round(policy.annualCents / 12);
  const facts: Fact[] = [
    { label: "Premium", value: monthly !== null ? `${money(monthly)}/mo` : money(policy.premiumCents) },
    { label: "Paid to", value: `${fileDay(policy.paidTo)}${late ? ` · ${policy.daysPastDue} days late` : ""}`, tone: late ? "warning" : undefined },
    ...(late && policy.daysLeft !== null && policy.daysLeft > 0 ? [{ label: policy.status === "lapsed" ? "Can be reinstated" : "The carrier closes it in", value: `${policy.daysLeft} more day${policy.daysLeft === 1 ? "" : "s"}`, tone: "warning" as const }] : []),
    ...(atRiskCents ? [{ label: "Advance at risk", value: money(atRiskCents), tone: "danger" as const }] : []),
  ];
  const saveQueue = inForce(policy.status) && (late || policy.riskBand === "at_risk" || policy.riskBand === "critical") && holdsAnyRole(guard.roles, ["owner", "producer"]);
  const actions = (
    <>
      {keys?.leadId && <Button asChild variant="outline"><Link href={`/app/leads/${keys.leadId}`}>Open the lead</Link></Button>}
      {sale && <Button asChild variant="outline"><Link href={`/app/applications/${sale.caseId}`}>Open the application</Link></Button>}
      {saveQueue && <Button asChild variant="outline"><Link href="/app/save-queue"><ExternalLink aria-hidden="true" />Open in Save queue</Link></Button>}
      <CopyPolicyNumber policyNumber={policy.policyNumber} />
    </>
  );

  const tabs = POLICY_TABS.map((item) => ({
    key: item.key,
    label: item.label,
    count: item.key === "history" ? counts.history : item.key === "pipeline" ? counts.pipeline : item.key === "commissions" ? (counts.findings ? counts.findings : null) : null,
    tone: item.key === "commissions" ? ("danger" as const) : undefined,
  }));
  const hrefs = Object.fromEntries(POLICY_TABS.map((item) => [item.key, carrierPolicyHref(carrierId, policy.policyNumber, item.key)])) as Record<PolicyTab, string>;

  return (
    <DataInPage
      step="policies"
      title={title}
      lead={<PolicyLead status={statusLabel(policy.status)} tone={statusTone(policy.status)} facts={[policy.policyNumber, policy.carrierName, policy.product]} />}
      actions={actions}
    >
      <FactLine label="This policy" facts={facts} />
      <PolicyTabs tabs={tabs} value={tab} hrefs={hrefs} />
      {await tabBody()}
    </DataInPage>
  );

  async function tabBody() {
    if (!view) return null;
    if (tab === "history") {
      const history = await loadPolicyHistory(tenantId, carrierId, policy.policyNumber);
      if (!history.available) return <EmptyState title="History isn't available yet" hint="The policy history needs a database update (20261008140000)." />;
      return <PolicyHistoryTab rows={history.rows} policyNumber={policy.policyNumber} truncated={history.truncated} />;
    }
    if (tab === "client") {
      const link = await loadPolicyLink(tenantId, carrierId, policy.policyNumber, keys);
      return <PolicyClientTab link={link} carrierId={carrierId} policyNumber={policy.policyNumber} clientName={client?.name ?? null} canEdit={canEditLink} editBlocked={readOnly ? "The account is read-only." : null} pendingMessage={MATCHING_PENDING_MESSAGE} />;
    }
    if (tab === "pipeline") {
      const leadId = keys?.leadId ?? null;
      const [loaded, state, rules] = await Promise.all([
        loadPolicyPipeline(tenantId, leadId),
        leadId ? leadStageState(tenantId, leadId).catch(() => null) : Promise.resolve(null),
        loadPolicyRuleEvents(tenantId, carrierId, policy.policyNumber).catch(() => null),
      ]);
      // The pipeline rules' lines for this policy: each move a live rule made, each forecast line and each skip.
      const pipeline = { ...loaded, ruleLines: rules?.available ? policyRuleLines(rules.events) : [] };
      // Undo is the existing put-back (reconcileLeadStage): offered on the newest move while the card sits
      // where that move put it and the application says it belongs somewhere else. Owner and producer on
      // applications, as that route.
      const newest = pipeline.moves[0];
      const canUndo = holdsAnyRole(guard.roles, ["owner", "producer"]) && hasFeature(guard.entitlement, "applications");
      const undo = canUndo && newest && state?.targetStageId && state.targetStageName && state.targetStageId !== state.boardStageId && pipeline.card?.stageId === state.boardStageId
        ? { moveId: newest.id, backTo: state.targetStageName, disabledReason: readOnly ? "The account is read-only." : null }
        : null;
      return <PolicyPipelineTab pipeline={pipeline} leadId={leadId} undo={undo} pendingMessage={STAGE_HISTORY_PENDING_MESSAGE} />;
    }
    if (tab === "commissions") {
      const findings = ownerOrBookkeeper ? await loadPolicyFindings(tenantId, carrierId, policy.policyNumber) : { available: true, items: [] };
      const chargebackLikely = Boolean(policy.inClawbackWindow && (policy.status === "lapsed" || late) && atRiskCents);
      return (
        <PolicyCommissionsTab
          ledger={view.ledger}
          expected={view.expected}
          findings={findings}
          carrierName={policy.carrierName}
          chargebackLikely={chargebackLikely}
          canFix={ownerOrBookkeeper}
          canLetter={ownerOrBookkeeper && hasFeature(guard.entitlement, "discrepancy_report")}
        />
      );
    }
    if (tab === "files") return <PolicyFilesTab files={await loadPolicyFiles(tenantId, carrierId, policy.policyNumber)} />;
    if (tab === "notes") {
      return (
        <TableCard title="Your notes">
          <div className="px-4 pb-4">
            {view.notes.available ? (
              <PolicyAnnotationForm
                carrierId={policy.carrierId}
                policyNumber={policy.policyNumber}
                notes={view.notes.text}
                vendorId={view.lead.vendorId}
                campaignId={view.lead.campaignId}
                vendors={view.choices.vendors}
                campaigns={view.choices.campaigns}
                leadFromSale={view.lead.fromSale}
                disabledReason={readOnly ? "The account is read-only." : null}
              />
            ) : (
              <p className="m-0 text-sm text-muted-foreground">Notes need a database update (20261008210000).</p>
            )}
          </div>
        </TableCard>
      );
    }
    return <PolicyOverviewTab view={view} canLink={canEditLink && !readOnly} />;
  }
}

/** A rule's lines for the Pipeline tab: a move a live rule made, a forecast "would move", or a skip with its reason. */
function policyRuleLines(events: EvaluationRow[]): PolicyPipeline["ruleLines"] {
  const move = (e: EvaluationRow) => `${e.fromStage ?? "Its stage"} → ${e.toStage ?? "a stage no longer on the board"}`;
  return events.flatMap((e): PolicyPipeline["ruleLines"] => {
    const rule = e.ruleName ? `${e.ruleName} · v${e.version}` : null;
    if (e.outcome === "moved") return [{ at: e.evaluatedAt, text: `${move(e)}${e.undoneAt ? " (undone)" : ""}`, reason: e.because, rule, mode: "live" as const }];
    if (e.outcome === "would_move") return [{ at: e.evaluatedAt, text: `Would move ${move(e)}`, reason: e.because, rule, mode: "forecast" as const }];
    if (e.outcome === "skipped" || e.outcome === "held" || e.outcome === "failed") return [{ at: e.evaluatedAt, text: e.outcome === "held" ? "Held: two rules disagree" : e.outcome === "failed" ? "Not moved" : "Skipped", reason: e.reason, rule, mode: "skipped" as const }];
    return [];
  });
}
