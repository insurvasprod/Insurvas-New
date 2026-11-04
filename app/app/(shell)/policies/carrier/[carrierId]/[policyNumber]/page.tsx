import Link from "next/link";
import { notFound } from "next/navigation";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyAnnotationForm } from "@/components/app/policy-annotation-form";
import { PolicyAwaitingFile } from "@/components/app/policy-awaiting-file";
import { ProvisionalBadge } from "@/components/app/provisional-badge";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PolicyClientTab } from "@/components/app/book/policy/client-tab";
import { PolicyCommissionsTab } from "@/components/app/book/policy/commissions-tab";
import { PolicyFilesTab } from "@/components/app/book/policy/files-tab";
import { PolicyHistoryTab } from "@/components/app/book/policy/history-tab";
import { PolicyOverviewTab } from "@/components/app/book/policy/overview-tab";
import { PolicyLead } from "@/components/app/book/policy/policy-head";
import { PolicyMoreMenu, type MoreLink } from "@/components/app/book/policy/policy-islands";
import { PolicyPipelineTab } from "@/components/app/book/policy/pipeline-tab";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { scopeFor } from "@/lib/agency/visibility";
import { leadStageState } from "@/lib/applications/stageSyncService";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { hasFeature } from "@/lib/entitlements/types";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { inForce } from "@/lib/ingestion/policyBook";
import { policyHealth } from "@/lib/ingestion/policyMoney";
import { loadCurrentLinkId, loadPolicyGrace } from "@/lib/ingestion/policyMoneyStore";
import { loadIssuedAwaitingOne, loadPolicy, PolicyBookError } from "@/lib/ingestion/policyBookStore";
import { MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";
import { agentMismatchLine, carrierPolicyHref, changeClientHref, POLICY_TABS, policyTabOf, saleCameFrom, showsProvisional, type PolicyTab } from "@/lib/ingestion/policyPage";
import { loadPolicyFiles, loadPolicyFindings, loadPolicyHistory, loadPolicyLink, loadPolicyPipeline, policyKeys, policyTabCounts, STAGE_HISTORY_PENDING_MESSAGE, type PolicyPipeline } from "@/lib/ingestion/policyPageStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadPolicyRuleEvents, type EvaluationRow } from "@/lib/pipelineRules/store";

const LINK = "font-medium text-[var(--accent-ink)] hover:underline";
const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * Book of business › Policies › one policy (LA-4.11; round 2 of the Book of business, 2026-11-02): a detail
 * page in the area's frame (DataInPage, step "policies"). Round 5 (board 7): the title is "<policy> · <client>"
 * with its health chip beside it and one muted line of facts under it (carrier · product · premium · agent);
 * one button (Open the lead) and More (Change client, Unlink, Add a note, Copy policy number); then the tabs as
 * `?tab=` (boards 7 and 22): Overview · History · Client · Pipeline · Money · Files, and Notes when "Add a note"
 * opens it. Money (?tab=commissions, so old links land) counts the open pay issues. Each tab reads only
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
  const clientName = client?.name ?? sale?.name ?? keys?.leadName ?? null;
  const title = clientName ? `${policy.policyNumber} · ${clientName}` : `Policy ${policy.policyNumber}`;

  // ── the header: the health chip, the muted facts, one button and More ──
  const late = (policy.daysPastDue ?? 0) > 0;
  const atRiskCents = view.ledger.unearned?.atRiskCents ?? null;
  const monthly = policy.annualCents === null ? null : Math.round(policy.annualCents / 12);
  const health = policyHealth({ status: policy.status, paidTo: policy.paidTo, daysPastDue: policy.daysPastDue, asOf: policy.asOf, premiumMode: policy.premiumMode });
  const saveQueue = inForce(policy.status) && (late || policy.riskBand === "at_risk" || policy.riskBand === "critical") && holdsAnyRole(guard.roles, ["owner", "producer"]);
  const canLink = canEditLink && !readOnly;
  const linkId = canEditLink ? await loadCurrentLinkId(tenantId, carrierId, policy.policyNumber) : null;
  // Round 5: one button, the lead first; the rest (Change client, Add a note, Unlink, Copy policy number) in "More".
  const links: MoreLink[] = [
    ...(keys?.leadId ? [{ label: "Open the lead", href: `/app/leads/${keys.leadId}` }] : []),
    ...(sale ? [{ label: "Open the application", href: `/app/applications/${sale.caseId}` }] : []),
    ...(saveQueue ? [{ label: "Open in Save queue", href: "/app/save-queue" }] : []),
    ...(canLink ? [{ label: client || sale ? "Change client" : "Link a client", href: changeClientHref(policy.carrierId, policy.policyNumber) }] : []),
    { label: "Add a note", href: carrierPolicyHref(carrierId, policy.policyNumber, "notes") },
  ];
  const actions = (
    <>
      {links.slice(0, 1).map((link) => <Button key={link.href} asChild><Link href={link.href}>{link.label}</Link></Button>)}
      <PolicyMoreMenu links={links.slice(1)} policyNumber={policy.policyNumber} unlink={linkId ? { matchId: linkId, clientName, disabledReason: readOnly ? "The account is read-only." : null } : null} />
    </>
  );
  // Round 3: the Overview's three status lines, as chips and links on the header's facts line.
  const saleState = sale ? (sale.outcome ? sale.outcome.replaceAll("_", " ") : sale.status ? sale.status.replaceAll("_", " ") : null) : null;
  // QA 2026-11-03: the carrier pays one producer, the sale names another — said once, plainly.
  const mismatch = keys?.sale ? agentMismatchLine(keys.carrierAgent, { userId: keys.sale.agentUserId, name: keys.sale.agentName }) : null;
  const notices = (
    <>
      {mismatch && <span className="inline-flex items-center gap-1.5" title="The writing number on the carrier's row maps to a different producer than the one who sold it"><StatusChip tone="warning">{mismatch}</StatusChip></span>}
      {showsProvisional(client?.provisional, keys?.link) && <span className="inline-flex items-center gap-1.5"><ProvisionalBadge /><Link href="/app/duplicates" className={LINK} title="This client was built from the carrier's file">Check the client</Link></span>}
      {sale && <Link href={`/app/applications/${sale.caseId}`} className={LINK} title={`Linked to ${sale.name ? `${sale.name}'s` : "an"} application`}>Application{saleState ? ` · ${saleState}` : ""}</Link>}
      {!client && !sale && <span className="inline-flex items-center gap-1.5"><StatusChip tone="warning">No client linked</StatusChip>{canLink ? <Link href={changeClientHref(policy.carrierId, policy.policyNumber)} className={LINK}>Link a client</Link> : <Link href={carrierPolicyHref(policy.carrierId, policy.policyNumber, "client")} className={LINK}>See the Client tab</Link>}</span>}
    </>
  );

  // Notes is reached from More › Add a note; it shows as a tab only while it is open.
  const tabs = POLICY_TABS.filter((item) => item.key !== "notes" || tab === "notes").map((item) => ({
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
      chip={<span title={policy.statusRaw ? `The carrier's word: ${policy.statusRaw}` : undefined}><StatusChip tone={health.tone}>{health.label}</StatusChip></span>}
      facts={<PolicyLead facts={[policy.carrierName, policy.product, monthly !== null ? `${money(monthly)}/mo` : policy.premiumCents !== null ? money(policy.premiumCents) : null, policy.agentName ? `agent ${policy.agentName}` : null]} notices={notices} />}
      lead={<ViewTabs label="This policy" value={tab} tabs={tabs.map((item) => ({ ...item, href: hrefs[item.key] }))} />}
      actions={actions}
    >
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
      const [findings, grace, today] = await Promise.all([
        ownerOrBookkeeper ? loadPolicyFindings(tenantId, carrierId, policy.policyNumber) : Promise.resolve({ available: true, items: [] }),
        loadPolicyGrace(tenantId, carrierId, policy.policyNumber).catch(() => ({ graceDays: null, windowDays: null, ruleType: null })),
        agencyToday(tenantId).catch(() => new Date().toISOString().slice(0, 10)),
      ]);
      const chargebackLikely = Boolean(policy.inClawbackWindow && (policy.status === "lapsed" || late) && atRiskCents);
      return (
        <PolicyCommissionsTab
          ledger={view.ledger}
          expected={view.expected}
          findings={findings}
          carrierName={policy.carrierName}
          carrierId={carrierId}
          facts={{ status: policy.status, paidTo: policy.paidTo, daysPastDue: policy.daysPastDue, daysLeft: policy.daysLeft, asOf: policy.asOf, effectiveDate: policy.effectiveDate, premiumMode: policy.premiumMode, premiumCents: policy.premiumCents, monthsPaid: policy.monthsPaid, graceDays: grace.graceDays }}
          today={today}
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
    // "Came from": a sale with no lead source on record names the sale, not "Lead source not known".
    const cameFrom = view.lead.name ? null : saleCameFrom(keys?.sale);
    return <PolicyOverviewTab view={cameFrom ? { ...view, lead: { ...view.lead, name: cameFrom } } : view} />;
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
