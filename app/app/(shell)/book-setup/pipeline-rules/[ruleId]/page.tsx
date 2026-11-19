import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataInPage, RecordName } from "@/components/app/data-in/data-in-page";
import { BUCKET_LABEL, bucketOf, RULES_HREF, isBucket, type RuleBucket, rulePageHref, RuleStepper, shortRuleName, stageNames } from "@/components/app/book/setup/card-moves-shared";
import { CheckOneByOneButton } from "@/components/app/book/setup/card-moves-check";
import { ForecastTable } from "@/components/app/book/setup/forecast-table";
import { PreviewTodayButton } from "@/components/app/book/setup/preview-table";
import { RuleActions } from "@/components/app/book/setup/rule-actions";
import { RuleForm, RuleFormActions } from "@/components/app/book/setup/rule-form";
import { RuleOverview } from "@/components/app/book/setup/rule-overview";
import { RuleTabs, ruleTabOf, type RuleTab } from "@/components/app/book/setup/rule-tabs";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { VersionsTable } from "@/components/app/book/setup/versions-table";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { isRecordUuid } from "@/lib/ingestion/path";
import { EVENT_LABELS, PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { loadBoard, loadCarrierChoices, loadRule, loadRulesList, previewRule } from "@/lib/pipelineRules/store";

/** The events counted against a carrier's grace: a carrier with none set counts no missed payment. */
const GRACE_EVENTS = new Set(["first_payment_missed", "later_payment_missed"]);
const READ_ONLY = "Book of business is read-only while the account is suspended.";

/**
 * Carrier sync › Card moves › a rule (round 6 direction F, the owner's pick 2026-11-06, kept by r7 §2·1). The title says
 * what the rule does (event → pipeline › stage, unless it was named by hand) and stands alone: its mode is on the track
 * in the Overview. Tabs: Overview (the Drafted → Forecast → Live track, then what is left before live, or how it is
 * doing once live, and the rule as one sentence) · Check it (the would-moves as verdicts; the check dialog marks them
 * one by one) · Rule (the form; Save as a new version on the title line) · Versions.
 *
 * Round 7 (docs/la4/mockups-r7/carrier-sync-setup.html 2·1–2·6): the Overview's stepper walks the rules of the list tab
 * it was opened from (?from=), each button naming its rule; Preview today is a dialog, not a second table; ⋯ keeps
 * Duplicate, Rename or change (lands on Rule with Name focused), Back to forecast and Turn off. ?tab=preview and
 * ?tab=forecast (the old tabs) open Check it; ?preview=1 opens the preview.
 */
export default async function PipelineRulePage({ params, searchParams }: { params: Promise<{ ruleId: string }>; searchParams: Promise<{ tab?: string; preview?: string; from?: string; check?: string; focus?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Card moves" description="Rates, carrier terms and card-move rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Card moves" detail="Setup is for the account owner and bookkeepers." />;
  const [{ ruleId }, { tab: asked, preview: previewAsked, from: fromAsked, check: checkAsked, focus }] = await Promise.all([params, searchParams]);
  if (!isRecordUuid(ruleId)) notFound();
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const tab = ruleTabOf(asked === "preview" ? "check" : asked);
  const from = isBucket(fromAsked) && fromAsked !== "all" ? fromAsked : null;
  // A read-only account cannot POST, so its preview is run here (it reads the book, writes nothing), only when asked.
  const wantsServerPreview = readOnly && tab === "check" && (previewAsked === "1" || asked === "preview");
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the frame draw at once; the rule's name waits behind its
  // shape, and the counts, the buttons and the tab stream in. The reads are today's, only started before the frame.
  const read = loadModel(tenantId, ruleId, tab, wantsServerPreview);
  const name = read.then((model) => (model === null ? "Card-move rule" : model.found ? model.title : null));

  const listHref = from ? `${RULES_HREF}?mode=${from}` : `${RULES_HREF}?mode=all`;
  const breadcrumbs = [
    { label: "Carrier sync", href: "/app/needs-you" },
    { label: "Card moves", href: listHref },
    ...(from ? [{ label: BUCKET_LABEL[from], href: listHref }] : []),
    { label: "Rule", node: <RecordName read={name} crumb /> },
  ];

  return (
    <DataInPage
      step="pipeline-rules"
      title={<RecordName read={name} />}
      breadcrumbs={breadcrumbs}
      tabs={<Suspense fallback={<RuleTabs active={tab} ruleId={ruleId} from={from} counts={{}} />}><CountedTabs read={read} tab={tab} from={from} /></Suspense>}
      actions={<Suspense fallback={tab === "rule" ? <RuleFormActions readOnly={readOnly} reason={READ_ONLY} /> : null}><Actions read={read} tab={tab} from={from} readOnly={readOnly} wantsServerPreview={wantsServerPreview} previewAsked={previewAsked === "1" || asked === "preview"} /></Suspense>}
    >
      <StreamSection shape={tab === "rule" ? "form" : tab === "overview" ? "cards" : "table"}>
        <RuleBody read={read} tab={tab} from={from} readOnly={readOnly} autoCheck={checkAsked === "1"} focusName={focus === "name"} />
      </StreamSection>
    </DataInPage>
  );
}

/** The rule and what its page works out from it. null: card moves are not set up yet; found false: no such rule. */
async function loadModel(tenantId: string, ruleId: string, tab: RuleTab, wantsServerPreview: boolean) {
  const [view, board, carriers, list] = await Promise.all([loadRule(tenantId, ruleId), loadBoard(tenantId), loadCarrierChoices(tenantId), loadRulesList(tenantId)]);
  if (!view.available) return null;
  const rule = view.rule;
  if (!rule || !rule.current) return { found: false as const };
  const v = rule.current;
  const live = rule.mode === "live";
  const graceEvent = GRACE_EVENTS.has(v.event);
  // The grace line of the checklist (a missed-payment rule not yet live): the carriers it covers with no grace set.
  const wantsGrace = tab === "overview" && !live && graceEvent;
  const preview = wantsServerPreview || wantsGrace ? await previewRule(tenantId, { ruleId }).catch(() => null) : null;
  // The title says what the rule does. A rule still under its made-up name ("Issued → Issued") reads event → where the
  // card goes; a name typed by hand is kept.
  const to = stageNames(board).get(v.targetStageId);
  const madeUp = to && rule.name.trim() === `${EVENT_LABELS[v.event].label} → ${to.stage}`;
  // "Sales pipeline" reads "Sales" in a title: the arrow already says it is where the card goes.
  const title = madeUp ? `${EVENT_LABELS[v.event].label} → ${to.pipeline.replace(/\s+pipeline$/i, "")} › ${to.stage}` : rule.name;
  const open = view.forecast.filter((l) => !l.checked).length;
  return { found: true as const, view, rule, v, board, carriers, list, live, graceEvent, wantsGrace, preview, title, open, lines: live ? view.recentLive : view.forecast };
}

type Read = ReturnType<typeof loadModel>;

async function CountedTabs({ read, tab, from }: { read: Read; tab: RuleTab; from: RuleBucket | null }) {
  const model = await read;
  if (!model || !model.found) return null;
  return <RuleTabs active={tab} ruleId={model.rule.id} from={from} counts={{ check: model.live ? model.lines.length : model.open, versions: model.view.versions.length }} warnCheck={!model.live && model.open > 0} />;
}

async function Actions({ read, tab, from, readOnly, wantsServerPreview, previewAsked }: { read: Read; tab: RuleTab; from: RuleBucket | null; readOnly: boolean; wantsServerPreview: boolean; previewAsked: boolean }) {
  const model = await read;
  if (!model || !model.found) return null;
  const { rule, view, live, graceEvent, preview, title, open, list } = model;
  const right = view.forecast.filter((l) => l.checked === "right").length;
  const wrong = view.forecast.filter((l) => l.checked === "wrong").length;
  const previewHref = rulePageHref(rule.id, { from, tab: "check", extra: { preview: "1" } });

  // The stepper: this rule's neighbours in the list tab it came from, in the list's order.
  const walk = list.rules.filter((r) => !from || bucketOf(r) === from);
  const at = walk.findIndex((r) => r.id === rule.id);
  const step = (r: (typeof walk)[number] | undefined) => (r ? { href: rulePageHref(r.id, { from }), name: shortRuleName(r.name, r.current?.event ?? null) } : null);
  const stepper = at >= 0 ? <RuleStepper prev={step(walk[at - 1])} next={step(walk[at + 1])} /> : null;

  const actionProps = { ruleId: rule.id, name: title, mode: rule.mode, enabled: rule.enabled, forecast: { days: 7, wouldMoves: view.forecast.length, right, wrong }, readOnly, previewHref, renameHref: rulePageHref(rule.id, { from, tab: "rule", extra: { focus: "name" } }), graceEvent };
  if (tab === "overview") return <>{stepper}<RuleActions {...actionProps} /></>;
  if (tab === "check") {
    return live ? <RuleActions {...actionProps} /> : (
      <>
        <PreviewTodayButton ruleId={rule.id} readOnly={readOnly} href={previewHref} initial={wantsServerPreview && preview?.available ? preview : null} graceEvent={graceEvent} defaultOpen={previewAsked} />
        {!readOnly && <CheckOneByOneButton open={open} />}
        <RuleActions {...actionProps} primary={false} />
      </>
    );
  }
  if (tab === "rule") return <><RuleFormActions readOnly={readOnly} reason={READ_ONLY} /><RuleActions {...actionProps} primary={false} /></>;
  return <RuleActions {...actionProps} />;
}

async function RuleBody({ read, tab, from, readOnly, autoCheck, focusName }: { read: Read; tab: RuleTab; from: RuleBucket | null; readOnly: boolean; autoCheck: boolean; focusName: boolean }) {
  const model = await read;
  if (!model) return <TableCard><EmptyState title="Card moves are not ready yet" hint={PIPELINE_RULES_PENDING_MESSAGE} /></TableCard>;
  if (!model.found) notFound();
  const { rule, v, view, board, carriers, live, wantsGrace, preview, open, lines } = model;
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  const checkHref = rulePageHref(rule.id, { from, tab: "check", extra: open > 0 && !readOnly ? { check: "1" } : {} });

  if (tab === "overview") {
    return (
      <RuleOverview
        mode={rule.mode}
        enabled={rule.enabled}
        createdAt={rule.createdAt}
        liveSince={rule.liveSince}
        version={v}
        forecast={view.forecast}
        live={view.recentLive}
        board={board}
        carrierName={(id) => carrierName.get(id) ?? "a carrier"}
        checkHref={checkHref}
        ruleHref={rulePageHref(rule.id, { from, tab: "rule" })}
        graceMissing={wantsGrace && preview?.available ? preview.carriersWithoutGrace : null}
      />
    );
  }
  if (tab === "check") {
    return (
      <ForecastTable
        lines={lines}
        readOnly={readOnly}
        live={live}
        autoCheck={autoCheck}
        title={live ? `Last 7 days · ${lines.length} ${lines.length === 1 ? "line" : "lines"}` : undefined}
      />
    );
  }
  if (tab === "rule") {
    return (
      <RuleForm
        key={v.id}
        ruleId={rule.id}
        readOnly={readOnly}
        board={board}
        carriers={carriers}
        focusName={focusName}
        initial={{ name: rule.name, event: v.event, carrierIds: v.carrierIds, fromStageIds: v.fromStageIds, targetPipelineId: v.targetPipelineId, targetStageId: v.targetStageId, noteOn: v.noteOn, noteTemplate: v.noteTemplate ?? "" }}
      />
    );
  }
  return <VersionsTable versions={view.versions} current={rule.currentVersion} board={board} carriers={carriers} />;
}
