import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataInPage, RecordName } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyAnnotationForm } from "@/components/app/policy-annotation-form";
import { PolicyAwaitingFile } from "@/components/app/policy-awaiting-file";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PolicyClientTab } from "@/components/app/book/policy/client-tab";
import { PolicyCommissionsTab } from "@/components/app/book/policy/commissions-tab";
import { PolicyFilesTab } from "@/components/app/book/policy/files-tab";
import { PolicyHistoryTab } from "@/components/app/book/policy/history-tab";
import { PolicyOverviewTab } from "@/components/app/book/policy/overview-tab";
import { PolicyMoreMenu, type MoreLink } from "@/components/app/book/policy/policy-islands";
import { PolicyPipelineTab } from "@/components/app/book/policy/pipeline-tab";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { scopeFor } from "@/lib/agency/visibility";
import { leadStageState } from "@/lib/applications/stageSyncService";
import { actAsPage, guardPage, type PageGuardResult } from "@/lib/entitlements/guardPage";
import { hasFeature } from "@/lib/entitlements/types";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { policyHealth } from "@/lib/ingestion/policyMoney";
import { loadCurrentLinkId, loadPolicyGrace } from "@/lib/ingestion/policyMoneyStore";
import { loadIssuedAwaitingOne, loadPolicy, PolicyBookError } from "@/lib/ingestion/policyBookStore";
import { MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";
import { cardMoveHistoryRows, carrierPolicyHref, changeClientHref, mergeHistory, POLICY_TABS, policyTabOf, saleCameFrom, showsProvisional, type PolicyTab } from "@/lib/ingestion/policyPage";
import { loadPolicyFiles, loadPolicyFindings, loadPolicyHistory, loadPolicyLink, loadPolicyPipeline, policyKeys, policyTabCounts, STAGE_HISTORY_PENDING_MESSAGE, type PolicyPipeline } from "@/lib/ingestion/policyPageStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadPolicyRuleEvents, type EvaluationRow } from "@/lib/pipelineRules/store";
import { openLadderCaseId } from "@/lib/retention/cases/store";


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

  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const ownerOrBookkeeper = holdsAnyRole(guard.roles, ["owner", "bookkeeper"]);
  // Changing the link is Policy matching's write: owner and bookkeeper on statement ingestion.
  const canEditLink = ownerOrBookkeeper && hasFeature(guard.entitlement, "statement_ingestion");
  // Round 6: the Save queue is retired (call of 2026-11-05); an open Retention case for this policy is the place to work it.
  const retention = holdsAnyRole(guard.roles, ["owner", "producer", "retention"]) && hasFeature(guard.entitlement, "chargeback_radar");
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the frame draw at once; the client's name waits behind its
  // shape, and the chip, the buttons, the counts and the tab stream in. The reads are today's, only started before the
  // frame returns (the link and the open case beside the keys and counts, since they need only the policy).
  const model = loadModel({ guard, carrierId, policyNumber, canEditLink, retention });
  const name = model.then((m) => (m.kind === "policy" ? m.title : m.kind === "awaiting" ? m.sale.clientName ?? `Policy ${m.sale.policyNumber}` : `Policy ${policyNumber}`));
  const tabsOf = (counts?: { history: number | null; pipeline: number | null; findings: number | null }) => POLICY_TABS.filter((item) => item.key !== "notes" || tab === "notes").map((item) => ({
    key: item.key,
    label: item.label,
    count: !counts ? null : item.key === "history" ? counts.history : item.key === "pipeline" ? counts.pipeline : item.key === "commissions" ? (counts.findings ? counts.findings : null) : null,
    tone: item.key === "commissions" ? ("danger" as const) : undefined,
    href: carrierPolicyHref(carrierId, policyNumber, item.key),
  }));

  return (
    <DataInPage
      step="policies"
      title={<RecordName read={name} />}
      chip={<Suspense fallback={null}><Chip read={model} /></Suspense>}
      tabs={<Suspense fallback={<ViewTabs label="This policy" value={tab} tabs={tabsOf()} />}><CountedTabs read={model} tab={tab} tabsOf={tabsOf} /></Suspense>}
      actions={<Suspense fallback={null}><Actions read={model} carrierId={carrierId} readOnly={readOnly} canEditLink={canEditLink} /></Suspense>}
    >
      <StreamSection shape={tab === "overview" || tab === "commissions" ? "strip+table" : tab === "client" || tab === "notes" ? "form" : "table"}>
        <PolicyTabBody read={model} tab={tab} carrierId={carrierId} tenantId={tenantId} readOnly={readOnly} canEditLink={canEditLink} ownerOrBookkeeper={ownerOrBookkeeper} isProducer={guard.role === "producer"} canUndo={holdsAnyRole(guard.roles, ["owner", "producer"]) && hasFeature(guard.entitlement, "applications")} canLetter={ownerOrBookkeeper && hasFeature(guard.entitlement, "discrepancy_report")} />
      </StreamSection>
    </DataInPage>
  );
}

