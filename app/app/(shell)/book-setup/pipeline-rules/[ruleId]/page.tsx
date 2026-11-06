import Link from "next/link";
import { notFound } from "next/navigation";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { ForecastTable } from "@/components/app/book/setup/forecast-table";
import { PreviewTable } from "@/components/app/book/setup/preview-table";
import { RuleActions } from "@/components/app/book/setup/rule-actions";
import { RuleForm } from "@/components/app/book/setup/rule-form";
import { RuleOverview } from "@/components/app/book/setup/rule-overview";
import { RuleTabs, ruleTabOf } from "@/components/app/book/setup/rule-tabs";
import { ModeChip, stageNames } from "@/components/app/book/setup/rules-list";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { VersionsTable } from "@/components/app/book/setup/versions-table";
import { Callout } from "@/components/app/settings/primitives";
import { buttonVariants } from "@/components/ui/button";
import { isRecordUuid } from "@/lib/ingestion/path";
import { EVENT_LABELS, PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { loadBoard, loadCarrierChoices, loadRule, previewRule } from "@/lib/pipelineRules/store";

/** The events counted against a carrier's grace: a carrier with none set counts no missed payment. */
const GRACE_EVENTS = new Set(["first_payment_missed", "later_payment_missed"]);

/**
 * Carrier sync › Pipeline rules › a rule (round 6, direction F of docs/la4/mockups-r6/pipeline-rule-r2.html, the owner's
 * pick 2026-11-06: "Getting it live"). The title says what the rule does (event → pipeline › stage, unless it was named
 * by hand) with its mode, and no facts line under it. Tabs: Overview (the Drafted → Forecast → Live track, then what is
 * left before live, or how it is doing once live, and the rule as one sentence) · Check it (the lines to mark Right or
 * Wrong, and today's preview) · Rule (the form; a content change saves a new version) · Versions. One primary button —
 * the next step on the track — and Duplicate, Rename, Back to forecast and Turn off in ⋯. ?tab=preview and ?tab=forecast
 * (the old tabs) open Check it.
 */
export default async function PipelineRulePage({ params, searchParams }: { params: Promise<{ ruleId: string }>; searchParams: Promise<{ tab?: string; preview?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Card moves" description="Rates, carrier terms and card-move rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Card moves" detail="Setup is for the account owner and bookkeepers." />;
  const [{ ruleId }, { tab: asked, preview: previewAsked }] = await Promise.all([params, searchParams]);
  if (!isRecordUuid(ruleId)) notFound();
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const [view, board, carriers] = await Promise.all([loadRule(tenantId, ruleId), loadBoard(tenantId), loadCarrierChoices(tenantId)]);
  if (!view.available) {
    return <DataInPage step="pipeline-rules" title="Card-move rule"><Callout tone="warning" title={PIPELINE_RULES_PENDING_MESSAGE} /></DataInPage>;
  }
  const rule = view.rule;
  if (!rule || !rule.current) notFound();
  const tab = ruleTabOf(asked === "preview" ? "check" : asked);
  const v = rule.current;
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  const right = view.forecast.filter((l) => l.checked === "right").length;
  const wrong = view.forecast.filter((l) => l.checked === "wrong");
  const base = `/app/book-setup/pipeline-rules/${rule.id}`;
  const checkHref = `${base}?tab=check`;
  const previewHref = `${base}?tab=check&preview=1#today`;
  // Today's preview runs the same checks as a run and writes nothing; read only when asked for (it reads the book).
  const wantsPreview = tab === "check" && (previewAsked === "1" || asked === "preview");
  // The grace line of the checklist (a missed-payment rule not yet live): the carriers it covers with no grace set.
  const wantsGrace = tab === "overview" && rule.mode !== "live" && GRACE_EVENTS.has(v.event);
  const preview = wantsPreview || wantsGrace ? await previewRule(tenantId, { ruleId }).catch(() => null) : null;

  // The title says what the rule does. A rule still under its made-up name ("Issued → Issued") reads event → where the
  // card goes; a name typed by hand is kept.
  const to = stageNames(board).get(v.targetStageId);
  const madeUp = to && rule.name.trim() === `${EVENT_LABELS[v.event].label} → ${to.stage}`;
  // "Sales pipeline" reads "Sales" in a title: the arrow already says it is where the card goes.
  const title = madeUp ? `${EVENT_LABELS[v.event].label} → ${to.pipeline.replace(/\s+pipeline$/i, "")} › ${to.stage}` : rule.name;
  const lines = rule.mode === "live" ? view.recentLive : view.forecast;

  return (
    <DataInPage
      step="pipeline-rules"
      title={title}
      chip={<ModeChip mode={rule.mode} enabled={rule.enabled} />}
      lead={<RuleTabs active={tab} base={base} counts={{ check: lines.length, versions: view.versions.length }} />}
      actions={<RuleActions ruleId={rule.id} name={rule.name} mode={rule.mode} enabled={rule.enabled} forecast={{ days: 7, wouldMoves: view.forecast.length, right, wrong: wrong.length }} readOnly={readOnly} previewHref={previewHref} renameHref={`${base}?tab=rule`} />}
    >
      {tab === "overview" && (
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
          ruleHref={`${base}?tab=rule`}
          graceMissing={wantsGrace && preview?.available ? preview.carriersWithoutGrace.length : null}
        />
      )}
      {tab === "check" && (
        <>
          <ForecastTable
            lines={lines}
            readOnly={readOnly}
            live={rule.mode === "live"}
            title={rule.mode === "live" ? `Last 7 days · ${lines.length} ${lines.length === 1 ? "line" : "lines"}` : undefined}
            // A live rule's Preview today is the title line's button already.
            action={wantsPreview || rule.mode === "live" ? undefined : <Link href={previewHref} className={buttonVariants({ variant: "outline", size: "sm" })}>Preview today</Link>}
          />
          {wantsPreview && (preview?.available ? (
            <div id="today"><PreviewTable lines={preview.lines} asOf={preview.asOf} title="Today: would move, or skipped and why" /></div>
          ) : <Callout tone="warning" title={PIPELINE_RULES_PENDING_MESSAGE} />)}
        </>
      )}
      {tab === "rule" && (
        <RuleForm
          key={v.id}
          ruleId={rule.id}
          readOnly={readOnly}
          board={board}
          carriers={carriers}
          initial={{ name: rule.name, event: v.event, carrierIds: v.carrierIds, fromStageIds: v.fromStageIds, targetPipelineId: v.targetPipelineId, targetStageId: v.targetStageId, noteOn: v.noteOn, noteTemplate: v.noteTemplate ?? "" }}
        />
      )}
      {tab === "versions" && <VersionsTable versions={view.versions} current={rule.currentVersion} board={board} carriers={carriers} />}
    </DataInPage>
  );
}