/** The policy and what its header needs; or why there is no policy page (the list is down, a sale awaiting its file, not found). */
async function loadModel({ guard, carrierId, policyNumber, canEditLink, retention }: { guard: PageGuardResult; carrierId: string; policyNumber: string; canEditLink: boolean; retention: boolean }) {
  const tenantId = guard.context.tenantId;
  const viewer = { tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  let view: Awaited<ReturnType<typeof loadPolicy>>;
  try {
    view = await loadPolicy(viewer, carrierId, policyNumber);
  } catch (error) {
    if (!(error instanceof PolicyBookError) || error.status !== 503) throw error;
    return { kind: "unavailable" as const, message: error.message };
  }
  if (!view) {
    // Module 4 · Door 1: a sale recorded as issued is in the book before its carrier file lists it.
    const awaiting = await loadIssuedAwaitingOne(viewer, carrierId, policyNumber).catch(() => null);
    return awaiting ? { kind: "awaiting" as const, sale: awaiting } : { kind: "missing" as const };
  }
  const { policy, client, sale } = view;
  const [[keys, counts], [linkId, caseId]] = await Promise.all([
    policyKeys(viewer, carrierId, policyNumber).then(async (keys) => [keys, await policyTabCounts(tenantId, carrierId, policyNumber, keys?.leadId ?? null)] as const),
    Promise.all([
      canEditLink ? loadCurrentLinkId(tenantId, carrierId, policy.policyNumber) : Promise.resolve(null),
      retention ? openLadderCaseId(tenantId, carrierId, policy.policyNumber).catch(() => null) : Promise.resolve(null),
    ]),
  ]);
  const clientName = client?.name ?? sale?.name ?? keys?.leadName ?? null;
  // Round 6 (owner 2026-11-06): the client is the title (people look for a name); the policy number leads the facts.
  const title = clientName ?? `Policy ${policy.policyNumber}`;
  return { kind: "policy" as const, view, keys, counts, linkId, caseId, clientName, title };
}

type Model = ReturnType<typeof loadModel>;

async function Chip({ read }: { read: Model }) {
  const m = await read;
  if (m.kind === "awaiting") {
    const { sale } = m;
    return <InfoTip label="About this policy" side="right">{[sale.carrierName, sale.product, `Policy #${sale.policyNumber}`].filter(Boolean).join(" · ")}</InfoTip>;
  }
  if (m.kind !== "policy") return null;
  const { policy } = m.view;
  const late = (policy.daysPastDue ?? 0) > 0;
  const health = policyHealth({ status: policy.status, paidTo: policy.paidTo, daysPastDue: policy.daysPastDue, asOf: policy.asOf, premiumMode: policy.premiumMode });
  // Owner 2026-11-10: while behind, "N payments behind" is on the Paid to card, not beside the name.
  return late ? null : <span title={policy.statusRaw ? `The carrier's word: ${policy.statusRaw}` : undefined}><StatusChip tone={health.tone}>{health.label}</StatusChip></span>;
}

async function CountedTabs({ read, tab, tabsOf }: { read: Model; tab: PolicyTab; tabsOf: (counts?: { history: number | null; pipeline: number | null; findings: number | null }) => Array<{ key: PolicyTab; label: string; count: number | null; tone?: "danger"; href: string }> }) {
  const m = await read;
  if (m.kind !== "policy") return null;
  return <ViewTabs label="This policy" value={tab} tabs={tabsOf(m.counts)} />;
}

/** One primary — the next thing to do, in this order — and the rest in ⋯, last on the line (round 6, board 8). */
async function Actions({ read, carrierId, readOnly, canEditLink }: { read: Model; carrierId: string; readOnly: boolean; canEditLink: boolean }) {
  const m = await read;
  if (m.kind === "awaiting") return m.sale.leadId ? <Link href={`/app/leads/${m.sale.leadId}`} className="text-sm font-semibold underline">Open the lead</Link> : null;
  if (m.kind !== "policy") return null;
  const { view, keys, linkId, caseId, clientName } = m;
  const { policy, client, sale } = view;
  const canLink = canEditLink && !readOnly;
  const links: MoreLink[] = [
    ...(caseId ? [{ label: "Open the case", href: `/app/retention/${caseId}` }] : []),
    ...(keys?.leadId ? [{ label: "Open the lead", href: `/app/leads/${keys.leadId}` }] : []),
    ...(sale ? [{ label: "Open the application", href: `/app/applications/${sale.caseId}` }] : []),
    ...(canLink ? [{ label: client || sale ? "Change client" : "Link a client", href: changeClientHref(policy.carrierId, policy.policyNumber) }] : []),
    { label: "Add a note", href: carrierPolicyHref(carrierId, policy.policyNumber, "notes") },
  ];
  // "Add a note" is never the primary: with nothing else to do, the page shows ⋯ alone.
  const primary = links[0] && links[0].label !== "Add a note" ? links[0] : null;
  return (
    <>
      {primary && <Button asChild><Link href={primary.href}>{primary.label}</Link></Button>}
      <PolicyMoreMenu links={primary ? links.slice(1) : links} policyNumber={policy.policyNumber} unlink={linkId ? { matchId: linkId, clientName, disabledReason: readOnly ? "The account is read-only." : null } : null} />
    </>
  );
}

async function PolicyTabBody({ read, tab, carrierId, tenantId, readOnly, canEditLink, ownerOrBookkeeper, isProducer, canUndo, canLetter }: {
  read: Model;
  tab: PolicyTab;
  carrierId: string;
  tenantId: string;
  readOnly: boolean;
  canEditLink: boolean;
  ownerOrBookkeeper: boolean;
  isProducer: boolean;
  canUndo: boolean;
  canLetter: boolean;
}) {
  const m = await read;
  if (m.kind === "unavailable") return <EmptyState title="The policy list isn't available yet" hint={m.message} />;
  if (m.kind === "awaiting") return <PolicyAwaitingFile sale={m.sale} />;
  if (m.kind === "missing") {
    return <EmptyState title="This policy is not in your book" hint={isProducer ? "It may be credited to another agent, or its carrier file hasn't arrived yet." : "Its carrier file may not have arrived yet, or the policy number is different."} />;
  }
  const { view, keys } = m;
  const { policy, client } = view;
  const late = (policy.daysPastDue ?? 0) > 0;
  const atRiskCents = view.ledger.unearned?.atRiskCents ?? null;

  if (tab === "history") {
    // The carrier's field changes and the lead's card moves in one list (owner 2026-11-05: the stage history too).
    const [history, card] = await Promise.all([
      loadPolicyHistory(tenantId, carrierId, policy.policyNumber),
      loadPolicyPipeline(tenantId, keys?.leadId ?? null).catch(() => null),
    ]);
    if (!history.available) return <EmptyState title="History isn't available yet" hint="The policy history needs a database update (20261008140000)." />;
    return <PolicyHistoryTab rows={mergeHistory(history.rows, card?.available ? cardMoveHistoryRows(card.moves) : [])} policyNumber={policy.policyNumber} truncated={history.truncated} />;
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
        canLetter={canLetter}
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
  // Owner 2026-11-10: no line under the client's name. The policy number, carrier and product are in the
  // Overview's strip and Policy card; Provisional and "Check the client" are on its Client row.
  const provisional = showsProvisional(client?.provisional, keys?.link);
  // "Came from": a sale with no lead source on record names the sale, not "Lead source not known".
  const cameFrom = view.lead.name ? null : saleCameFrom(keys?.sale);
  return <PolicyOverviewTab view={cameFrom ? { ...view, lead: { ...view.lead, name: cameFrom } } : view} provisional={provisional} />;
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
